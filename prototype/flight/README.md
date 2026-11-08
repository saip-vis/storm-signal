# Dragon Flyght (prototype)

Disaster rescue sim with a toon dragonfly (Aerial) and a fire truck (Earth). Every number is a modeled estimate under stated assumptions, not a real rescue prediction.

## Run it
- **Scenario simulator only:** open `index.html` in a browser (needs internet once for Three.js).
- **Everything, including Live Houston:** `python3 serve.py` in this folder, then open http://localhost:8765. Python 3 standard library only, nothing to install.
  - Put `GOOGLE_MAPS_API_KEY=...` in a `.env` in this folder or any parent folder (the repo root `.env` works). The key is only handed to pages on localhost and is never printed. Restrict the key to `http://localhost:*` and the Maps JavaScript API.
  - First run downloads downtown Houston from OpenStreetMap (Overpass) into `cache/houston_osm_v1.json` (~30 s). Delete that file to refresh.

## Two modes (start screen)
1. **Live Houston**: real downtown Houston buildings, roads and Buffalo Bayou from OpenStreetMap, in the same cartoon style. Active NWS alerts for downtown Houston pick the disaster (tornado, hurricane/tropical/wind, flood, red flag/fire), USGS quakes within 300 km can trigger the earthquake module, and the latest Houston Hobby observation drives the wind and rain. With no active alert you pick a real past event (Hurricane Beryl 2024, Houston derecho 2024, Harvey flooding 2017, Pasadena EF3 tornado 2023) or a normal day. The M map uses Google Maps as the basemap when a key is present.
2. **Scenario simulator**: pick tornado, hurricane, flood, wildfire or earthquake. Autopilot plans by default; click reports on the map (M) to set your own order (Clear goes back), and the HUD compares your route's modeled lives with the optimizer's.

Normal day (Live Houston) is free roam: no hazard and no calls.

**Map layers (M):** hazard heat map (both maps), live NEXRAD weather radar and NWS alert areas (Google map in Live Houston; radar tiles: NOAA data via Iowa Environmental Mesonet).

**Guide:** an arrow above you and an on-screen marker with distance always point to your next stop (the truck's follows the road).

## Controls
Mouse steer, W/S speed, Shift dash (truck: nitro, 2.5 s, 5 s cooldown), Space swing near a building (truck: handbrake). Arrows orbit the camera, mouse wheel zooms, C resets. A autopilot, M map, E swap Aerial/Earth, Q quality, F fps, H menu.

## How each disaster routes differently
- **Tornado**: forecasts the funnel (position + motion, uncertainty grows with lead time), skips stops the funnel would reach during arrival + boarding + lift-off, closes roads near the forecast track.
- **Hurricane**: wind field from a moving eye (headwinds cost time and battery), storm surge floods low ground and closes roads; far-bank reports may be air-only.
- **Flood**: water rises over a modeled terrain; reports are ranked by how soon water reaches them; roads close above 0.3 m.
- **Wildfire**: cellular fire spread (faster downwind, ember spotting); forecast fire arrival per cell; no landing in or just ahead of the front; flies high over smoke.
- **Earthquake**: main shock + aftershocks, staged collapses with dust, trapped people decay faster, rubble blocks about half of nearby roads and slows the rest.

## AI dispatcher (NVIDIA Nemotron)
With `NVIDIA_API_KEY=...` in `.env` (optional `NVIDIA_MODEL`, default `nvidia/llama-3.3-nemotron-super-49b-v1.5`), serve.py relays a small JSON summary of the situation to NVIDIA's API and Nemotron radios a 1-2 sentence callout (spoken with the browser voice; V toggles). It only narrates what the planner decided, it never routes. Rate-limited (one call per ~14 s, important events after 6 s, periodic update every 45 s). Local only; the key never reaches the browser.

## Audio
Every sound is synthesized in code with Web Audio (no audio files, no licenses): wind, wing buzz, engine, siren, rain, tornado rumble, fire crackle, quake rumble, thunder, pickup chime, whooshes, warnings, radio squelch and an ambient minor-key score that tightens with nearby danger. N toggles sound.

## Autopilot boosting
Dash (air) only on a long, clear, level leg (>380 m to go, nose on target, battery > 35%, not near the tornado), 4.5 s apart, 1.5% battery each. Nitro (truck) only on a clear straight with no corner, stop or car within 170 m, already above 14 m/s, fuel > 25%, 7 s apart.

## People estimates
- Scenario city: Houston 2020 Census city population (2,304,580) spread over buildings by volume; each box stands for a district.
- Live Houston: people in a building now = floor area / m2 per person (by building type) x time-of-day fraction for its use, at the current America/Chicago time (DST-aware). Densities and curves are documented assumptions in `js/world.js` (OCC, occFrac). No public feed (Google included) gives real-time building occupancy.

## Files
- `js/core.js` config (every tuning number), renderer, helpers. `js/world.js` city builder (procedural or OSM), roads graph, terrain/flood field, traffic, occupancy model. `js/characters.js` dragonfly + fire truck. `js/hazards.js` the five disasters. `js/sim.js` planner, autopilots, pickups. `js/ui.js` camera, map, menus, live data, main loop. `serve.py` local server + data cache.

## Troubleshooting
- "Could not load Houston map data" with an SSL/certificate error: serve.py now uses certifi or macOS's /etc/ssl/cert.pem; if it still fails run `pip3 install certifi` or the "Install Certificates.command" in your Python folder. The Terminal running serve.py prints the exact error.

## Honest limits
- Terrain elevation for flooding is modeled, not real LiDAR. Hurricane and fire scales are game-scaled.
- Building heights come from OSM tags where present; missing heights use defaults (`DEFAULT_H` in serve.py).
- The planner is a greedy heuristic with hazard forecasts, not an optimizer. Single unit, no multi-drone assignment yet.
- Live Houston was tested against synthetic OpenStreetMap-shaped data; run it locally to see the real map.

Data: (c) OpenStreetMap contributors (ODbL). Alerts and observations: NOAA/NWS api.weather.gov. Earthquakes: USGS.


## Update: Dallas, sound, radio voice, driving
- **Cities:** pick Houston or Dallas in the City row (needs `serve.py`). Each city downloads its own downtown from OpenStreetMap the first time (cached in `cache/`), and uses that city's NWS alerts, weather station (KHOU/KIAH or KDAL/KDFW) and USGS quakes. Dallas has its own real past events (2019 EF3 tornado, 2022 flash flood, 2024 windstorm). Add a city by adding one entry to `CITIES` in both `serve.py` and `js/core.js`.
- **Sound:** every scene has its own sound (tornado roar, howl and warning siren; hurricane gusts, rain and surf; flood rushing water; wildfire roar and crackle; quake rumble, debris and car alarms; a calm city with birds on a normal day). Real recordings can replace the built-in beds: drop `tornado`, `hurricane`, `flood`, `wildfire`, `earthquake`, `city` files (mp3/ogg/wav) in `audio/` (see `audio/README.txt`). Mix levels are the `LEVEL` line in `js/audio.js`. Radio speech ducks the ambience.
- **Radio voice:** `serve.py` renders each dispatcher line with the Mac's built-in voice (`say`, voice from `TTS_VOICE` in `.env`, default Alex), then the browser runs it through a handheld-radio filter with static and squelch. Without a speech engine it falls back to the browser voice.
- **Truck:** smoother throttle and steering, body lean and bumps, calmer camera. Flood: shallow water is avoided but waded if there is no dry way, deep water closes the road, and a truck caught in water drives to dry ground. Earthquake: if rubble cuts off every call it crawls through.
- **Full screen:** button or G.
