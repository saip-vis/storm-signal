import json,sys,pathlib,pandas as pd
from xgboost import XGBRegressor
ROOT=pathlib.Path(__file__).resolve().parents[1];A=ROOT/'ml-training'/'artifacts'; cfg=json.loads((A/'preprocessing.json').read_text()); model=XGBRegressor();model.load_model(str(A/'model.json')); requests=json.load(sys.stdin);rows=[]
for r in requests:
 f=r.get('buildingAttributes',{}); rows.append({k:(int(bool(f.get(k))) if k in ['elevatedBuildingIndicator','postFIRMConstructionIndicator'] else cfg['missingNumericValue'] if f.get(k) is None else f[k]) for k in cfg['features']})
pred=model.predict(pd.DataFrame(rows)[cfg['features']]);print(json.dumps([{'nodeId':r['nodeId'],'estimatedDamageFraction':max(0,min(1,float(p)))} for r,p in zip(requests,pred)]))
