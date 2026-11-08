"""Reproducible NFIP-claims damage-fraction experiment; do not use it as a failure probability."""
import argparse, json, os, pathlib, datetime, requests, pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error
from xgboost import XGBRegressor
ROOT=pathlib.Path(__file__).resolve().parents[1]; OUT=ROOT/'ml-training'/'artifacts'; CACHE=ROOT/'ml-training'/'cache'; URL='https://www.fema.gov/api/open/v3/NfipClaims'
FEATURES=['waterDepth','numberOfFloorsInTheInsuredBuilding','occupancyType','foundationType','elevatedBuildingIndicator','postFIRMConstructionIndicator','yearOfLoss']
def main():
 p=argparse.ArgumentParser();p.add_argument('--sample',type=int,default=5000);p.add_argument('--seed',type=int,default=42);p.add_argument('--offline',action='store_true');a=p.parse_args();CACHE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True);raw=CACHE/f'nfip-{a.sample}.json'
 if not raw.exists() and not a.offline:
  r=requests.get(URL,params={'$top':a.sample},timeout=60);r.raise_for_status();raw.write_text(json.dumps(r.json()))
 if not raw.exists(): raise SystemExit('No cached FEMA sample. Run without --offline once.')
 payload=json.loads(raw.read_text());df=pd.DataFrame(payload['NfipClaims']); df['target']=pd.to_numeric(df.buildingDamageAmount,errors='coerce')/pd.to_numeric(df.buildingPropertyValue,errors='coerce')
 df=df[(df.target>=0)&(df.target<=1)&pd.to_numeric(df.waterDepth,errors='coerce').notna()].copy()
 for c in FEATURES:
  if c not in df: df[c]=None
  if c in ['elevatedBuildingIndicator','postFIRMConstructionIndicator']:df[c]=df[c].fillna(False).astype(int)
  else: df[c]=pd.to_numeric(df[c],errors='coerce').fillna(-1)
 X=df[FEATURES];y=df.target;groups=df.get('floodEvent',pd.Series(['unknown']*len(df))).fillna('unknown')
 tr,te=next(GroupShuffleSplit(test_size=.2,n_splits=1,random_state=a.seed).split(X,y,groups));model=XGBRegressor(n_estimators=120,max_depth=4,learning_rate=.06,subsample=.8,colsample_bytree=.9,objective='reg:squarederror',random_state=a.seed,n_jobs=2);model.fit(X.iloc[tr],y.iloc[tr]);pred=model.predict(X.iloc[te]);baseline=float(y.iloc[tr].median());base=[baseline]*len(te)
 metrics={'mae':float(mean_absolute_error(y.iloc[te],pred)),'rmse':float(mean_squared_error(y.iloc[te],pred)**.5),'baseline_mae':float(mean_absolute_error(y.iloc[te],base)),'baseline_rmse':float(mean_squared_error(y.iloc[te],base)**.5)}
 model.save_model(str(OUT/'model.json'));(OUT/'preprocessing.json').write_text(json.dumps({'features':FEATURES,'missingNumericValue':-1,'target':'buildingDamageAmount / buildingPropertyValue; valid range [0,1]'},indent=2));meta={'modelName':'XGBoost NFIP claim damage fraction estimator','modelVersion':'nfip-claims-xgb-v1','predictionTarget':'buildingDamageAmount / buildingPropertyValue, conditional on historical NFIP claims','trainingDataSource':URL,'trainingSampleCount':int(len(tr)),'evaluationSampleCount':int(len(te)),'evaluationMethod':'GroupShuffleSplit by floodEvent; unknown events remain grouped together','metrics':metrics,'trainingTimestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'randomSeed':a.seed,'limitations':['NFIP claims are not a random sample of flood-exposed buildings; outputs are conditional historical severity estimates, not damage probability.','Claims records may have missing/administrative values; missing numeric features use -1.','Richardson model inputs are synthetic scenario attributes.']};(OUT/'model_metadata.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta,indent=2))
if __name__=='__main__':main()
