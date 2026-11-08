# ResilienceOS — Richardson

Three connected components: source-backed Richardson geography and an evidence-labeled graph; hypothetical flood exposure with XGBoost damage severity and operational screening rules; NVIDIA Nemotron investigation through allowlisted backend tools. The Node application serves the MapLibre frontend and APIs together.

## Run locally

Requires Node 22+ and Python with XGBoost/Pandas installed. The existing trained model artifacts are included; retraining is unnecessary.

```sh
npm install
python3 -m pip install -r ml-training/requirements.txt
PORT=3050 npm start
```

Open http://localhost:3050. `npm start` without `PORT` uses 3030. Production data is loaded from local caches; ordinary requests do not contact geographic providers.

If the geographic caches are absent, acquire them once:

```sh
python3 -m pip install -r scripts/requirements-geography.txt
npm run data:buildings:fetch:large
npm run data:buildings:validate:large
npm run data:pois:fetch
npm run data:census:fetch
```

Copy `.env.example` to `.env` and configure `NVIDIA_API_KEY` for live investigations. Never commit `.env`. A Census API key may be supplied as `CENSUS_API_KEY`; requests otherwise attempt public access. Missing provider/model configuration is reported explicitly.

## Data and coverage

`config/regions.json` is shared by acquisition and runtime. Production uses `richardson-north-central-study`, bbox `[-96.755,32.935,-96.705,32.975]`; this is a study rectangle covering part of Richardson, not a municipal boundary. `richardson-central-test` is the smaller regression area. Legacy `richardson-tx` input remains accepted where documented.

- Buildings: Overture GeoParquet, pinned to the STAC-advertised release. The extractor reads only intersecting STAC partition URLs and filters geographic row groups. It fails on timeout or the 50,000-building safety limit instead of saving a truncated extract. Raw geometry is preserved; normalization rejects invalid/out-of-region records and duplicate IDs. Cache updates are atomic. An in-memory cache is invalidated when the file changes.
- Facilities: observed OSM point records and way centers, acquired through Overpass for the same region. All facilities enter the graph, including unmatched records. `HOSTS` edges are spatially inferred; no private equipment or utility dependencies are asserted. OSM records with the same name remain distinct unless evidence supports reconciliation.
- Population: Census TIGER/Line tract geometry joined to ACS 2022 population and housing counts. Acquisition queries Dallas and Collin Counties, then filters to the study rectangle. This rectangle currently intersects 10 Dallas County tracts and no Collin County tracts. Population exposure uses actual polygon intersection and geodesic area weighting with an explicit uniform-distribution assumption. Full tract populations are not counts of residents inside the study rectangle.

Latest verified local acquisition: 10,973 raw Overture records, 10,971 accepted and 2 rejected outside the study bounds; release `2026-10-21.0`. OSM: 47 facilities. Census: 10 joined tracts. Counts are measured outputs, not application constants. Providers may update them.

Acquired datasets and normalized caches are local artifacts. `.gitignore` excludes new raw/cache files. Some legacy OSM/Census files were already tracked before this work; review their disposition before a future commit. No Git history changes are performed by the application.

## API contracts

- `GET /api/region`: canonical production study area.
- `POST /api/network/build` with `{ "locationId": "richardson-north-central-study" }`, then `GET /api/network`, `/summary`, `/nodes/:id`, `/nodes/:id/dependencies`.
- `GET /api/data/buildings?format=geojson&locationId=richardson-north-central-study&offset=0&limit=2000`: bounded pages with `totalCount`, `returnedCount`, `nextOffset`, provenance and completeness. Continue until `nextOffset` is null. Optional `bbox=west,south,east,north` filters actual polygon intersection. Invalid parameters return HTTP 400. The frontend loads every page.
- `GET /api/data/businesses?format=geojson&locationId=richardson-north-central-study` and `/api/data/census?format=geojson`.
- `POST /api/simulations/run` with `{ "scenarioId":"richardson-flood-demo", "overrides":{"floodDepthFeet":4.5} }`.
- `POST /api/simulations/compare` with a `modification` such as `{ "facilityStatus": { "overture:<actual-id>":"operational" } }`. Both runs use the same production hybrid pipeline. Unsupported economics remain null in comparisons.
- `GET /api/ml/health` verifies Python execution rather than only artifact presence.
- `GET /api/agent/health`, `/tools`; `POST /api/agent/chat`; session and trace routes. Health reports configuration and ML execution; it does not claim live NVIDIA verification. `npm run agent:smoke` performs an actual paid provider/tool investigation.

## Hybrid assessment

Production exposes footprints using Polygon/MultiPolygon intersection, including holes and crossing edges. Facilities use their source coordinates. The model receives the NFIP training feature names: assumed interior `waterDepth` in feet relative to the lowest floor, observed floors when available, and unknown occupancy/foundation/year covariates. Missing numeric values use the training sentinel `-1`; missing Boolean indicators use false, matching training. Height is never substituted for floor count. Python execution has a 30-second bound and output validation.

The trained target is physical damage fraction conditional on historical NFIP insurance claims, not closure probability. For exposed buildings, a damage fraction ≥0.45 yields high operational screening risk, ≥0.18 yields elevated risk, and lower values retain unknown operating status. These thresholds are scenario assumptions, not validated closure thresholds. High/elevated screening can propagate potential interruption through inferred occupancy edges, which remain labeled inferred. Counterfactual preservation overrides the screening status. Python/model failure makes the hybrid run unavailable rather than claiming a rules-only success.

Revenue, recovery duration, shelter capacities, displacement, private equipment and service-demand quantities are unknown in production, so those calculations remain unavailable. The flood polygon and depth are hypothetical. None of the results establish actual closure, safety, or a forecast.

## Explicit fixture demos and verification

Synthetic CSVs and the original deterministic example remain available through `npm run demo` and `npm run simulate`. They use explicit `mode:'demo'`; the normal application and live tools use production. `AGENT_PROVIDER=mock_test` is labeled offline, never live NVIDIA.

```sh
npm test
npm run check
npm run build
npm run agent:smoke
```

`check` validates all JavaScript syntax and the frontend entrypoint. `build` packages the static frontend/MapLibre assets in ignored `dist/`; the application uses the same source files directly. This repository is JavaScript, with no TypeScript compilation configured. Tests cover the original fixture regression, production graph exclusion of synthetic records, complete pagination, polygon exposure, population weighting, actual Python inference, hybrid contribution/failure and counterfactual consistency.

## Attribution

Overture buildings combine sources under the [Overture licensing terms](https://docs.overturemaps.org/attribution/). OSM data © OpenStreetMap contributors (ODbL). Map attribution is preserved. Census data comes from the US Census Bureau; the map basemap uses OpenFreeMap/OpenMapTiles/OpenStreetMap. Acquisition follows [Overture's documented GeoParquet workflow](https://docs.overturemaps.org/getting-data/duckdb/).
