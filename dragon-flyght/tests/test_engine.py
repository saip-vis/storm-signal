import math, json
import pytest
from fastapi.testclient import TestClient
from backend import ml
from backend.data import neighborhood, normalize
from backend.engine import simulate, compare, trace
from backend.main import app

def test_damage_parsing():
    assert ml.damage('1.25M')==1250000
    assert ml.damage('0K')==0
    assert ml.damage('2B')==2000000000
    assert math.isnan(ml.damage(''))
    assert math.isnan(ml.damage('unknown'))

def test_seed_reproducible_and_money_reconciles():
    a=simulate(seed=1);b=simulate(seed=1)
    assert a['assets']==b['assets']
    business=a['business']
    assert business['totalModeledLoss']==pytest.approx(sum(x['totalModeledLoss'] for x in a['assets']),abs=.01)
    assert business['totalModeledLoss']==pytest.approx(business['repairExpense']+business['revenueAtRisk']+business['extraRecoveryExpense'],abs=.01)
    c=a['community'];assert c['unmetShelterDemand']==max(0,c['shelterDemand']-c['verifiedUsableCapacity'])

def test_no_hazard_no_damage():
    s=simulate(severity=0,seed=1)
    assert s['business']['totalModeledLoss']==0
    assert s['business']['disruptedFacilities']==0
    assert s['community']['potentialDisplacement']==0

def test_dependency_cycle_terminates():
    edges=[{'sourceId':'a','targetId':'b'},{'sourceId':'b','targetId':'a'},{'sourceId':'b','targetId':'c'}]
    assert set(trace('a',edges=edges))=={'b','c'}

def test_intervention_preserves_baseline_and_household_need():
    base=simulate(seed=1);result=compare(.78,1,['power','shelter'])
    assert result['baseline']['assets']==base['assets']
    assert result['mitigated']['community']['potentialDisplacement']==base['community']['potentialDisplacement']
    assert result['mitigated']['community']['unmetShelterDemand']<base['community']['unmetShelterDemand']
    assert result['netBenefit']==pytest.approx(result['avoidedLoss']-result['mitigationCost'])

def test_blocked_shelter_capacity_not_counted():
    s=simulate(seed=42,interventions=['shelter'])
    byid={a['id']:a for a in s['assets']}
    for shelter in s['community']['shelters']:
        if byid[shelter['buildingId']]['failed']:assert shelter['usableCapacity']==0

def test_import_dedup_and_uncertainty():
    n=neighborhood();r=normalize([{'Building ID':'1'},{'id':'b-001'},{'name':'Cottonwood Comunity Ctr'}],n['assets'])
    assert r['matchedCount']==1
    assert r['reviewCount']==1
    assert any(i['status']=='duplicate merged' for i in r['issues'])

def test_real_artifact_predicts():
    p=ml.predict();assert p['modelSource']=='trained-historical';assert 0<=p['riskScore']<=1
    meta=ml.metadata();assert sum(meta['splits'].values())==meta['rows']
    assert sum(map(sum,meta['metrics']['confusionMatrix']))==meta['splits']['test']

def test_full_judge_workflow(monkeypatch):
    monkeypatch.delenv('NVIDIA_API_KEY',raising=False)
    with TestClient(app) as client:
        assert client.get('/api/health').status_code==200
        s=client.get('/api/scenario?seed=1').json()
        assert len(s['assets'])==42
        assert 'B001' in client.get('/api/graph/B005').json()['upstream']
        predict=client.post('/api/ml/predict',json={'eventType':'tornado'});assert predict.status_code==200
        assert client.post('/api/ml/predict',json={'weather':{'humidityPercent':500}}).status_code==422
        assert client.post('/api/scenario/compare',json={'interventions':['fake']}).status_code==422
        r=client.post('/api/agent/investigate',json={'seed':1}).json()
        assert r['mode']=='Demo Agent';assert len(r['toolCalls'])>=10
        pid=r['plan']['planId']
        decision=client.post('/api/plans/'+pid+'/decision',json={'decision':'approve'})
        assert decision.status_code==200
        approved=decision.json();assert approved['plan']['approvalStatus']=='approved'
        assert approved['comparison']['baseline']['assets']==s['assets']
        assert client.post('/api/plans/'+pid+'/decision',json={'decision':'approve'}).status_code==409
        r2=client.post('/api/agent/investigate',json={'seed':1}).json()
        revised=client.post('/api/plans/'+r2['plan']['planId']+'/decision',json={'decision':'revise','interventionIds':['shelter']})
        assert revised.json()['plan']['interventionIds']==['shelter']
        assert client.post('/api/plans/'+r2['plan']['planId']+'/decision',json={'decision':'reject'}).json()['comparison'] is None
        sample=client.get('/api/fusion/sample').json()['content'];assert client.post('/api/fusion/import',json={'content':sample}).json()['matchedCount']==42
        assert client.get('/api/audit').json()

def test_tornado_api_does_not_treat_gust_as_noaa_magnitude():
    with TestClient(app) as client:
        low=client.post('/api/ml/predict',json={'eventType':'tornado','weather':{'windGustKmh':60}}).json()
        high=client.post('/api/ml/predict',json={'eventType':'tornado','weather':{'windGustKmh':350}}).json()
        assert low['riskScore']==high['riskScore']
        assert 'missing-value imputer' in low['inputNotice']
        assert client.get('/api/scenario?severity=5').status_code==422

def test_weather_unavailable_and_stale_cache(tmp_path,monkeypatch):
    from backend import services
    import httpx
    monkeypatch.setattr(services,'CACHE',tmp_path)
    class Offline:
        def __init__(self,*args,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,*args,**kwargs):raise httpx.ConnectError('offline')
    monkeypatch.setattr(services.httpx,'Client',Offline)
    r=services.fetch('https://example.test')
    assert r['status']=='unavailable';assert r['data'] is None
    import hashlib,os,time
    key=hashlib.sha256(('https://example.test'+'{}').encode()).hexdigest()
    path=tmp_path/(key+'.json');path.write_text(json.dumps({'status':'available','data':{'features':[]},'retrievedAt':'old'}));os.utime(path,(time.time()-2000,time.time()-2000))
    cached=services.fetch('https://example.test',ttl=1)
    assert cached['status']=='stale-cache';assert cached['retrievedAt']=='old'
