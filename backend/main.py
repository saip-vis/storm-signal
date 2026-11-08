from pathlib import Path
import json, sqlite3, csv, io, uuid, threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone, date
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from . import ml
from .data import export_demo, normalize
from .engine import N, simulate, compare, trace, INTERVENTIONS
from .agent import investigate
from .services import official_weather, historical_weather
ROOT=Path(__file__).resolve().parents[1];load_dotenv(ROOT/'.env')
DB=ROOT/'data/dragonfly.sqlite';training_lock=threading.Lock()

def store(kind,payload):
    with sqlite3.connect(DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT, payload TEXT, created TEXT)')
        id=payload.get('planId',str(uuid.uuid4()));db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)',(id,kind,json.dumps(payload),datetime.now(timezone.utc).isoformat()));return id

def load_plan(id):
    with sqlite3.connect(DB) as db:
        row=db.execute("SELECT payload FROM records WHERE id=? AND kind='plan'",(id,)).fetchone()
    if not row:raise HTTPException(404,'Plan not found')
    return json.loads(row[0])
@asynccontextmanager
async def lifespan(app):
    export_demo();store('portfolio',N);store('startup',{'portfolioAssets':len(N['assets'])});yield
app=FastAPI(title='Dragonfly AI',version='1.0.0',lifespan=lifespan)
class ScenarioInput(BaseModel):
    severity:float=Field(default=.78,ge=0,le=1)
    seed:int=Field(default=1,ge=0,le=1000000)
    interventions:list[str]=Field(default_factory=list)
class InvestigateInput(ScenarioInput):
    prompt:str=Field(default='Prioritize unresolved financial and community consequences.',min_length=1,max_length=4000)
class Decision(BaseModel):
    decision:str
    interventionIds:list[str]|None=None
class ImportInput(BaseModel):
    content:str=Field(max_length=1000000)
    format:str='csv'
class WeatherInput(BaseModel):
    windGustKmh:float=Field(default=120,ge=0,le=500)
    precipitationMm:float=Field(default=45,ge=0,le=2000)
    pressureHpa:float=Field(default=995,ge=800,le=1100)
    humidityPercent:float=Field(default=80,ge=0,le=100)
class LocationInput(BaseModel):
    latitude:float=Field(default=32.95,ge=-90,le=90)
    longitude:float=Field(default=-96.73,ge=-180,le=180)
class PredictionInput(BaseModel):
    weather:WeatherInput=Field(default_factory=WeatherInput)
    eventType:str='severe_wind'
    location:LocationInput=Field(default_factory=LocationInput)
    predictionHorizonHours:float=Field(default=6,ge=0,le=168)

def validate_ids(ids):
    if set(ids)-{i['id'] for i in INTERVENTIONS}:raise HTTPException(422,'Unknown intervention')
@app.get('/api/health')
def health():return {'status':'ok','model':ml.metadata().get('version'),'agent':'configured' if __import__('os').getenv('NVIDIA_API_KEY') else 'Demo Agent'}
@app.get('/api/scenario')
def scenario(severity:float=Query(.78,ge=0,le=1),seed:int=Query(1,ge=0,le=1000000)):
    inputs=ScenarioInput(severity=severity,seed=seed);return simulate(inputs.severity,inputs.seed)
@app.post('/api/scenario/compare')
def comparison(data:ScenarioInput):validate_ids(data.interventions);return compare(data.severity,data.seed,data.interventions)
@app.get('/api/portfolio')
def portfolio():return N
@app.get('/api/graph/{node_id}')
def graph(node_id:str):
    node=next((a for a in N['assets'] if a['id']==node_id),None)
    if not node:raise HTTPException(404,'Unknown node')
    return {'node':node,'upstream':trace(node_id),'downstream':trace(node_id,'downstream')}
@app.get('/api/ml/metadata')
def model_metadata():return ml.metadata()
@app.post('/api/ml/train')
def train_model():
    if not training_lock.acquire(blocking=False):raise HTTPException(409,'Training already running')
    try:
        result=ml.train();store('training',result);return result
    finally:training_lock.release()
