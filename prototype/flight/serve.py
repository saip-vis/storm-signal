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
import json, os, sys, time, math, re, ssl, threading, shutil, subprocess, tempfile, urllib.request, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
PORT = int(os.environ.get('PORT', '8765'))
UA = 'DragonFlyght/0.3 (student disaster-rescue sim; local)'  # NWS asks for an identifying User-Agent
M_LAT = 110540.0
# Each city: origin (local meters 0,0; must match CITIES in js/core.js), bbox = detailed area (every building and street),
# outer = wider area (only big buildings, main roads, parks, water and coastline; lets the map go on and on), emax = largest map half-size in m,
# maxb = building cap, stations = NWS weather stations. Houston and Dallas are the original single-tier downtown maps.
CITIES = {
    'houston': {'name': 'Houston', 'origin': (29.7604, -95.3698), 'bbox': (29.7465, -95.3800, 29.7705, -95.3545), 'stations': ('KHOU', 'KIAH')},  # downtown + Buffalo Bayou
    'dallas': {'name': 'Dallas', 'origin': (32.7770, -96.8065), 'bbox': (32.7650, -96.8250, 32.7890, -96.7880), 'stations': ('KDAL', 'KDFW')},  # downtown + Trinity River edge
    'richardson': {'name': 'Richardson', 'origin': (32.9857, -96.7502), 'bbox': (32.9731, -96.7651, 32.9983, -96.7353),
                   'outer': (32.9614, -96.7787, 33.0100, -96.7217), 'emax': 3000, 'maxb': 9000, 'stations': ('KDAL', 'KDFW'), 'v': 2},  # whole UTD campus + Richardson around it
    'sf': {'name': 'San Francisco', 'origin': (37.7655, -122.4375), 'bbox': (37.7760, -122.4180, 37.8010, -122.3830),
           'outer': (37.7080, -122.5200, 37.8230, -122.3550), 'emax': 8200, 'maxb': 14000, 'stations': ('KSFO', 'KOAK'), 'v': 2},  # downtown detail + the whole city, Golden Gate to Ocean Beach
    'miami': {'name': 'Miami', 'origin': (25.7800, -80.1925), 'bbox': (25.7560, -80.2060, 25.7900, -80.1800),
              'outer': (25.7250, -80.2650, 25.8350, -80.1200), 'emax': 8200, 'maxb': 14000, 'stations': ('KMIA', 'KOPF'), 'v': 2},  # downtown + Brickell detail, out to Miami Beach
    'nyc': {'name': 'New York', 'origin': (40.7525, -73.9850), 'bbox': (40.7400, -74.0000, 40.7680, -73.9700),
            'outer': (40.7000, -74.0300, 40.8050, -73.9400), 'emax': 6600, 'maxb': 15000, 'stations': ('KNYC', 'KLGA'), 'v': 2},  # Midtown detail, Battery to Central Park and beyond
    'anchorage': {'name': 'Anchorage', 'origin': (61.2170, -149.8950), 'bbox': (61.2060, -149.9200, 61.2280, -149.8700),
                  'outer': (61.1770, -149.9850, 61.2570, -149.8050), 'emax': 5400, 'maxb': 9000, 'stations': ('PANC',), 'v': 2},  # downtown + Cook Inlet coast
}


def city_of(q):
    return q if q in CITIES else 'houston'


def m_lng(origin):
    return 111320.0 * math.cos(math.radians(origin[0]))
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


def to_xz(lat, lon, origin):
    return [round((lon - origin[1]) * m_lng(origin), 1), round(-(lat - origin[0]) * M_LAT, 1)]


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


def join_rings(ways):
    """Join open way geometries into closed rings by matching end points (used for water multipolygons)."""
    k = lambda p: (p[0], p[1])
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop()
        while k(cur[0]) != k(cur[-1]):
            for i, sg in enumerate(segs):
                if k(sg[0]) == k(cur[-1]):
                    cur += sg[1:]
                elif k(sg[-1]) == k(cur[-1]):
                    cur += sg[::-1][1:]
                elif k(sg[-1]) == k(cur[0]):
                    cur = sg + cur[1:]
                elif k(sg[0]) == k(cur[0]):
                    cur = sg[::-1] + cur[1:]
                else:
                    continue
                segs.pop(i)
                break
            else:
                break
        if len(cur) >= 4 and k(cur[0]) == k(cur[-1]):
            rings.append(cur[:-1])
    return rings


