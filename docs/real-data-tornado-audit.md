# Real-data, tornado and Dragonfly upgrade — 2026-11-08

## Scope and verified data inventory

The normal application now defaults to **geometry exposure**, using the existing north-central Richardson study rectangle in Dallas County: `[-96.755, 32.935, -96.705, 32.975]`. This is a configurable rectangle in `config/regions.json`, not a municipal boundary. Dallas city, Dallas County and the DFW metroplex are **not** fully loaded. The region selector exposes only the loaded region; no uncontrolled building/POI/Census acquisition was attempted.

| Input / calculation | Evidence and current behavior |
| --- | --- |
| Buildings | 10,971 cached Overture Polygon/MultiPolygon records; release `2026-10-21.0`, acquisition `2026-11-08T10:55:44.486341+00:00`. Source IDs and measured height/floor fields are preserved. Unknown heights/floors stay absent. Cache claims complete coverage only of this rectangle. No synthetic fallback. |
| Facilities | 47 OpenStreetMap/Overpass source records acquired `2026-11-08T10:50:32.095Z`; geometry is source coordinates, not private occupancy evidence. Duplicate representations can occur. |
| Graph | 11,018 real geographic nodes, 42 `HOSTS` edges. Every edge is explicitly **spatially inferred**; five POIs remain unmatched. No verified private utility, road-access, equipment or emergency-service dependency has been added. |
| Census | 10 intersecting tracts, TIGER/Line + ACS 5-year 2022 population estimates. Dallas and Collin Counties were queried; loaded rectangle intersects Dallas County tracts. Tract totals are not a count of residents inside the smaller rectangle. Census records remain inspectable; normal analysis returns population exposure/displacement as null. |
| Flood geometry | `data/simulations/richardson-flood.json` is a hypothetical rectangle, severity 3 and 24-hour window, not observed inundation, a FEMA flood map or a forecast. It remains unchanged for regression testing. Exposure-only does not apply its synthetic operational assumptions. |
| Historical tornado | One original NOAA/NWS DAT polygon, object `874975`, event ID `42d25030-9f1f-4663-9cdf-a5dd47`, global ID `{AEDE126F-4E85-4D65-8AF0-AE4FB9622CC8}`. Survey timestamp `2019-10-21T02:56:00.000Z` (October 20 in Chicago time). Reported **contour** EF0; event-wide maximum rating remains null. Geometry and original source attributes are retained without buffering or reshaping. |
| Normal analysis | Polygon/MultiPolygon intersection, respecting holes; source points for POIs, unknown exposure for missing geometry. No flood equations, tornado damage model or private operational assumptions run. Counts reflect loaded records only. |
| Unsupported outcomes | Revenue, business downtime, actual closures, displaced residents, shelter demand/capacity, service capacities/gaps and population impact are nullable/unavailable. No headline financial or population estimates are displayed. Zero is used only for known geometric record counts, such as zero intersecting POI points in this tornado contour. |

## Synthetic and hypothetical inputs traced

These remain available only through explicit programmatic demo/test workflows. HTTP network demo mode requires `ALLOW_DEMO_DATA=1`; the normal server rejects it otherwise.

