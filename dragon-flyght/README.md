# Dragonfly AI

Predict. Experience. Mitigate.

A working local hackathon application: React + TypeScript + Three.js flight experience, Python FastAPI, a real trained NOAA impact classifier, graph-based infrastructure propagation, scenario loss and human-needs engines, and a tool-using investigation agent with recorded human approval.

## Run

From this folder:

```sh
./start.sh
```

Open **http://127.0.0.1:5173**. Interactive API docs: **http://127.0.0.1:8000/docs**. Ctrl-C stops both services. Requires Python 3.11+ (built and tested here on 3.14) and Node 20.19+ or 22.12+. Dependencies, a trained model, and historical data have already been installed/generated here. `start.sh` installs missing dependencies on a fresh checkout; internet is needed for that initial setup.

For one server serving the production build:

```sh
./start-production.sh
# http://127.0.0.1:8000
```

Local-only demonstration; no hosted deployment or account setup is required. Bindings are restricted to loopback. There is no production authentication or multi-user isolation. Do not expose this development API to the public internet.

## What works

- Nine connected views: mission overview, flight, model intelligence, data fusion, infrastructure, CBRE business impact, State Farm human impact, NVIDIA Action Center, and comparison.
- 42 seeded synthetic assets, 14 businesses, 77 explicit dependencies, three shelter candidates, six community zones, and 30 fictional assistance requests.
- First-person flight: WASD; Space/Shift altitude; mouse wheel speed; drag to look; optional pointer lock through Engage flight; E nearest asset inspection; F highest-risk focus; R reset; C guided tour; P pause; M map; Tab telemetry while pointer locked; Esc release. Embedded browsers may deny pointer lock; drag-to-look and keyboard flight still work.
- Coherent procedural neighborhood, backend-linked asset selection, particle funnel, risk/dependency vision, normal/warning/impact/aftermath/response phases, graphics quality, optional hover sway, and 2D map fallback.
- Actual serialized scikit-learn inference, real retraining, source record browser, temporal holdout metrics, confusion matrix, majority baseline, and global coefficients.
- Cycle-safe upstream/downstream graph traversal and fixed-point failure propagation. Backup power protects against electrical dependencies, not structural damage or road closure.
- Financial composition and property rankings; shelter eligibility and shortage; service gaps; request severity/status filters and coverage audit.
- Messy CSV and JSON reconciliation with ID/name normalization, deduplication, provenance, and explicit uncertain-match queue. Imports persist reconciliation reports; they deliberately do not overwrite portfolio attributes or auto-accept fuzzy matches.
- Five interventions, separate counterfactual state, immutable baseline, avoided loss and net benefit, real backend recalculation, and shared visual state.
- Deterministic Demo Agent executes the same backend tools, compares intervention combinations, and submits a persisted plan. Approve/reject/revise are recorded in SQLite. Approval changes only the simulated scenario, never real facilities or response operations.
- Optional NVIDIA Nemotron integration uses genuine OpenAI-compatible function/tool calls with bounded rounds and visible tool evidence. It does not predict weather or property loss.
- On-demand NWS alerts/hourly forecasts and Open-Meteo ERA5 historical weather connector, local cache and unavailable/stale statuses. Official alerts remain separate from the hypothetical tornado.
- Downloadable JSON report with scenario, comparison, model metadata and agent evidence.

## NVIDIA configuration

Copy `.env.example` to `.env` and set `NVIDIA_API_KEY`. The backend alone reads the key. `NVIDIA_MODEL` defaults to `nvidia/llama-3.3-nemotron-super-49b-v1.5`; use a tool-capable model available to your NVIDIA account. Restart after changing environment values.

Without a key, the interface explicitly displays **Demo Agent**. Its deterministic templates do not interpret arbitrary language like an LLM, but all visible calls and returned calculations are real. Configured provider errors are shown as unavailable; they are not disguised as successful inference. Live Nemotron inference cannot be verified without credentials.

## Historical data and real ML

Official NOAA Storm Events details files for 2021–2024 were downloaded from:

- [NOAA bulk CSV index](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/)
- [NOAA field documentation](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf)

