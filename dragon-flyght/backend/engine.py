"""Seeded scenario consequences. All asset effects are assumptions, not property ML."""
import math, random, copy
from . import ml
from .data import neighborhood
N=neighborhood()
INTERVENTIONS=[
 {'id':'power','name':'Restore substation connection','targetNodeId':'B001','estimatedCost':45000,'description':'Simulate verified electrical restoration and downstream service recovery.','verificationRequirements':['qualified utility inspection','operator approval'],'approvalRequired':True},
 {'id':'shelter','name':'Activate 100 verified shelter spaces','targetNodeId':'B010','estimatedCost':18000,'description':'Add synthetic inspected, accessible, staffed capacity. Does not repair homes.','verificationRequirements':['structural inspection','road access','operator approval'],'approvalRequired':True},
 {'id':'roof','name':'Reinforce portfolio roofing','targetNodeId':'portfolio','estimatedCost':240000,'description':'Preparedness counterfactual: reduce assumed structural vulnerability.','verificationRequirements':['hypothetical pre-event installation'],'approvalRequired':True},
 {'id':'road','name':'Clear and verify access roads','targetNodeId':'B003','estimatedCost':25000,'description':'Simulated inspection and restoration of both access roads.','verificationRequirements':['road inspection','simulated clearance approval'],'approvalRequired':True},
 {'id':'medication','name':'Coordinate mobile pharmacy','targetNodeId':'B005','estimatedCost':12000,'description':'Provide a verified synthetic alternative medication service.','verificationRequirements':['operator approval','resource verification'],'approvalRequired':True}]

def trace(node,direction='upstream',edges=None):
    edges=edges if edges is not None else N['edges']; found=[]; seen={node}; stack=[node]
    while stack:
        current=stack.pop()
        for edge in edges:
            target=edge['targetId'] if direction=='upstream' and edge['sourceId']==current else edge['sourceId'] if direction=='downstream' and edge['targetId']==current else None
            if target and target not in seen: seen.add(target);found.append(target);stack.append(target)
    return found

