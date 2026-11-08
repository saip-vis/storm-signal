"""Retrospective NOAA event-impact baseline. Not a tornado forecast or building model."""
from pathlib import Path
import json, re, gzip, io, hashlib, time
from datetime import datetime, timezone
import httpx
import numpy as np
import pandas as pd
import joblib
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, average_precision_score, brier_score_loss, confusion_matrix
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT/'data/processed/noaa_events.csv'
FEATURES = ['EVENT_TYPE','MAGNITUDE','month','BEGIN_LAT','BEGIN_LON']
LIMITATIONS = ['Experimental retrospective event-level impact classification, not operational forecasting.', 'Recorded magnitude is post-event information; scenario magnitude is a user assumption.', 'Reported zero damage is a reporting value, not verified absence of damage. Missing damage is excluded.', 'Building vulnerability, loss, displacement and failure sampling are transparent scenario assumptions, not validated property predictions.', 'Uncalibrated model scores; coarse event data cannot resolve individual tornado paths.']

def damage(value):
    if pd.isna(value) or str(value).strip().upper() in ('','UNKNOWN','N/A'): return np.nan
    s=str(value).strip().upper().replace(',','')
    m=re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*([KMB]?)',s)
    return float(m[1])*{'':1,'K':1e3,'M':1e6,'B':1e9}[m[2]] if m else np.nan

def download():
    base='https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/'
    with httpx.Client(timeout=120,follow_redirects=True) as client:
        index=client.get(base); index.raise_for_status()
        frames=[]; sources=[]
        for year in [2021,2022,2023,2024]:
            names=sorted(set(re.findall(r'StormEvents_details-ftp_v1\.0_d'+str(year)+r'_c\d+\.csv\.gz',index.text)))
            if not names: raise RuntimeError(f'NOAA {year} unavailable')
            url=base+names[-1]; raw=client.get(url); raw.raise_for_status()
            df=pd.read_csv(io.BytesIO(gzip.decompress(raw.content)),low_memory=False)
            df=df[df.STATE.isin(['TEXAS','OKLAHOMA','ARKANSAS','LOUISIANA']) & df.EVENT_TYPE.isin(['Tornado','Thunderstorm Wind','Hail','Flash Flood'])].copy()
            cols=['EVENT_ID','EPISODE_ID','YEAR','MONTH_NAME','BEGIN_DATE_TIME','CZ_TIMEZONE','EVENT_TYPE','STATE','CZ_NAME','BEGIN_LAT','BEGIN_LON','MAGNITUDE','DAMAGE_PROPERTY']
            frames.append(df[cols]); sources.append({'url':url,'sha256':hashlib.sha256(raw.content).hexdigest(),'rows':len(df)})
        result=pd.concat(frames).drop_duplicates('EVENT_ID')
        DATA.parent.mkdir(parents=True,exist_ok=True); result.to_csv(DATA,index=False)
        (ROOT/'data/processed/provenance.json').write_text(json.dumps({'sourceType':'observed-historical','retrievedAt':datetime.now(timezone.utc).isoformat(),'sources':sources},indent=2))
        return len(result)

