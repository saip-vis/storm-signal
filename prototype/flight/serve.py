#!/usr/bin/env python3
"""
Dragon Flyght local server (Python 3 standard library only, nothing to install).

    cd prototype/flight
    python3 serve.py            # then open http://localhost:8765

What it does
  /                 serves the game files from this folder
  /api/status       {"ok": true, "google": <key found?>}
  /api/config       {"googleKey": ...} ONLY to requests from this computer (localhost). The key is read from .env
                    (this folder or any parent) or the GOOGLE_MAPS_API_KEY environment variable. Never printed or logged.
  /api/houston      downtown Houston buildings, roads, Buffalo Bayou and parks from OpenStreetMap (Overpass API),
                    converted to local meters (x east, z south) and cached in cache/houston_osm_v1.json
  /api/alerts       active NWS alerts for downtown Houston (api.weather.gov), cached 60 s
  /api/obs          latest observation at Houston Hobby (KHOU), fallback Bush Intercontinental (KIAH), cached 5 min
  /api/quakes       USGS earthquakes M2.5+ within 300 km in the last 24 h, cached 5 min

Data notes
  OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Building heights come from OSM height / building:levels tags;
  missing heights use documented defaults (DEFAULT_H). Occupancy is NOT from any data feed: the game estimates it from
  floor area, building type and Houston local time (see world.js, OCC). Google provides no occupancy or foot-traffic data.
"""
import json, os, sys, time, math, re, ssl, threading, urllib.request, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
PORT = int(os.environ.get('PORT', '8765'))
UA = 'DragonFlyght/0.3 (student disaster-rescue sim; local)'  # NWS asks for an identifying User-Agent
ORIGIN = (29.7604, -95.3698)  # downtown Houston, same as the game's ORIGIN
M_LAT = 110540.0
M_LNG = 111320.0 * math.cos(math.radians(ORIGIN[0]))
BBOX = (29.7465, -95.3800, 29.7705, -95.3545)  # south, west, north, east: downtown + Buffalo Bayou edge (~2.5 x 2.7 km)
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

# default heights (m) when OSM has neither height nor building:levels (assumption, documented)
DEFAULT_H = {'house': 7, 'residential': 12, 'apartments': 18, 'retail': 7, 'commercial': 14, 'office': 30,
             'hotel': 30, 'parking': 15, 'garage': 6, 'church': 14, 'school': 10, 'hospital': 25, 'industrial': 10,
             'warehouse': 9, 'default': 12}
ROAD_W = {'motorway': 22, 'trunk': 18, 'primary': 16, 'secondary': 14, 'tertiary': 12, 'residential': 10,
          'unclassified': 9, 'living_street': 7}


def find_key(name='GOOGLE_MAPS_API_KEY'):
    k = os.environ.get(name)
    if k:
        return k.strip()
    d = HERE
    for _ in range(5):
        p = os.path.join(d, '.env')
        if os.path.isfile(p):
            with open(p, encoding='utf-8') as f:
                for line in f:
                    m = re.match(r'\s*' + name + r'\s*=\s*(.+)\s*$', line)
                    if m:
                        return m.group(1).strip().strip('"').strip("'")
        d = os.path.dirname(d)
    return None


def _ssl_context():
    # macOS python.org builds often ship without CA certificates (CERTIFICATE_VERIFY_FAILED).
    # Use certifi if installed, else the system bundle macOS keeps at /etc/ssl/cert.pem, else Python's default.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for caf in (os.environ.get('SSL_CERT_FILE'), '/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'):
        if caf and os.path.isfile(caf):
            return ssl.create_default_context(cafile=caf)
    return ssl.create_default_context()


SSL_CTX = _ssl_context()


def fetch(url, data=None, timeout=20, accept='application/json'):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'Accept': accept})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


def to_xz(lat, lon):
    return [round((lon - ORIGIN[1]) * M_LNG, 1), round(-(lat - ORIGIN[0]) * M_LAT, 1)]


def parse_height(tags):
    h = tags.get('height')
    if h:
        m = re.match(r'\s*([\d.]+)\s*(m|ft|\'|feet)?', h)
        if m:
            v = float(m.group(1))
            return v * 0.3048 if m.group(2) in ('ft', "'", 'feet') else v
    lv = tags.get('building:levels')
    if lv:
        try:
            return float(lv.split(';')[0]) * 3.6
        except ValueError:
            pass
    return None