def simulate(severity=.78,seed=1,interventions=None):
    interventions=set(interventions or []); rng=random.Random(seed)
    pred=ml.predict('Tornado',magnitude=float('nan'))
    event_score=pred['riskScore'] if pred['riskScore'] is not None else severity*.6
    results=[]
    for asset in N['assets']:
        a=copy.deepcopy(asset)
        distance=abs(a['worldX']*.75-a['worldZ']*.4)
        exposure=math.exp(-distance/130)*severity
        vulnerability=(1-a['roofCondition'])*.5+(2026-a['yearBuilt'])/150+.15
        if 'roof' in interventions: vulnerability*=.55
        # Scenario mapping is deliberately explicit and not a trained building predictor.
        risk=min(.95,exposure*(.4+.6*event_score)*vulnerability)
        u=rng.random(); failed=u<risk
        direct=failed
        a.update({'scenarioRisk':round(risk,4),'exposure':round(exposure,4),'directDamage':direct,'failed':failed,'reasons':['seeded direct failure sample'] if failed else [],'status':'disrupted' if failed else 'operational','repairExpense':round(a['replacementCost']*risk*.12,2),'predictionSource':'assumption-based asset mapping of event model score','modelVersion':pred['modelVersion']})
        results.append(a)
    byid={a['id']:a for a in results}
    if 'power' in interventions: byid['B001']['failed']=False;byid['B001']['status']='restored';byid['B001']['reasons']=[]
    if 'road' in interventions:
        for key in ['B003','B004']: byid[key]['failed']=False;byid[key]['status']='restored';byid[key]['reasons']=[]
    # Fixed point propagation terminates even if dependencies contain cycles.
    for _ in range(len(results)):
        changed=False
        for edge in N['edges']:
            child,parent=byid[edge['sourceId']],byid[edge['targetId']]
            if parent['failed'] and not child['failed'] and not (edge['relationshipType']=='POWERED_BY' and child['backupPower']):
                child['failed']=True;child['reasons'].append(f"{edge['relationshipType']} {parent['id']}");changed=True
        if not changed: break
    for a in results:
        a['status']='disrupted' if a['failed'] else a['status']
        a['downtimeDays']=round(1+a['scenarioRisk']*7,2) if a['failed'] else 0
        a['revenueAtRisk']=round(a['annualRevenue']/365*a['downtimeDays'],2)
        a['extraRecoveryExpense']=5000 if a['failed'] and a['annualRevenue'] else 0
        a['totalModeledLoss']=round(a['repairExpense']+a['revenueAtRisk']+a['extraRecoveryExpense'],2)
    shelters=[]
    for shelter in N['shelters']:
        s=copy.deepcopy(shelter); a=byid[s['buildingId']]
        s['usableCapacity']=s['confirmedAvailableCapacity'] if not a['failed'] else 0
        s['reason']='facility disruption' if a['failed'] else 'verified synthetic capacity'
        if s['buildingId']=='B010' and 'shelter' in interventions:
            s['usableCapacity']=100 if not a['failed'] else 0
            s['reason']='approved synthetic activation' if not a['failed'] else 'activation blocked: facility disrupted'
        shelters.append(s)
    residential=[a for a in results if a['buildingType'] in ('house','apartments')]
    exposed=sum(a['occupantCapacity'] for a in residential if a['exposure']>.25)
    displaced=sum(round(a['occupantCapacity']*.65) for a in residential if a['directDamage'])
    demand=math.ceil(displaced*.7); capacity=sum(s['usableCapacity'] for s in shelters)
    gaps=[a['buildingType'] for a in results if a['buildingType'] in ('pharmacy','clinic','grocery') and a['failed'] and not (a['buildingType']=='pharmacy' and 'medication' in interventions)]
    requests=copy.deepcopy(N['requests'])
    for r in requests:
        if r['need']=='medication' and 'medication' in interventions:r['status']='matched'
        if r['need']=='transport' and 'road' in interventions:r['status']='matched'
    business={'repairExpense':round(sum(a['repairExpense'] for a in results),2),'revenueAtRisk':round(sum(a['revenueAtRisk'] for a in results),2),'extraRecoveryExpense':sum(a['extraRecoveryExpense'] for a in results),'totalModeledLoss':round(sum(a['totalModeledLoss'] for a in results),2),'disruptedFacilities':sum(a['failed'] for a in results),'downtimeDays':round(sum(a['downtimeDays'] for a in results),2),'mitigationCost':sum(i['estimatedCost'] for i in INTERVENTIONS if i['id'] in interventions)}
    return {'id':f'richardson-{seed}','name':'Simulated Richardson Tornado','sourceType':'simulated','severity':severity,'randomSeed':seed,'prediction':pred,'assets':results,'edges':N['edges'],'businesses':N['businesses'],'business':business,'community':{'exposedResidents':exposed,'potentialDisplacement':displaced,'shelterDemand':demand,'verifiedUsableCapacity':capacity,'unmetShelterDemand':max(0,demand-capacity),'serviceGaps':gaps,'unassessedRequests':sum(r['status']=='unassessed' for r in requests),'shelters':shelters,'requests':requests,'zones':N['zones']},'interventions':sorted(interventions),'assumptions':['Fictional Richardson-area portfolio and households; no real emergency warning.','Seeded sample is one possible scenario, not confirmed destruction.','Asset risk = exposure × (0.4 + 0.6 × event model score) × vulnerability.','Repair expense = replacement cost × assumed asset risk × 0.12 (expected scenario expense).','Displaced residents = 65% of occupancy in directly sampled damaged homes; 70% seek shelter.','Shelters require synthetic verification, operating facilities and access.','Restoring electricity does not remove structural damage or household displacement.']}

def compare(severity,seed,interventions):
    base=simulate(severity,seed); after=simulate(severity,seed,interventions)
    avoided=round(base['business']['totalModeledLoss']-after['business']['totalModeledLoss'],2)
    return {'baseline':base,'mitigated':after,'avoidedLoss':avoided,'mitigationCost':after['business']['mitigationCost'],'netBenefit':round(avoided-after['business']['mitigationCost'],2)}