def train(threshold=100000):
    start=time.perf_counter()
    if not DATA.exists(): download()
    raw=pd.read_csv(DATA); df=raw.drop_duplicates('EVENT_ID').copy()
    df['damage']=df.DAMAGE_PROPERTY.map(damage); missing=int(df.damage.isna().sum()); df=df.dropna(subset=['damage'])
    # NOAA local civil timestamps retain CZ_TIMEZONE for provenance; month does not need UTC conversion.
    df['month']=pd.to_datetime(df.BEGIN_DATE_TIME,format='%d-%b-%y %H:%M:%S',errors='coerce').dt.month
    df['label']=(df.damage>=threshold).astype(int)
    # Episodes shared across year boundaries are removed from the later partition.
    tr=df[df.YEAR<=2022].copy(); va=df[df.YEAR==2023].copy(); te=df[df.YEAR==2024].copy()
    va=va[~va.EPISODE_ID.isin(tr.EPISODE_ID)]; te=te[~te.EPISODE_ID.isin(pd.concat([tr,va]).EPISODE_ID)]
    numeric=FEATURES[1:]
    pre=ColumnTransformer([('category',OneHotEncoder(handle_unknown='ignore'),['EVENT_TYPE']),('numeric',Pipeline([('impute',SimpleImputer(strategy='median')),('scale',StandardScaler())]),numeric)])
    model=Pipeline([('preprocess',pre),('classifier',LogisticRegression(max_iter=1200,random_state=42))]); model.fit(tr[FEATURES],tr.label)
    dummy=DummyClassifier(strategy='prior').fit(tr[FEATURES],tr.label)
    def metrics(fitted, frame):
        score=fitted.predict_proba(frame[FEATURES])[:,1]; predicted=(score>=.5).astype(int); y=frame.label
        return {'accuracy':accuracy_score(y,predicted),'precision':precision_score(y,predicted,zero_division=0),'recall':recall_score(y,predicted,zero_division=0),'f1':f1_score(y,predicted,zero_division=0),'rocAuc':roc_auc_score(y,score) if y.nunique()>1 else None,'prAuc':average_precision_score(y,score),'brier':brier_score_loss(y,score),'confusionMatrix':confusion_matrix(y,predicted,labels=[0,1]).tolist()}
    names=model.named_steps['preprocess'].get_feature_names_out(); coefficients=model.named_steps['classifier'].coef_[0]
    metadata={'version':'noaa-logistic-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f'),'source':'trained-historical','target':f'Reported event property damage ≥ ${threshold:,}','threshold':threshold,'family':'Logistic regression','calibrated':False,'features':FEATURES,'rows':len(df),'excludedMissingDamage':missing,'missingness':raw.isna().mean().round(4).to_dict(),'splits':{'train':len(tr),'validation':len(va),'test':len(te)},'periods':{'train':'2021–2022','validation':'2023','test':'2024'},'classDistribution':df.label.value_counts().to_dict(),'metrics':metrics(model,te),'validationMetrics':metrics(model,va),'baseline':metrics(dummy,te),'featureContributions':sorted([{'name':str(n),'coefficient':float(c)} for n,c in zip(names,coefficients)],key=lambda a:abs(a['coefficient']),reverse=True),'limitations':LIMITATIONS,'trainedAt':datetime.now(timezone.utc).isoformat(),'trainingSeconds':round(time.perf_counter()-start,3)}
    (ROOT/'models').mkdir(exist_ok=True)
    joblib.dump(model,ROOT/'models/impact.joblib'); (ROOT/'models/metadata.json').write_text(json.dumps(metadata,indent=2))
    return metadata

def metadata():
    path=ROOT/'models/metadata.json'
    return json.loads(path.read_text()) if path.exists() else {'source':'assumption-based','version':None,'limitations':LIMITATIONS}

def predict(event='Tornado',magnitude=90,latitude=32.95,longitude=-96.73,month=5):
    meta=metadata(); path=ROOT/'models/impact.joblib'
    if not path.exists(): return {'riskScore':None,'riskLabel':'unknown','modelSource':'assumption-based','modelVersion':None,'calibrated':False,'modelLimitations':LIMITATIONS}
    row=pd.DataFrame([{'EVENT_TYPE':event,'MAGNITUDE':magnitude,'month':month,'BEGIN_LAT':latitude,'BEGIN_LON':longitude}])
    score=float(joblib.load(path).predict_proba(row)[0,1])
    return {'riskScore':score,'riskLabel':'high' if score>.65 else 'moderate' if score>.3 else 'low','modelVersion':meta['version'],'modelSource':meta['source'],'calibrated':False,'modelLimitations':LIMITATIONS,'featureContributions':meta['featureContributions'],'timestamp':datetime.now(timezone.utc).isoformat()}
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--download',action='store_true');p.add_argument('--threshold',type=float,default=100000); args=p.parse_args()
    if args.download: print('Downloaded',download(),'NOAA records')
    print(json.dumps(train(args.threshold),indent=2))