def btype(tags):
    b = tags.get('building', 'yes')
    a = tags.get('amenity', '')
    if a in ('hospital', 'clinic'):
        return 'hospital'
    if a in ('school', 'kindergarten'):
        return 'school'
    if a in ('university', 'college'):
        return 'university'
    if a == 'place_of_worship':
        return 'church'
    if a in ('parking',):
        return 'parking'
    if tags.get('tourism') == 'hotel':
        return 'hotel'
    if 'office' in tags:
        return 'office'
    if 'shop' in tags:
        return 'retail'
    return b if b != 'yes' else 'default'


def convert(osm):
    """Overpass JSON (out geom) -> the game's compact local-meter format."""
    out = {'source': 'OpenStreetMap via Overpass (c) OpenStreetMap contributors, ODbL', 'origin': ORIGIN,
           'buildings': [], 'roads': [], 'water': [], 'parks': []}
    ext = 300.0
    for el in osm.get('elements', []):
        tags = el.get('tags', {})
        ring = None
        if el['type'] == 'way' and 'geometry' in el:
            ring = [to_xz(p['lat'], p['lon']) for p in el['geometry']]
        elif el['type'] == 'relation' and 'members' in el:
            outers = [m for m in el['members'] if m.get('role') == 'outer' and 'geometry' in m]
            if outers:
                g = max(outers, key=lambda m: len(m['geometry']))['geometry']
                ring = [to_xz(p['lat'], p['lon']) for p in g]
        if not ring or len(ring) < 2:
            continue
        if 'building' in tags:
            if ring[0] == ring[-1]:
                ring = ring[:-1]
            if len(ring) < 3:
                continue
            t = btype(tags)
            h = parse_height(tags) or DEFAULT_H.get(t, DEFAULT_H['default'])
            lv = tags.get('building:levels')
            try:
                lv = int(float(lv.split(';')[0])) if lv else 0
            except ValueError:
                lv = 0
            out['buildings'].append({'poly': ring, 'h': round(h, 1), 'lv': lv, 't': t, 'n': tags.get('name', '')})
            for x, z in ring:
                ext = max(ext, abs(x), abs(z))
        elif 'highway' in tags:
            k = tags['highway'].replace('_link', '')
            w = ROAD_W.get(k, 9)
            if tags['highway'].endswith('_link'):
                w = 8
            try:
                if 'lanes' in tags:
                    w = max(w, float(tags['lanes']) * 3.5)
            except ValueError:
                pass
            out['roads'].append({'pts': ring, 'w': w, 'k': tags['highway'], 'b': 1 if tags.get('bridge') in ('yes', 'viaduct') else 0})
        elif 'waterway' in tags:
            half = {'river': 18, 'canal': 8}.get(tags['waterway'], 4)  # Buffalo Bayou is roughly 30-45 m wide downtown
            out['water'].append({'pts': ring, 'half': half})
        elif 'leisure' in tags and ring[0] == ring[-1] and len(ring) > 3:
            out['parks'].append({'poly': ring[:-1]})
    out['extent'] = round(min(ext + 60, 2200), 1)
    return out


def overpass_query():
    s, w, n, e = BBOX
    bb = f'{s},{w},{n},{e}'
    return f"""[out:json][timeout:90];
(
  way["building"]({bb});
  relation["building"]["type"="multipolygon"]({bb});
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street)$"]({bb});
  way["waterway"~"^(river|stream|canal)$"]({bb});
  way["leisure"~"^(park|garden|pitch)$"]({bb});
);
out geom;"""


_lock = threading.Lock()
_mem = {}


def cached(name, ttl, producer):
    now = time.time()
    with _lock:
        hit = _mem.get(name)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = producer()
    with _lock:
        _mem[name] = (now, val)
    return val


def houston():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, 'houston_osm_v1.json')
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    body = urllib.parse.urlencode({'data': overpass_query()}).encode()
    last = None
    for url in OVERPASS:
        try:
            data = convert(fetch(url, data=body, timeout=120))
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, separators=(',', ':'))
            print(f'[houston] cached {len(data["buildings"])} buildings, {len(data["roads"])} roads -> {path}')
            return data
        except Exception as ex:  # try the next mirror
            print(f'[houston] {url} failed: {ex}')
            last = ex
    raise RuntimeError(f'Overpass failed: {last}')