`data/processed/provenance.json` records each exact source URL, retrieval time, row count and compressed-file SHA-256. The bundled bounded regional subset contains **21,097** observed event records from Texas, Oklahoma, Arkansas and Louisiana: tornado, thunderstorm wind, hail and flash flood.

Blank/unknown damage is excluded rather than labeled zero. Damage K/M/B suffixes are parsed; original event/episode IDs and local civil timestamp plus CZ_TIMEZONE are preserved. Month is extracted without pretending that local NOAA times are UTC. No hourly weather join is claimed.

Target: reported event property damage **≥ $100,000**, configurable via CLI. **17,500** labeled records; **3,597** excluded for missing damage. This threshold is a transparent hackathon choice, not a scientifically validated catastrophe definition.

Features: event type, magnitude, month, latitude and longitude. NOAA magnitude means wind in knots or hail size in inches, not tornado wind speed. Tornado/flash-flood inference uses the learned missing-value imputer. The tornado scenario does not put a hypothetical wind gust in the NOAA magnitude field. The prediction API uses gust/1.852 as an explicitly assumed proxy only for thunderstorm-wind records; rainfall, humidity, pressure and horizon are accepted for interface compatibility but are **not trained features** and are reported as unused.

Training: 2021–2022 (6,743). Validation: 2023 (5,545). Held-out test: 2024 (5,212). Episodes overlapping earlier partitions are removed from later partitions. A preprocessing Pipeline imputes/scales numeric fields and one-hot encodes event types. Logistic regression is fixed in advance and compared with DummyClassifier using the same held-out set. Test data does not select hyperparameters.

Actual held-out results are stored in `models/metadata.json`. At initial training: ROC-AUC ≈ 0.801, PR-AUC ≈ 0.215, Brier ≈ 0.0436, precision ≈ 66.7%, **recall ≈ 0.76% at threshold 0.5**. Accuracy ≈ 94.95% is dominated by imbalance and does not establish reliable detection. Confusion matrix: TN 4,947; FP 1; FN 262; TP 2. Model scores are **uncalibrated**. The UI prominently warns about low recall.

This is **retrospective event-impact modeling**, not weather prediction, operational forecast validation, a calibrated building-failure model, an insurance estimate or an emergency decision system. Reported zero damage is not verified absence of damage. Geographic reporting bias, class imbalance, magnitude missingness and mixed event magnitudes limit the baseline.

Retrain offline on the bundled historical data:

```sh
.venv/bin/python -m backend.ml --threshold 100000
```

Refresh official data and retrain:

```sh
.venv/bin/python -m backend.ml --download
```

Artifacts: `models/impact.joblib`, `models/metadata.json`, `models/training.log`. Only load trusted local joblib artifacts.

## Transparent scenario mathematics

All real estate values, residents, operational records, topology, capacities and assistance requests are **synthetic**, never real person-level or facility availability data.

- Exposure = `exp(-abs(0.75*x - 0.4*z) / 130) * severity`.
- Vulnerability = `(1-roofCondition)*0.5 + (2026-yearBuilt)/150 + 0.15`; roofing counterfactual multiplies by 0.55.
- Assumed asset risk = `min(0.95, exposure*(0.4+0.6*eventScore)*vulnerability)`.
- A seeded uniform sample determines direct scenario failures. Dependency traversal adds operational failures. An event score is not an observed property-level failure probability.
- Expected scenario repair expense = `replacementCost*assetRisk*0.12`. This expense can be nonzero on an asset without sampled failure because it is an expected exposure estimate. Downtime uses the sampled realization.
- Downtime for disrupted assets = `1 + assetRisk*7` days. Revenue at risk = `annualRevenue/365*downtime`. Commercial recovery expense = $5,000 per disrupted revenue-producing asset.
- Total modeled exposure = repairs + revenue at risk + recovery.
- Potential displacement = rounded 65% of occupancy at directly sampled damaged residential assets. Shelter demand = ceiling(70% of displacement).
- Usable shelter capacity requires synthetic verification plus an operational building with road/power dependencies satisfied. Activated capacity remains zero if its facility is disrupted.
- Unmet shelter demand = `max(0,demand-usableCapacity)`.
- Avoided exposure = baseline minus counterfactual. Net benefit subtracts intervention cost.