def convert(osm, origin, city=None):
    """Overpass JSON (out geom) -> the game's compact local-meter format."""
    cfg = CITIES.get(city or '', {})
    out = {'source': 'OpenStreetMap via Overpass (c) OpenStreetMap contributors, ODbL', 'origin': origin,
           'buildings': [], 'roads': [], 'water': [], 'parks': [], 'coast': [], 'lakes': []}
    ext = 300.0
    inner = None
    if 'bbox' in cfg:
        s_, w_, n_, e_ = cfg['bbox']
        a, b = to_xz(s_, w_, origin), to_xz(n_, e_, origin)
        inner = (min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1]))
    for el in osm.get('elements', []):
        tags = el.get('tags', {})
        # sea (coastline: water is on the right of the way) and lakes / wide rivers (polygons)
        if tags.get('natural') == 'coastline' and el['type'] == 'way' and 'geometry' in el:
            pts = [to_xz(p['lat'], p['lon'], origin) for p in el['geometry']]
            if len(pts) >= 2:
                out['coast'].append({'pts': pts})
            continue
        if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank':
            if el['type'] == 'way' and 'geometry' in el:
                pts = [to_xz(p['lat'], p['lon'], origin) for p in el['geometry']]
                if len(pts) >= 4 and pts[0] == pts[-1]:
                    out['lakes'].append({'rings': [pts[:-1]]})
            elif el['type'] == 'relation' and 'members' in el:
                ways = [[to_xz(p['lat'], p['lon'], origin) for p in m['geometry']] for m in el['members'] if m.get('role') in ('outer', 'inner') and 'geometry' in m]
                rings = join_rings(ways)
                if rings:
                    out['lakes'].append({'rings': rings})
            continue
        ring = None
        if el['type'] == 'way' and 'geometry' in el:
            ring = [to_xz(p['lat'], p['lon'], origin) for p in el['geometry']]
        elif el['type'] == 'relation' and 'members' in el:
            outers = [m for m in el['members'] if m.get('role') == 'outer' and 'geometry' in m]
            if outers:
                g = max(outers, key=lambda m: len(m['geometry']))['geometry']
                ring = [to_xz(p['lat'], p['lon'], origin) for p in g]
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
            cx, cz = ring[0]
            isin = inner is None or (inner[0] <= cx <= inner[1] and inner[2] <= cz <= inner[3])
            out['buildings'].append({'poly': ring, 'h': round(h, 1), 'lv': lv, 't': t, 'n': tags.get('name', ''), '_in': isin})
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
    # building cap: keep every building in the detailed area, then the tallest of the rest
    maxb = cfg.get('maxb')
    bl = out['buildings']
    if maxb and len(bl) > maxb:
        keep = [b for b in bl if b['_in']]
        rest = sorted([b for b in bl if not b['_in']], key=lambda b: -b['h'])
        bl = keep + rest[:max(0, maxb - len(keep))]
    for b in bl:
        b.pop('_in', None)
    out['buildings'] = bl
    if 'outer' in cfg:  # wide map: the extent is the outer box, not the buildings
        s_, w_, n_, e_ = cfg['outer']
        pts = [to_xz(s_, w_, origin), to_xz(n_, e_, origin)]
        out['extent'] = round(min(max(abs(c) for p in pts for c in p) + 60, cfg.get('emax', 2200)), 1)
    else:
        out['extent'] = round(min(ext + 60, 2200), 1)
    return out