def alerts():
    lat, lng = ORIGIN
    j = fetch(f'https://api.weather.gov/alerts/active?point={lat},{lng}', accept='application/geo+json')
    out = []
    for f in j.get('features', []):
        p = f.get('properties', {})
        g = f.get('geometry') or {}
        rings = g.get('coordinates', []) if g.get('type') == 'Polygon' else [r for poly in g.get('coordinates', []) for r in poly] if g.get('type') == 'MultiPolygon' else []
        out.append({'id': p.get('id') or f.get('id'), 'event': p.get('event', ''), 'severity': p.get('severity', ''),
                    'headline': p.get('headline', ''), 'expires': p.get('expires', ''), 'areas': p.get('areaDesc', ''),
                    'poly': [[[c[1], c[0]] for c in r] for r in rings][:4]})  # [lat, lng] rings for the map (zone alerts have no polygon)
    return {'alerts': out, 'fetched': time.time()}


def obs():
    for st in ('KHOU', 'KIAH'):
        try:
            p = fetch(f'https://api.weather.gov/stations/{st}/observations/latest', accept='application/geo+json')['properties']
            ws = (p.get('windSpeed') or {}).get('value')  # km/h in current NWS responses
            unit = (p.get('windSpeed') or {}).get('unitCode', '')
            wind = None if ws is None else (ws / 3.6 if 'km_h' in unit else ws)
            desc = p.get('textDescription') or ''
            pr = (p.get('precipitationLastHour') or {}).get('value')
            return {'station': st, 'time': p.get('timestamp'), 'wind': wind, 'dir': (p.get('windDirection') or {}).get('value'),
                    'temp': (p.get('temperature') or {}).get('value'), 'desc': desc,
                    'rain': bool((pr or 0) > 0 or re.search(r'rain|storm|shower|drizzle', desc, re.I))}
        except Exception:
            continue
    return {'wind': None, 'desc': 'unavailable'}


def quakes():
    start = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - 86400))
    q = urllib.parse.urlencode({'format': 'geojson', 'latitude': ORIGIN[0], 'longitude': ORIGIN[1], 'maxradiuskm': 300,
                                'starttime': start, 'minmagnitude': 2.5})
    j = fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?' + q)
    return {'quakes': [{'id': f['id'], 'mag': f['properties']['mag'], 'place': f['properties']['place'],
                        'time': f['properties']['time']} for f in j.get('features', [])]}


# ---------- AI dispatcher (NVIDIA Nemotron via NVIDIA's OpenAI-compatible API) ----------
# The game sends a small JSON summary of the situation; Nemotron writes a 1-2 sentence radio callout.
# It only narrates what the planner already decided (it does not route). Key stays here, never sent to the browser.
NV_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
_last_dispatch = [0.0]
SYSTEM = ('/no_think You are a calm, professional emergency dispatch radio operator in a disaster-rescue SIMULATION set in Houston. '
          'Write ONE radio callout to the rescue crew: at most 2 short sentences and 35 words. Use only the facts and numbers given. '
          'Say what is happening and why the next stop comes first (people, distance or ETA, hazard timing). '
          'Call people counts estimates. No markdown, no lists, no quotes, no sign-off codes.')


_nv_model = [None]
_nv_bad = set()
PREFER = ['nemotron-3', 'nemotron-super', 'nemotron-nano', 'nemotron', 'llama-3.3-70b', 'llama-3.1-70b', 'llama-3.1-8b']