| Location | Synthetic / assumed content |
| --- | --- |
| `data/richardson/properties.csv` | Fictional organizational properties, names and coordinates. |
| `data/richardson/businesses.csv` | Fictional business/facility/service references. |
| `data/richardson/maintenance.csv` | Equipment IDs, work orders, maintenance condition and legacy site references. |
| `data/richardson/community_resources.csv` | Synthetic service areas and reported resource capacity. |
| `data/richardson/geographic-fixture.json`, `src/osm.js` | Offline geographic fixture and demo-only discovery fallback. Production `buildReal` does not call this discovery/fallback path. |
| `data/simulations/richardson-attributes.json` | Assumed vulnerability, water depth, floors, occupancy, foundation, elevation/FIRM indicators and loss year; hourly revenues 450/620/350; service capacities 120/200/80; populations 800/1100; footprint, displacement and shelter-seeking fractions; medication/food/health demand; shelter capacities 45/100 and fixture-only availability; alternative service capacities. None enter normal exposure calculations. |
| `src/simulation/engine.js` demo helpers | Synthetic downtime/failure rules, revenue arithmetic, community fallback fractions, shelter demand/capacity and service-gap arithmetic. Preserved as reusable regression helpers, not exposed by the normal analysis router. |
| `src/service.js` demo branch | Fixture `HAS_EQUIPMENT`, `HOSTS`, `PROVIDES_SERVICE`, `SERVES_AREA`, `ACCESSIBLE_VIA`. “Verified” fixture edges mean fixture reference matching, not verified real-world dependencies; isolated from the production graph. |
| `src/production-simulation.js` optional hybrid | Uniform assumed interior depth (default 4.5 ft), missing model covariates, severity thresholds 0.18/0.45 and availability screening; scenario preservation overrides. These are experimental assumptions, not calibrated closure predictions. No fabricated finances or capacities. |
| Experimental Census calculation | Polygon-area-weighted population assumes uniform distribution. It is not displacement and is omitted from normal analysis/headlines. Existing research calculation remains reusable. |
| Frontend | Hardcoded geography is limited to existing camera presets and source-disclosed study area; no fake buildings, heights, dependency connections, metrics, warnings or game routes. |
| Nemotron | Tools use the same normal exposure adapter and selected scenario/mode. A tornado context rejects silent substitution of the flood ID. Offline `mock_test` remains explicitly labeled; no paid inference was invoked. |

## ML artifact inspection

`ml-training/train.py`, `predict.py`, saved preprocessing and model metadata were inspected, together with the local FEMA response cache. The cache contains 5,000 NFIP claim records, 3,557 usable records under the basic documented target/depth filter, and 142 flood-event groups. This matches the saved 2,477 training + 1,080 evaluation row counts. Training code targets `buildingDamageAmount / buildingPropertyValue`, groups the held-out split by `floodEvent`, and uses missing numeric sentinel -1 / missing Boolean false. The small sample is not representative of all exposed buildings.

Saved metadata reports MAE 0.15599 vs median baseline 0.17539, RMSE 0.21451 vs baseline 0.25576. These are **previously saved metrics**, not newly recomputed evaluation or evidence of independent local validation. There is no tornado training data/model, no current-building historical damage labels, and no independent Richardson/DFW operational validation. The flood claims model therefore remains an **explicit experimental option**, never the default exposure result or a tornado model. Missing covariance, claim-selection bias and historical/current building differences remain material limitations.

Artifact SHA256: `33bdef01e25d45e487a291b5d763571525d7d04af36bfcfcc0bc16f1fcc2c5e1`.
Local training response SHA256: `c462255ce913ab49967b999c798aabc5e360514152262bec9950c6cffba434fc`.
No retraining or new validation claims were made. Provenance is documented code/cache/API-envelope consistency, not an independently signed training-data attestation.

## Official hazard acquisition and interpretation

Sources reviewed:

