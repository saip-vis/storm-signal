import json, time, hashlib, os
from datetime import datetime, timezone
from pathlib import Path
import httpx
CACHE=Path(__file__).resolve().parents[1]/'data/cache'; CACHE.mkdir(exist_ok=True)

def fetch(url,params=None,ttl=900):
    key=hashlib.sha256((url+json.dumps(params or {},sort_keys=True)).encode()).hexdigest(); p=CACHE/(key+'.json')
    if p.exists() and time.time()-p.stat().st_mtime<ttl:return json.loads(p.read_text())
    error=None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=20,follow_redirects=True) as client:
                r=client.get(url,params=params,headers={'User-Agent':os.getenv('NWS_USER_AGENT','DragonflyAI/1.0 (educational local demo)')});r.raise_for_status();data=r.json()
            payload={'status':'available','retrievedAt':datetime.now(timezone.utc).isoformat(),'sourceUrl':str(r.url),'data':data};p.write_text(json.dumps(payload));return payload
        except (httpx.HTTPError,ValueError) as e:error=type(e).__name__
    if p.exists():
        data=json.loads(p.read_text());data['status']='stale-cache';data['error']=error;return data
    return {'status':'unavailable','error':error,'sourceUrl':url,'data':None}

def official_weather():
    alerts=fetch('https://api.weather.gov/alerts/active',{'point':'32.95,-96.73'},900)
    point=fetch('https://api.weather.gov/points/32.95,-96.73',ttl=86400)
    forecast_url=(point.get('data') or {}).get('properties',{}).get('forecastHourly')
    hourly=fetch(forecast_url,ttl=1800) if forecast_url else {'status':'unavailable','data':None}
    return {'alerts':alerts,'forecast':hourly,'notice':'Official NWS data is separate from the fictional tornado scenario.'}

def historical_weather(lat,lon,start,end):
    return fetch('https://archive-api.open-meteo.com/v1/archive',{'latitude':lat,'longitude':lon,'start_date':start,'end_date':end,'hourly':'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl','timezone':'UTC','models':'era5'},86400*365)