def overpass_query(city, tier='inner'):
    c = CITIES[city]
    HW_ALL = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street'
    HW_MAJOR = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link'
    if tier == 'inner':
        s, w, n, e = c['bbox']
        bb = f'{s},{w},{n},{e}'
        return f"""[out:json][timeout:120];
(
  way["building"]({bb});
  relation["building"]["type"="multipolygon"]({bb});
  way["highway"~"^({HW_ALL})$"]({bb});
  way["waterway"~"^(river|stream|canal)$"]({bb});
  way["leisure"~"^(park|garden|pitch)$"]({bb});
  way["natural"="coastline"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["waterway"="riverbank"]({bb});
);
out geom;"""
    # outer tier: the wide map, kept light (only tall buildings, main roads, water, parks)
    s, w, n, e = c['outer']
    bb = f'{s},{w},{n},{e}'
    return f"""[out:json][timeout:240];
(
  way["building"]["building:levels"~"^([6-9]|[1-9][0-9]+)$"]({bb});
  way["building"]["height"~"^(1[89]|[2-9][0-9]|[0-9]{{3,}})"]({bb});
  way["highway"~"^({HW_MAJOR})$"]({bb});
  way["waterway"~"^(river|canal)$"]({bb});
  way["leisure"="park"]({bb});
  way["natural"="coastline"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["waterway"="riverbank"]({bb});
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
    if isinstance(val, dict) and val.get('partial'):  # incomplete download: do not keep it, so Retry can try again
        return val
    with _lock:
        _mem[name] = (now, val)
    return val


def cache_path(city):
    return os.path.join(CACHE, city + ('_osm_v%d.json' % CITIES[city].get('v', 1)))


def overpass(body, timeout):
    last = None
    for url in OVERPASS:
        try:
            return fetch(url, data=body, timeout=timeout)
        except Exception as ex:  # try the next mirror
            print(f'[overpass] {url} failed: {ex}')
            last = ex
    raise RuntimeError(f'Overpass failed: {last}')


def load_city(city):
    os.makedirs(CACHE, exist_ok=True)
    path = cache_path(city)
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    inner = overpass(urllib.parse.urlencode({'data': overpass_query(city, 'inner')}).encode(), 150)
    els = inner.get('elements', [])
    partial = False
    if 'outer' in CITIES[city]:  # the wide area is a second, bigger request; if it fails the detailed map still loads (and is not cached)
        try:
            outer = overpass(urllib.parse.urlencode({'data': overpass_query(city, 'outer')}).encode(), 280)
            seen = {(e['type'], e['id']) for e in els if 'id' in e}
            els = els + [e for e in outer.get('elements', []) if 'id' not in e or (e['type'], e['id']) not in seen]
        except Exception as ex:
            print(f'[{city}] wide area failed, using the detailed area only: {ex}')
            partial = True
    data = convert({'elements': els}, CITIES[city]['origin'], city)
    if partial:
        data['partial'] = True
        return data
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'[{city}] cached {len(data["buildings"])} buildings, {len(data["roads"])} roads, {len(data["coast"])} coast ways, {len(data["lakes"])} water areas -> {path}')
    return data


def alerts(city):
    lat, lng = CITIES[city]['origin']
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


def obs(city):
    for st in CITIES[city]['stations']:
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


def quakes(city):
    origin = CITIES[city]['origin']
    start = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - 86400))
    q = urllib.parse.urlencode({'format': 'geojson', 'latitude': origin[0], 'longitude': origin[1], 'maxradiuskm': 300,
                                'starttime': start, 'minmagnitude': 2.5})
    j = fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?' + q)
    return {'quakes': [{'id': f['id'], 'mag': f['properties']['mag'], 'place': f['properties']['place'],
                        'time': f['properties']['time']} for f in j.get('features', [])]}


# ---------- AI dispatcher (NVIDIA Nemotron via NVIDIA's OpenAI-compatible API) ----------
# The game sends a small JSON summary of the situation; Nemotron writes a 1-2 sentence radio callout.
# It only narrates what the planner already decided (it does not route). Key stays here, never sent to the browser.
NV_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
_last_dispatch = [0.0]
SYSTEM = ('/no_think You are a calm, professional emergency dispatch radio operator in a disaster-rescue SIMULATION set in a US city named in the data. '
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


# ---------- radio voice: text -> speech WAV using the computer's own voice (macOS `say`, else espeak). The browser then runs it through a radio filter. ----------
TTS_LOCK = threading.Lock()


def tts_engine():
    if shutil.which('say'):
        return 'say'
    return shutil.which('espeak-ng') or shutil.which('espeak')


def tts(text):
    eng = tts_engine()
    if not eng:
        raise RuntimeError('no text-to-speech engine (macOS say / espeak) found')
    text = re.sub(r'\s+', ' ', text or '').strip()[:320]
    if not text:
        raise RuntimeError('empty text')
    voice = re.sub(r'[^A-Za-z0-9 ()_-]', '', find_key('TTS_VOICE') or 'Alex')
    with TTS_LOCK, tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'v.wav')
        if eng == 'say':
            base = ['say', '-r', '185', '-o', out, '--file-format=WAVE', '--data-format=LEI16@22050']
            for cmd in (base[:1] + ['-v', voice] + base[1:], base):  # fall back to the default voice if that voice is missing
                p = subprocess.run(cmd + ['-f', '-'], input=text.encode(), capture_output=True, timeout=30)
                if p.returncode == 0 and os.path.isfile(out):
                    break
            else:
                raise RuntimeError('say failed: ' + p.stderr.decode(errors='ignore')[:120])
        else:
            p = subprocess.run([eng, '-v', 'en-us', '-s', '165', '-w', out, text], capture_output=True, timeout=30)
            if p.returncode != 0 or not os.path.isfile(out):
                raise RuntimeError('espeak failed')
        with open(out, 'rb') as f:
            return f.read()


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, fmt, *args):  # keep the console quiet; never log query strings
        if '/api/' in str(args[0] if args else ''):
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
                return self.send_json({'ok': True, 'google': bool(find_key()), 'nvidia': bool(find_key('NVIDIA_API_KEY')), 'tts': bool(tts_engine())})
            if path == '/api/config':
                if not self.is_local():
                    return self.send_json({'error': 'local only'}, 403)
                return self.send_json({'googleKey': find_key()})
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            c = city_of((q.get('c') or ['houston'])[0])
            if path in ('/api/city', '/api/houston'):
                return self.send_json(cached('city_' + c, 1e9, lambda: load_city(c)))
            if path == '/api/audio':  # which optional recordings exist in audio/ (so the page does not probe for missing files)
                ad = os.path.join(HERE, 'audio')
                return self.send_json({'files': sorted(f for f in os.listdir(ad) if f.lower().endswith(('.mp3', '.ogg', '.wav', '.m4a')))} if os.path.isdir(ad) else {'files': []})
            if path == '/api/alerts':
                return self.send_json(cached('alerts_' + c, 60, lambda: alerts(c)))
            if path == '/api/obs':
                return self.send_json(cached('obs_' + c, 300, lambda: obs(c)))
            if path == '/api/quakes':
                return self.send_json(cached('quakes_' + c, 300, lambda: quakes(c)))
        except Exception as ex:
            print(f'[api] {path} failed: {ex}')
            return self.send_json({'error': str(ex)[:200]}, 502)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path not in ('/api/dispatch', '/api/tts'):
            return self.send_json({'error': 'not found'}, 404)
        if not self.is_local():
            return self.send_json({'error': 'local only'}, 403)
        if path == '/api/tts':
            try:
                n = min(int(self.headers.get('Content-Length') or 0), 2000)
                wav = tts((json.loads(self.rfile.read(n) or b'{}')).get('text', ''))
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(wav)))
                self.end_headers()
                self.wfile.write(wav)
                return
            except Exception as ex:
                print(f'[tts] failed: {ex}')
                return self.send_json({'error': str(ex)[:160]}, 502)
        try:
            n = min(int(self.headers.get('Content-Length') or 0), 8000)
            return self.send_json(dispatch(json.loads(self.rfile.read(n) or b'{}')))
        except Exception as ex:
            print(f'[dispatch] failed: {ex}')
            return self.send_json({'text': None, 'error': str(ex)[:200]}, 502)


if __name__ == '__main__':
    print(f'Dragon Flyght: http://localhost:{PORT}   (Google key {"found" if find_key() else "not found, map uses the built-in view"})')
    print('Radio voice:', ('macOS say' if shutil.which('say') else 'espeak') if tts_engine() else 'no speech engine found (browser voice fallback)')
    print('NVIDIA dispatcher:', 'key found' if find_key('NVIDIA_API_KEY') else 'no NVIDIA_API_KEY in .env (radio stays off)')
    for k in CITIES:
        print(CITIES[k]['name'], 'map cache:', 'ready' if os.path.isfile(cache_path(k)) else 'not downloaded yet (first load of that city, ~30-90 s)')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