- [NOAA Event Footprint Catalog](https://www.ncei.noaa.gov/products/event-footprint-catalog): tornado products derive from post-event assessment records; warning polygons are a separate concept.
- [NOAA/NWS Damage Assessment Toolkit service](https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer): direct official survey geometry used here. NOAA describes DAT data as preliminary; official event statistics belong to NCEI Storm Data.
- [NWS October 20, 2019 event summary](https://www.weather.gov/fwd/tornadoes-october2019): wider Dallas/Richardson historical context. This summary is not used to assign damage ratings to individual buildings.
- [NCEI Storm Events Database](https://www.ncei.noaa.gov/access/storm-events-database/): authoritative event-statistics source, not bulk-imported in this slice. DAT event ID is not represented as an NCEI Storm Events numeric ID.

`npm run data:tornadoes:fetch` executes a reproducible, spatially bounded query against the official polygon layer for October 20–21, 2019, with a ten-record limit, 30-second timeout and 2 MB maximum. It validates provenance, IDs, dates, closed Polygon/MultiPolygon rings and intersection with the configured region, and rejects truncation/duplicates/invalid records. Atomic writes preserve the previous cache on failure. The committed small NOAA snapshot retains exact geometry, original properties, query URL and acquisition timestamp. It is not a full Dallas historical tornado catalog.

Current building intersection result: **215 buildings, 0 facility points**. These are present-day footprints intersecting a 2019 survey contour, not confirmed 2019 damaged buildings. Building existence at event time is unknown. No path-width buffer, fabricated EF rating, warning track or damage probability is generated. Current NWS warning ingestion is explicitly unavailable. The Storm Events bulk catalog and current Alerts integration remain future work.

## Product and integration behavior

- Existing MapLibre map, real footprint source, facility selection, measured-height extrusion, inferred dependency lines, holographic inspector and optional graph debugger are reused.
- Console exposes the one actually loaded region, hypothetical Flood and imported historical Tornado, actual source event selector, and valid modes. Tornado cannot select flood ML. Its source, timestamp, contour rating, preliminary status and reporting limitations are visible.
- Normal results show building and facility geometry-intersection counts. Unsupported population/financial headlines were removed. Tornado inspector identifies a historical NOAA contour, not a hypothetical flood. Operations remain unknown.
- Existing experimental flood hybrid analysis and hypothetical preservation comparison remain available only when explicitly selected. Counterfactuals are disabled for geometry-only analysis and tornadoes.
- Header **DRAGONFLY / Route Intelligence** uses an original geometric SVG. Blank configuration opens a functional “Integration coming soon” panel. Set `DRAGONFLY_URL` to a same-origin route or HTTP(S) game destination, then restart the server. Unsafe schemes, protocol-relative destinations and credentials are rejected. No game, route solver or fake routing metrics were built.
- New adapters/endpoints use the repository's existing **native Node HTTP server**, not Fastify. `/api/hazards` reports real availability, `/api/frontend-config` exposes only safe public settings, and `/api/simulations/run` dispatches by actual scenario and supported mode. Existing normal result URLs also return geometry-only results.

## Validation and Git

Branch: `feature/real-data-tornado-dragonfly`, created from verified frontend commit `6d1cf91`. Remote branch inspection found main/develop at `3ac37d6`; no merge or push was performed. Existing raw OSM/Census working-tree changes were preserved and excluded from the commit.

Final focused command: `node --test test/hazards.test.js test/hazard-api.test.js test/production.test.js test/agent.test.js test/control-center.test.js test/inspector.test.js test/frontend-contract.test.js test/geographic-explorer.test.js test/simulation/engine.test.js` — **40 passed, 0 failed**. `npm run build` passed syntax/static-entrypoint checks and asset build; `git diff --check` passed. This repository is JavaScript, without a separate TypeScript checking step.

The first browser pass found a missing hazard-layer label element. It was corrected and a controller/markup contract test was added. Final browser smoke test against the actual backend on `http://localhost:3061/`: 10,971 buildings loaded; Flood/Tornado selectors reflected actual availability; selecting the 2019 NOAA event disabled experimental flood ML; analysis returned 215 intersecting footprints and 0 intersecting facility points; the original contour rendered on MapLibre and the Hazard extent control navigated to its source extent; unsupported preservation was disabled; the inspector displayed historical-contour exposure and retained inferred relationships; Dragonfly opened the integration panel. No large downloads, model retraining or paid NVIDIA inference occurred. The previous server on 3060 was left untouched; restart it to use the new backend or use the verified 3061 preview.

Changed implementation: `src/hazards/{tornado,exposure,index}.js`, `src/frontend-config.js`, `src/server.js`, `src/agent/agent.js`, `scripts/fetch-tornadoes.js`, `data/hazards/noaa-richardson-2019.geojson`, `frontend/{index.html,app.js,adapter.js,style.css}`, `.env.example`, `package.json`; focused tests in `test/{hazards,hazard-api,frontend-contract}.test.js`; this report.

Remaining requirements: broader bounded Dallas/DFW ingestion and region-by-region coverage verification; more historical official survey/event records; current NWS warning integration with separate warning semantics; historical building inventories and observed damage labels for tornado model development; verified equipment, utility dependencies, operating status, finances, service coverage, shelter capacities and recovery data; the real Dragonfly destination/game integration.