Restoring power does not reverse structural damage or displacement. Activating a shelter does not make an unsafe building usable. Baselines and intervention outcomes use the same seed and backend rules; the renderer has no independent risk formula. The model-unavailable fallback is explicitly assumption-based.

## Judge walkthrough

1. Mission overview: default severity 78%, seed 1. Explain synthetic assets and the historical baseline.
2. Model intelligence: inspect provenance, temporal holdout and low-recall warning.
3. Data fusion: load messy sample; normalize. 44 input rows → 42 matches, one duplicate and one uncertain name suggestion.
4. Flight: start tornado; Engage flight or use keyboard + drag. Inspect Prairie Pharmacy. Switch dependency vision or use Infrastructure Network.
5. CBRE: inspect loss composition and ranked assets. State Farm: inspect shelter shortage and unassessed requests.
6. Action Center: Investigate. The Demo Agent performs 15 real backend calls including seven intervention previews. Inspect evidence; approve its simulated plan.
7. Comparison: seed 1 substation restoration reduces 39 disrupted assets to 10 and unmet shelter spaces from 95 to 5; displacement stays 135. Avoided exposure ≈ $479,247, cost $45,000, net benefit ≈ $434,247.
8. Return to flight: restored power and updated facility states reflect the same counterfactual. Export the JSON report.

Different seeds produce different outcomes. The example does not guarantee all needs disappear; directly damaged shelters may remain unusable.

## Sources and connector status

| Source | Implemented use | Provenance |
|---|---|---|
| NOAA Storm Events | Download, cleanup, training, inference and bundled regional sample | Observed historical reports |
| [Open-Meteo Historical](https://open-meteo.com/en/docs/historical-weather-api) | Cached ERA5 hourly connector `/api/weather/history?start=2024-05-25&end=2024-05-26` | Reanalysis; not used by this trained baseline |
| [NWS API](https://www.weather.gov/documentation/services-web-api) | On-demand official alerts and discovered hourly forecast URL | Official alerts/current forecasts, never synthetic warnings |
| [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) | Configurable tool-calling Nemotron client | Requires backend key; Demo Agent otherwise |
| [Open-Meteo Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api) | Reference only | No operational forward-validation claim |
| [FEMA NRI](https://hazards.fema.gov/nri/) | Reference only; not ingested | No fabricated risk-index metrics |
| [Census ACS](https://www.census.gov/data/developers/data-sets/acs-5year.html) | Reference only; not ingested | Residents are synthetic, not ACS estimates |

Optional integrations absent from the build specification's broader roadmap are documented instead of represented as connected. No geocoded real buildings, real shelter availability, dispatch, public alert creation, insurance underwriting, authentication, collaboration, physical destruction engine, or production deployment is included.

## Verify

```sh
.venv/bin/python -m pytest -q
(cd frontend && npm run build)
```

The tests exercise parser missingness, seeded determinism, graph cycles, financial reconciliation, shelter eligibility, baseline immutability, model artifact inference, import uncertainty, API validation and the full investigation/revise/reject/approve workflow. See `docs/VERIFICATION.md` for this build's actual checks.

## Layout

- `backend/ml.py`: historical download, cleaning, training, evaluation, inference.
- `backend/data.py`: seeded neighborhood and import reconciliation.
- `backend/engine.py`: asset assumptions, dependency propagation, financial/community effects and comparisons.
- `backend/agent.py`: tools, Demo Agent and NVIDIA orchestration.
- `backend/main.py`: typed REST API, SQLite persistence and optional static frontend serving.
- `backend/services.py`: cached official-weather and historical-weather clients.
- `frontend/src`: React experiences, shared types, flight scene, accessible map and styles.
- `data/raw`: intentionally messy property CSV. `data/processed`: real NOAA subset and labeled synthetic neighborhood.
- `docs/BUILD_SPEC.md`: supplied product specification, retained as a reference.