def nv_models(key):
    """Ask NVIDIA which chat models this key can use right now (model names get retired, which is what HTTP 410 means)."""
    req = urllib.request.Request('https://integrate.api.nvidia.com/v1/models',
                                 headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        ids = [m['id'] for m in json.loads(r.read().decode('utf-8')).get('data', [])]
    bad = ('embed', 'rerank', 'vision', 'vl', 'guard', 'safety', 'reward', 'parse', 'clip', 'nvclip', 'retriever', 'translate')
    ids = [i for i in ids if not any(b in i.lower() for b in bad)]
    ranked = []
    for p in PREFER:
        ranked += sorted([i for i in ids if p in i.lower() and i not in ranked], key=lambda x: ('nvidia/' not in x, len(x)))
    return ranked


def nv_call(key, model, situation):
    body = json.dumps({'model': model,
                       'messages': [{'role': 'system', 'content': SYSTEM},
                                    {'role': 'user', 'content': json.dumps(situation)[:3000]}],
                       'temperature': 0.5, 'max_tokens': 160}).encode()
    req = urllib.request.Request(NV_URL, data=body, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                                             'Accept': 'application/json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=25, context=SSL_CTX) as r:
        return json.loads(r.read().decode('utf-8'))


def dispatch(situation):
    key = find_key('NVIDIA_API_KEY')
    if not key:
        return {'text': None, 'error': 'NVIDIA_API_KEY not set in .env'}
    if time.time() - _last_dispatch[0] < 6:  # simple rate limit
        return {'text': None, 'error': 'rate limited'}
    _last_dispatch[0] = time.time()
    # model order: NVIDIA_MODEL from .env, then the one that worked last time, then whatever the live model list offers
    tried = []
    for attempt in range(4):
        model = find_key('NVIDIA_MODEL') if (attempt == 0 and find_key('NVIDIA_MODEL')) else _nv_model[0]
        if not model or model in _nv_bad:
            try:
                cands = [m for m in nv_models(key) if m not in _nv_bad]
            except Exception as ex:
                return {'text': None, 'error': 'cannot list NVIDIA models: %s' % ex}
            if not cands:
                return {'text': None, 'error': 'no usable NVIDIA chat model found for this key'}
            model = _nv_model[0] = cands[0]
            print('[dispatch] using model', model)
        tried.append(model)
        try:
            j = nv_call(key, model, situation)
        except urllib.error.HTTPError as ex:
            if ex.code in (404, 410, 400, 422):  # retired / not available for this key: mark bad, pick another
                print('[dispatch] model %s gave HTTP %s, trying another' % (model, ex.code))
                _nv_bad.add(model)
                _nv_model[0] = None
                continue
            return {'text': None, 'error': 'HTTP %s' % ex.code}
        text = j['choices'][0]['message'].get('content') or ''
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.S).strip().strip('"')
        if text:
            return {'text': text[:300], 'model': j.get('model', model)}
        _nv_bad.add(model)
        _nv_model[0] = None
    return {'text': None, 'error': 'no working NVIDIA model (tried %s)' % ', '.join(tried)}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, fmt, *args):  # keep the console quiet; never log query strings
        if '/api/' in (args[0] if args else ''):
            return
        super().log_message(fmt, *args)

    def send_json(self, obj, code=200):
        b = json.dumps(obj, separators=(',', ':')).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def is_local(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return self.client_address[0] in ('127.0.0.1', '::1') and host in ('localhost', '127.0.0.1')

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == '/api/status':
                return self.send_json({'ok': True, 'google': bool(find_key()), 'nvidia': bool(find_key('NVIDIA_API_KEY'))})
            if path == '/api/config':
                if not self.is_local():
                    return self.send_json({'error': 'local only'}, 403)
                return self.send_json({'googleKey': find_key()})
            if path == '/api/houston':
                return self.send_json(cached('houston', 1e9, houston))
            if path == '/api/alerts':
                return self.send_json(cached('alerts', 60, alerts))
            if path == '/api/obs':
                return self.send_json(cached('obs', 300, obs))
            if path == '/api/quakes':
                return self.send_json(cached('quakes', 300, quakes))
        except Exception as ex:
            print(f'[api] {path} failed: {ex}')
            return self.send_json({'error': str(ex)[:200]}, 502)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path != '/api/dispatch':
            return self.send_json({'error': 'not found'}, 404)
        if not self.is_local():
            return self.send_json({'error': 'local only'}, 403)
        try:
            n = min(int(self.headers.get('Content-Length') or 0), 8000)
            return self.send_json(dispatch(json.loads(self.rfile.read(n) or b'{}')))
        except Exception as ex:
            print(f'[dispatch] failed: {ex}')
            return self.send_json({'text': None, 'error': str(ex)[:200]}, 502)


if __name__ == '__main__':
    print(f'Dragon Flyght: http://localhost:{PORT}   (Google key {"found" if find_key() else "not found, map uses the built-in view"})')
    print('NVIDIA dispatcher:', 'key found' if find_key('NVIDIA_API_KEY') else 'no NVIDIA_API_KEY in .env (radio stays off)')
    print('Houston map cache:', 'ready' if os.path.isfile(os.path.join(CACHE, 'houston_osm_v1.json')) else 'not downloaded yet (happens on first Live Houston load, ~30-90 s)')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