@app.post('/api/ml/predict')
def prediction(data:PredictionInput):
    event={'severe_wind':'Thunderstorm Wind','tornado':'Tornado','hail':'Hail','flood':'Flash Flood'}.get(data.eventType.lower())
    if not event:raise HTTPException(422,'Supported events: severe_wind, tornado, hail, flood')
    # NOAA thunderstorm magnitude is knots; gust is an assumed proxy for a retrospective feature.
    magnitude=data.weather.windGustKmh/1.852 if event=='Thunderstorm Wind' else float('nan')
    p=ml.predict(event,magnitude,data.location.latitude,data.location.longitude)
    return {'prediction':{'riskScore':p['riskScore'],'riskLabel':p['riskLabel']},**p,'inputNotice':'Event, location and assumed May month enter this baseline. Gust-to-knots proxy is used only for thunderstorm wind; other event magnitudes use the trained missing-value imputer. Rain, pressure, humidity and horizon are not trained features. Retrospective score, not a forward forecast.'}
@app.get('/api/ml/dataset')
def dataset():
    if not ml.DATA.exists():return {'rows':[],'status':'unavailable'}
    import pandas as pd
    df=pd.read_csv(ml.DATA);return {'rows':json.loads(df.head(100).to_json(orient='records')),'total':len(df),'source':'NOAA observed historical storm reports'}
@app.get('/api/interventions')
def interventions():return INTERVENTIONS
@app.post('/api/agent/investigate')
def agent(data:InvestigateInput):
    result=investigate(data.prompt,data.severity,data.seed)
    if result.get('plan'):store('plan',result['plan'])
    for c in result['toolCalls']:store('tool-call',c)
    return result
@app.post('/api/plans/{plan_id}/decision')
def decide(plan_id:str,data:Decision):
    plan=load_plan(plan_id)
    if data.decision not in ['approve','reject','revise']:raise HTTPException(422,'Invalid decision')
    if plan['approvalStatus']!='pending':raise HTTPException(409,'Plan already decided')
    if data.interventionIds is not None:
        if data.decision!='revise':raise HTTPException(422,'Use revise to change proposed actions')
        validate_ids(data.interventionIds);plan['interventionIds']=data.interventionIds
    plan['approvalStatus']={'approve':'approved','reject':'rejected','revise':'pending'}[data.decision];store('plan',plan);store('audit',{'planIdReference':plan_id,'decision':data.decision})
    return {'plan':plan,'comparison':compare(plan['severity'],plan['seed'],plan['interventionIds']) if data.decision=='approve' else None}
@app.post('/api/fusion/import')
def fusion(data:ImportInput):
    try:rows=json.loads(data.content) if data.format=='json' else list(csv.DictReader(io.StringIO(data.content)))
    except (ValueError,csv.Error):raise HTTPException(422,'Invalid CSV or JSON')
    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows):raise HTTPException(422,'Expected an array of objects')
    result=normalize(rows,N['assets']);store('import',result);return result
@app.get('/api/fusion/sample')
def fusion_sample():return {'content':(ROOT/'data/raw/messy_properties.csv').read_text()}
@app.get('/api/weather/official')
def weather():return official_weather()
@app.get('/api/weather/history')
def history(start:date,end:date):
    if end<start or (end-start).days>31:raise HTTPException(422,'Select at most 31 days')
    return historical_weather(32.95,-96.73,start.isoformat(),end.isoformat())
@app.get('/api/audit')
def audit():
    with sqlite3.connect(DB) as db:rows=db.execute('SELECT id,kind,created FROM records ORDER BY created DESC LIMIT 100').fetchall()
    return [{'id':r[0],'kind':r[1],'createdAt':r[2]} for r in rows]
if (ROOT/'frontend/dist').exists():app.mount('/',StaticFiles(directory=ROOT/'frontend/dist',html=True),name='frontend')
