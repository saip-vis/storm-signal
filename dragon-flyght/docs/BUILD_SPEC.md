# CODEX MASTER BUILD SPECIFICATION
## DRAGONFLY AI — Predict. Experience. Mitigate.
### HackUTD 2026 | CBRE + State Farm + NVIDIA Nemotron

You are acting as a senior full-stack engineer, machine-learning engineer, 3D graphics developer, and technical product architect.

Your assignment is to **design, implement, test, and deliver a complete working hackathon application** called **Dragonfly AI**.

The application must look like a sophisticated technology startup product, not a simple class project, but it must prioritize actual functionality over superficial features.

**Do not merely generate a plan, mockup, README, or frontend. Write the application code, install necessary dependencies, configure its development environment, implement the backend and machine-learning pipeline, and test as much as the execution environment allows.**

If a repository already exists, inspect its structure before making changes. Preserve useful code and integrate the new functionality cleanly.

---

# 1. PROJECT VISION

**Dragonfly AI is an AI-powered disaster risk intelligence platform that trains machine-learning models on historical weather and disaster data, predicts the potential impacts of natural disasters on real estate, businesses, infrastructure, and communities, and visualizes those predictions inside a first-person dragonfly flight simulator.**

Users fly through a virtual community as a dragonfly while weather conditions evolve based on selected scenarios.

Buildings, electrical infrastructure, roads, businesses, shelters, and residential neighborhoods can experience simulated consequences that are driven by backend risk assessments and dependency calculations.

The application enables users to:

1. Understand historical and forecast-informed disaster risk.
2. Examine the data used to train predictive models.
3. Run model inference on selected weather scenarios.
4. Fly through predicted outcomes in a virtual neighborhood.
5. Inspect properties and infrastructure during or after the simulated event.
6. Identify cascading failures that affect other facilities.
7. Estimate financial exposure and business interruption.
8. Identify potential human needs and essential-service gaps.
9. Ask NVIDIA Nemotron to investigate the situation using tools.
10. Evaluate preventative and response interventions.
11. Recalculate model outputs under changed conditions.
12. Compare baseline and mitigated outcomes visually and quantitatively.

The most important product principle:

**The 3D simulation must visualize outputs from actual models and backend calculations. It must not invent numerical predictions independently from the predictive system.**

A tornado animation should never be the sole reason a building is classified as damaged. The hazard configuration is an input to the risk engine, and the risk engine determines the modeled outcome that the renderer depicts.

---

# 2. SPONSOR ALIGNMENT

## 2.1 CBRE — Connected Commercial Real Estate Intelligence

Build an operational risk intelligence system that connects fragmented real estate data and predicts negative or positive business outcomes.

Capabilities:

- Import disconnected building, business, maintenance, and infrastructure datasets.
- Normalize inconsistent identifiers and schema formats.
- Resolve duplicate or related properties.
- Construct a connected property and infrastructure graph.
- Identify building dependencies on power, roads, equipment, and services.
- Predict operational disruptions under disaster scenarios.
- Estimate damage-related expenses and revenue at risk.
- Trace cascading infrastructure failures.
- Compare preventative investments.
- Estimate avoided losses, avoided downtime, and net mitigation benefits.

A CBRE judge should see actual data reconciliation, actual dependency traversal, actual model inference, and numerical business-impact calculations.

Do not reduce CBRE functionality to property markers on a map.

## 2.2 State Farm — Catastrophe Response and Overlooked Needs

Build a human-centered disaster response intelligence system.

Capabilities:

- Identify potentially exposed residential areas.
- Estimate displacement under explicitly documented scenarios.
- Calculate potential temporary shelter needs.
- Compare needs against verified available capacity.
- Identify interrupted access to essential services.
- Identify neighborhoods with few accessible alternatives.
- Track synthetic assistance requests.
- Detect areas with unresolved or unassessed needs.
- Recommend possible resource coordination actions.
- Recalculate remaining unmet needs after simulated intervention.

Prioritize life safety and urgent human needs independently of commercial property value.

The system must not assume that restoring a business always resolves a household's immediate needs.

## 2.3 NVIDIA Nemotron — Agentic AI

Use an actual NVIDIA Nemotron model, when credentials permit, to orchestrate meaningful multi-step investigations.

Nemotron should be able to:

- Retrieve simulation information.
- Retrieve model predictions.
- Inspect affected buildings.
- Trace the infrastructure dependency graph.
- Analyze the basis for risk predictions.
- Retrieve business and community impact calculations.
- Identify unresolved needs.
- Investigate alternative interventions.
- Call backend simulation tools.
- Generate evidence-grounded action plans.
- Submit plans for human approval.
- Explain remaining uncertainty.

Nemotron is the investigation and decision-support agent.

**Nemotron must not be falsely represented as the model that predicts weather, nor should it generate unsupported damage probabilities, loss values, or shelter counts.**

The separate trained risk model and deterministic impact algorithms produce those calculations.

---

# 3. TARGET AUDIENCE AND PRODUCT MODES

Target users:

1. Commercial real estate portfolio managers.
2. Property and facilities operations teams.
3. Insurer catastrophe-response coordinators.
4. Community resilience and emergency management coordinators.
5. Residents exploring disaster preparedness through a non-operational demonstration.

Implement four connected experiences.

### Dragonfly Experience
Immersive exploration of model-driven disaster scenarios.

### CBRE Intelligence
Property risk, operational disruption, financial impacts, dependency tracing, and mitigation.

### State Farm Response
Human exposure, assistance requests, shelter capacity, essential-service disruption, and overlooked-needs analysis.

### NVIDIA Action Center
Agent investigations, tool execution, proposed interventions, and human review.

All experiences must use the same underlying scenario and model outputs.

---

# 4. RECOMMENDED TECH STACK

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Lucide icons
- Zustand
- Recharts
- React Flow

## 3D Engine

- Three.js
- React Three Fiber
- @react-three/drei
- @react-three/postprocessing, when appropriate
- Optional lightweight particle effects and audio

## Machine Learning

- Python 3.11+
- pandas
- NumPy
- scikit-learn
- XGBoost if installation and dataset size permit
- joblib for model serialization
- matplotlib for saved evaluation plots if useful
- pytest for model and preprocessing tests

## Backend

Use Python FastAPI for training, inference, and simulation APIs.

If separate TypeScript backend functionality is necessary, use a lightweight Node server, but avoid duplicating business logic unnecessarily.

Recommended architecture:

**React frontend → FastAPI backend → ML inference + dependency graph + impact calculations → NVIDIA agent**

## Data storage

- SQLite for sample properties, scenarios, incidents, relationships, plans, and audit records.
- Local CSV/Parquet files for training data.
- Serialized scikit-learn pipelines for inference.
- JSON files for deterministic sample scenarios.

A graph database is unnecessary for the MVP. Use adjacency lists or NetworkX for traversal.

## Infrastructure

- Environment variables for API keys.
- REST endpoints.
- Local caching for external weather services.
- Clear error handling and offline mode.
- One-command development startup if possible.

---

# 5. DATA SOURCES — REAL DATA FIRST, SYNTHETIC DATA WHERE NECESSARY

The application must make a clear distinction between:

- Observed historical data.
- Historical weather reanalysis or model output.
- Historical forecasts.
- Current forecasts.
- Official issued warnings.
- Synthetic buildings and operational data.
- Scenario assumptions.
- Trained-model predictions.
- Deterministic downstream impact estimates.

Store source type and provenance with every record.

## 5.1 NOAA Storm Events Database

Official source:

https://www.ncei.noaa.gov/access/storm-events-database/

Purpose:

Historical severe-weather events and reported consequences.

Use downloadable NOAA bulk CSV data where available.

Potential fields:

- BEGIN_DATE_TIME
- END_DATE_TIME
- EVENT_TYPE
- STATE
- CZ_NAME
- BEGIN_LAT
- BEGIN_LON
- END_LAT
- END_LON
- MAGNITUDE
- TOR_F_SCALE
- DAMAGE_PROPERTY
- DAMAGE_CROPS
- INJURIES_DIRECT
- DEATHS_DIRECT
- EPISODE_ID
- EVENT_ID
- EVENT_NARRATIVE

Inspect actual field documentation and available files before hardcoding schema assumptions.

Implement data processing that:

- Loads a bounded subset of historical storm records.
- Standardizes event names.
- Converts damage strings with K/M/B suffixes into numerical values.
- Handles missing coordinates and severity.
- Converts timestamps consistently.
- Removes duplicates.
- Reports missingness.
- Distinguishes zero recorded damage from missing or unknown damage.
- Preserves original source and record IDs.

Do not interpret every event without reported damage as proof that no damage occurred.

Prefer a manageable Texas and nearby-region dataset for the MVP, but expand geographically if there are insufficient examples for training.

## 5.2 Open-Meteo Historical Weather

Documentation:

https://open-meteo.com/en/docs/historical-weather-api

Historical API:

https://archive-api.open-meteo.com/v1/archive

Purpose:

Weather features corresponding to historical events and comparison periods.

Useful features:

- temperature_2m
- relative_humidity_2m
- precipitation
- rain
- wind_speed_10m
- wind_gusts_10m, when supported by the selected dataset
- wind_direction_10m
- pressure_msl
- cloud_cover
- weather_code

Example query structure:

GET /v1/archive

Parameters:

latitude
longitude
start_date
end_date
hourly
timezone

Construct valid queries using the current API documentation.

Check parameter availability for the selected weather model before making calls.

Implement:

- A client with retries and timeout handling.
- A local response cache.
- Weather-feature aggregation.
- Timestamp alignment.
- Unit normalization.
- Missing-value handling.

Potential engineered features:

- Maximum wind gust in the event window.
- Maximum sustained wind speed.
- Total precipitation in 6, 12, and 24 hours.
- Pressure minimum.
- Pressure change.
- Maximum hourly precipitation.
- Temperature.
- Humidity.
- Recent rainfall accumulation.

Important: Reanalysis grid-cell weather does not represent a tornado's exact localized wind speed. Do not treat coarse weather values as precise tornado intensity measurements.

## 5.3 Open-Meteo Historical Forecasts

Documentation:

https://open-meteo.com/en/docs/historical-forecast-api

Historical forecast API:

https://historical-forecast-api.open-meteo.com/v1/forecast

Purpose:

Support a more realistic forward-looking prediction experiment.

When possible, train or evaluate models using weather predictions that would have been available before the event rather than only the weather actually observed afterward.

This is important because a prediction model evaluated using information unavailable at prediction time may show misleading performance.

Distinguish:

- Historical observed/reanalysis weather.
- Historical forecasts.
- Current forecasts.

If archived forecasts are unavailable for a particular event, mark the experiment as retrospective impact modeling.

Do not label it operational forecast validation.

## 5.4 National Weather Service API

Documentation:

https://www.weather.gov/documentation/services-web-api

API base:

https://api.weather.gov

Relevant endpoints:

GET /alerts/active
GET /alerts/active?area=TX
GET /alerts/active?point={latitude},{longitude}
GET /points/{latitude},{longitude}

Use the returned forecast and forecastHourly URLs from the point response instead of constructing unsupported forecast URLs.

Use an application-identifying User-Agent header.

Implement:

- Fetch current official alerts.
- Fetch hourly forecasts.
- Display issuance and expiration timestamps.
- Cache forecasts.
- Handle missing warnings.
- Show API status.
- Distinguish official warning text from AI-generated risk commentary.

Do not poll the alert API more frequently than the service recommends.

IMPORTANT:

If the active alert API shows no tornado warning, do not invent one.

Use a separate historical/simulated disaster mode with a clear fictional-scenario label.

## 5.5 FEMA National Risk Index

Documentation and data source:

https://hazards.fema.gov/nri/

Purpose:

Geographic baseline risk and community resilience features.

Potential categories:

- Tornado risk.
- Strong-wind risk.
- Flood risk.
- Expected annual loss.
- Social vulnerability.
- Community resilience.

Retrieve official county or census-tract data if possible.

Document:

- Geography.
- Observation year.
- Variable meaning.
- Whether a metric is a score, index, rate, or financial estimate.

Do not equate FEMA expected annual loss with loss from a single simulated tornado.

FEMA risk metrics should generally function as contextual or longer-term vulnerability features rather than precise event-specific damage labels.

## 5.6 US Census Bureau ACS

Documentation:

https://www.census.gov/data/developers/data-sets/acs-5year.html

Use tract-level or other appropriate geographic estimates for:

- Population.
- Household counts.
- Residential occupancy.
- Housing characteristics.
- Vehicle availability.
- Broad community vulnerability indicators.

Example variables to investigate:

- B01003_001E — population
- B25001_001E — housing units
- B08201 — household vehicle availability table

Verify variable availability and geography before implementing.

The latest applicable releases, access requirements, and API keys should be checked at implementation time.

Never turn neighborhood-level demographic information into assumptions about identifiable individuals.

## 5.7 Geographic and Building Data

Optional:

- OpenStreetMap
- Overpass API
- Public geographic boundaries
- Local government open-data portals

Use geographic data to support location, street layout, building footprints, and neighborhood structure.

Do not assume publicly mapped buildings contain reliable market valuations, maintenance records, power dependencies, shelter occupancy, or real-time operational conditions.

Generate clearly labeled synthetic data for those attributes.

Do not aggressively scrape commercial property platforms.

## 5.8 Synthetic Portfolio and Infrastructure Data

Generate realistic and internally consistent demo records:

- 35–50 buildings.
- 10–15 businesses.
- 3–5 essential-service locations.
- 2–3 shelter candidates.
- 2–4 utility assets.
- Several roads or access connections.
- 4–6 residential/community zones.
- 20–40 synthetic assistance requests.
- 50+ explicit network relationships.

Include multiple asset classes:

- Offices.
- Apartments.
- Houses.
- Retail.
- Pharmacy.
- Grocery.
- Community center.
- Clinic.
- Shelter.
- Electrical substation.
- Telecommunications facility.

Fields for buildings:

id
name
latitude
longitude
worldX
worldZ
buildingType
yearBuilt
constructionClass
roofType
roofCondition
maintenanceScore
replacementCost
marketValue
annualRevenue
occupantCapacity
criticality
backupPower
floodProtection
windProtection
operationalStatus
source
isSynthetic

Fields for infrastructure:

id
type
capacity
connectedNodeIds
backupAvailability
operationalStatus
failureThreshold
location
source
isSynthetic

Fields for businesses:

id
buildingId
businessType
annualRevenue
dailyRevenue
employees
serviceCapacity
criticalServiceType
downtimeCostPerDay
recoveryCost
source
isSynthetic

Fields for community resources:

id
resourceType
totalCapacity
confirmedAvailableCapacity
accessibility
verificationStatus
operatorApprovalRequired
roadAccess
serviceArea
source
isSynthetic

Include intentionally messy CSVs with mismatched building IDs, inconsistent naming, and missing fields to demonstrate the CBRE data integration challenge.

Provide both the raw CSVs and the normalized records.

---

# 6. MACHINE LEARNING — THE MOST IMPORTANT PART

Machine learning must be a real implementation, not decorative UI.

Build an executable Python training pipeline that:

1. Downloads or loads historical data.
2. Validates and cleans records.
3. Creates labels using documented rules.
4. Extracts relevant weather and event features.
5. Constructs training examples.
6. Splits training and test data appropriately.
7. Trains at least one baseline model.
8. Evaluates performance on genuinely held-out data.
9. Persists the trained model and preprocessing pipeline.
10. Exposes real inference through the backend.
11. Feeds inference results into the simulation.
12. Displays prediction provenance and uncertainty.

## 6.1 Choose a defensible prediction target

Primary suggested model:

**Severe Weather Impact Classifier**

Predict a clearly defined outcome such as whether a reported severe-weather event was associated with significant recorded property damage.

Example label:

significantDamage = 1 if reported property damage exceeds a documented threshold.

The threshold must be configurable and chosen based on dataset inspection.

Alternative:

Train a severity or loss-band classifier using categories defined from real historical data.

Possible classes:

- Low reported damage.
- Moderate reported damage.
- High reported damage.

Avoid pretending event-level storm damage is an observed label for individual building failure.

Those are different prediction tasks.

For the MVP, it is acceptable to train an event-level impact model and combine it with an explicitly assumption-based building vulnerability model.

## 6.2 Optional building operational disruption model

If real labeled building-level failure data is available, train a separate operational disruption classifier.

Inputs could include:

- Weather intensity.
- Building age.
- Construction type.
- Roof condition.
- Backup power.
- Maintenance score.
- Infrastructure dependency exposure.
- Historical operational incidents.

Target:

Actual observed building operational failure.

If no appropriate labels exist, do NOT train a model on synthetic failure outcomes and call it real-world validated prediction.

Instead, implement a transparent building vulnerability and disruption scenario model with clearly identified assumptions.

## 6.3 Feature engineering

Weather features:

- Maximum wind gust.
- Maximum wind speed.
- Rainfall accumulation.
- Peak hourly rainfall.
- Pressure.
- Temperature.
- Relative humidity.
- Severe-weather event type.
- Recorded event magnitude.
- Seasonal features.
- Geographic context.

Important distinction:

Do not include features such as final storm magnitude, post-event damage observations, or reported post-event road closures in a model intended to predict ahead of time unless those values are actually known at the intended prediction horizon.

Asset features:

- Building age.
- Construction category.
- Roof type.
- Maintenance score.
- Backup power.
- Exposure.
- Hazard protections.

Network features:

- Upstream dependencies.
- Number of critical downstream services.
- Number of alternative providers.
- Facility redundancy.
- Centrality or dependency count.

For disaster preparedness, only use network characteristics known before the disaster.

## 6.4 Training algorithms

Implement:

Model A:
- DummyClassifier or simple majority-class baseline.

Model B:
- Logistic Regression or Random Forest Classifier.

Model C, optional:
- XGBoost Classifier.

Compare model results using a consistent held-out split.

Use a scikit-learn Pipeline or ColumnTransformer for preprocessing.

Save the selected trained model using joblib.

Use fixed random seeds where appropriate for reproducibility.

## 6.5 Data splitting and leakage prevention

Do not use a naive random split across adjacent timestamps and nearby events if they share weather conditions or disaster identifiers.

Prefer:

- Train on earlier years.
- Validate on later historical years.
- Test on the latest held-out period.

Group records by event when applicable.

Avoid including multiple rows from the same storm in different evaluation splits.

For spatial generalization, optionally hold out selected counties or regions.

Never use the test set to choose features or tune the model.

## 6.6 Evaluation metrics

For classification, calculate:

- Accuracy.
- Precision.
- Recall.
- F1-score.
- ROC-AUC when valid.
- PR-AUC when useful.
- Confusion matrix.
- Class distribution.
- Probability calibration metrics such as Brier score.
- Baseline comparison.

For imbalanced classes, emphasize recall, precision, and PR-AUC rather than accuracy alone.

If outputs are called probabilities, evaluate calibration or make clear that they are uncalibrated model scores.

If performance is poor, display that honestly and use the model as an experimental decision-support component.

Never invent accuracy metrics.

## 6.7 Training UI

Create a **Model Intelligence** dashboard displaying:

- Dataset sources.
- Number of training examples.
- Training time.
- Model family.
- Available feature names.
- Training/validation/test split.
- Real evaluation metrics.
- Confusion matrix.
- Feature importance or permutation importance.
- Model version.
- Artifact timestamp.
- Data limitations.

Include a Train Model button that triggers a real training job or documented local retraining process.

Display success only when training completes and artifacts are saved.

Provide a small bundled training sample or pre-trained baseline for offline demonstration.

Do not mislabel a model trained entirely on synthetic labels as validated on historical real-world outcomes.

## 6.8 Risk inference endpoint

Implement:

POST /api/ml/predict

Example request:

{
  "weather": {
    "windGustKmh": 120,
    "precipitationMm": 45,
    "pressureHpa": 995,
    "humidityPercent": 80
  },
  "eventType": "severe_wind",
  "location": {
    "latitude": 32.95,
    "longitude": -96.73
  },
  "predictionHorizonHours": 6
}

Example response structure:

{
  "prediction": {
    "riskScore": 0.78,
    "riskLabel": "high"
  },
  "modelVersion": "model-version",
  "modelSource": "trained-historical",
  "calibrated": false,
  "modelLimitations": [],
  "featureContributions": [],
  "timestamp": "ISO-8601"
}

The numerical value above is only an interface example. Never hardcode it as an actual inference result.

The risk score is an event-level model output unless a separately validated property-level model exists.

## 6.9 Inference consistency

The frontend must never recreate the model formula independently.

It should call the backend and use the returned predictions.

If model inference fails:

- Show a clear model unavailable status.
- Allow deterministic demonstration scenarios.
- Label their values as assumptions or sample estimates.

Do not silently return fabricated probabilities under a real model label.

---

# 7. CASCADING INFRASTRUCTURE DEPENDENCY MODEL

Build a functioning directed graph.

Nodes:

- Building.
- Business.
- Equipment.
- Power source.
- Road.
- Shelter.
- Neighborhood.
- Essential service.
- Community resource.

Edges:

- DEPENDS_ON.
- POWERED_BY.
- LOCATED_IN.
- OPERATES_AT.
- SERVES_AREA.
- PROVIDES_SERVICE.
- ACCESSIBLE_VIA.
- HAS_EQUIPMENT.
- CAN_PROVIDE_SHELTER.

Each relationship should contain:

sourceId
targetId
relationshipType
confidence
evidenceSource
assumptionFlag

Implement actual graph traversal.

Important functions:

buildDependencyGraph()
getNode()
getNeighbors()
traceUpstreamDependencies()
traceDownstreamDependencies()
propagateFailures()
getCriticalDependencies()
getAlternativeResources()

Use explicit rules for dependency propagation.

Examples:

- A building that depends on a failed power source may become operationally disrupted.
- Backup power may prevent or reduce the disruption.
- A pharmacy in an unavailable building loses modeled service capacity.
- A shelter in an unsafe or inaccessible building cannot be counted as available until verified.
- A blocked road may reduce access to nearby facilities.
- A neighborhood's medication service access may be reduced if its only reachable pharmacy closes.

Avoid infinite loops in cyclic dependencies.

Distinguish:

- Observed failure.
- Predicted failure.
- Simulated failure.
- Verified recovery.

Do not equate high disruption probability with guaranteed facility failure.

For visualization, a user-selected sampled scenario may convert model probabilities into specific outcomes using a seeded random generator. That sample must be labeled as one possible realization.

Alternatively, allow the user to visualize expected risk without sampling a specific failure.

---

# 8. BUSINESS IMPACT ENGINE — CBRE

Implement a financial engine driven by predicted or simulated operational disruptions.

Inputs:

- Building replacement cost.
- Property value.
- Business revenue.
- Daily operating revenue.
- Downtime duration.
- Estimated repair expense.
- Facility vulnerability.
- Service interruptions.
- Mitigation cost.

Outputs:

- Potential structural repair cost.
- Revenue exposure.
- Operational downtime.
- Extra recovery expense.
- Total modeled business impact.
- Estimated avoided loss.
- Net mitigation benefit.

Example deterministic formulas:

revenueAtRisk = dailyRevenue * downtimeDays

totalModeledLoss = repairExpense + revenueAtRisk + extraRecoveryExpense

avoidedLoss = baselineLoss - mitigatedLoss

netBenefit = avoidedLoss - mitigationCost

Clearly label these as scenario-based calculations.

The actual loss of revenue may differ from revenue at risk because of recoverable operations, variable expenses, insurance, and other business conditions.

Show negative and positive business outcomes.

Create:

- Portfolio risk rankings.
- Financial impact bar charts.
- Property inspection pages.
- Model explanation cards.
- Before-and-after comparisons.
- Risk mitigation investment suggestions.

Connect every calculation to a real backend endpoint.

---

# 9. COMMUNITY IMPACT ENGINE — STATE FARM

Implement direct and indirect human-impact assessments.

## Direct effects

- Estimated exposed residential population.
- Simulated damage to homes.
- Potential displacement.
- Temporary shelter demand.
- Assistance requests.
- Transportation disruption.

## Indirect effects

- Reduced pharmacy access.
- Food service interruption.
- Shelter capacity shortages.
- Road accessibility issues.
- Multiple simultaneous essential-service failures.
- Unassessed neighborhoods.

Build a dedicated Unmet Needs Engine.

Example:

Residents with potential shelter need: 240

Verified available shelter spaces: 150

Unmet shelter spaces: 90

These are synthetic demonstration values.

Implementation must calculate the shortage dynamically.

Use:

unmetShelterDemand = max(0, estimatedDemand - verifiedUsableCapacity)

If additional capacity is activated through an approved simulated intervention, the shortage must be recomputed.

A facility that appears nearby must not automatically be considered safe, available, accessible, or authorized.

Create:

- Community needs dashboard.
- Assistance request queue.
- Needs severity and status filters.
- Shelter capacity overview.
- Essential-service accessibility graph.
- Coverage audit.
- Resource matching and proposed interventions.

AI must not infer that specific residents have medical conditions or disabilities from aggregate census demographics.

Use fictional household records for the demonstration.

---

# 10. DRAGONFLY FIRST-PERSON EXPERIENCE

This is the signature user experience and must be visibly impressive while remaining connected to the prediction engine.

## 10.1 Perspective

The player is a dragonfly flying through a simulated city.

The camera must be first-person, as though the user is seeing through the dragonfly's eyes.

Do not make a conventional third-person character-following camera the default.

Design elements:

- Slight stereoscopic/insect-inspired feeling without causing severe distortion.
- Subtle translucent wing silhouettes at screen edges.
- Optional gentle wingbeat audio.
- Hover animation.
- Smooth camera banking.
- Speed-responsive motion.
- Minimal reticle.
- Subtle motion blur only if performance allows.
- Cinematic sky and environmental lighting.

Provide a toggle to disable camera sway or motion effects.

## 10.2 Controls

Desktop:

W: Forward

S: Backward

A: Strafe left

D: Strafe right

Mouse movement: Look around

Space: Ascend

Shift: Descend

Mouse wheel: Adjust speed

E: Inspect selected facility

F: Focus nearest risk

M: Toggle overview map

Tab: Toggle intelligence panel

R: Reset flight position

Esc: Release mouse pointer

C: Toggle cinematic camera

P: Pause/resume simulation

Add on-screen control hints, flight tutorial, and a guided autopilot tour.

Ensure interactive dashboards remain usable when pointer lock is released.

## 10.3 Flight physics

Implement:

- Smooth acceleration.
- Velocity damping.
- Hover stabilization.
- Vertical movement.
- Camera banking.
- Sensible speed limits.
- World boundaries.
- Collision avoidance or soft collision.
- Smooth transition to inspection views.

Use delta-time updates.

Keep player controls separate from world simulation logic.

## 10.4 World

Create a compact, fictionalized Richardson-area neighborhood.

Include:

- Apartment complex.
- Commercial offices.
- Grocery store.
- Pharmacy.
- Community center.
- Shelter.
- Clinic.
- Substation.
- Roads.
- Homes.
- Power lines.
- Trees.
- Streetlights.
- Signs.
- Parks or open areas.

At least 15–20 important buildings should be inspectable.

All important buildings must map to entities in the backend database.

The 3D coordinates and analytical entity IDs must remain synchronized.

## 10.5 World appearance

Aim for polished, optimized, stylized realism.

Normal phase:

- Blue sky.
- Sunlight.
- Light wind.
- Trees moving gently.
- Normal lighting.
- Functioning buildings.
- Active businesses.

Warning phase:

- Clouds darken.
- Wind increases.
- Atmospheric haze.
- Warning interface appears.
- Weather risk overlays update.

Impact phase:

- Tornado funnel.
- Strong wind effects.
- Debris particles.
- Rain.
- Camera vibration, optional and limited.
- Buildings changing condition.
- Power failures.
- Electrical sparks, where appropriate.
- Streetlights turning off.
- Roads becoming blocked.
- Affected facilities highlighted.

Aftermath phase:

- Storm recedes.
- Damaged structures remain marked.
- Utility failures remain visible.
- Closed buildings display status indicators.
- Infrastructure connections can be revealed.

Mitigation phase:

- Approved interventions are simulated.
- Repaired or restored infrastructure changes status.
- Lighting and building indicators update.
- Financial and community impact metrics recalculate.

Do not build a physically accurate tornado model.

The visual effects are an illustrative rendering of a risk scenario, not a scientific atmospheric simulation.

## 10.6 Storm visualization

Use efficient procedural techniques:

- Particle-based funnel.
- Rotating spiral particle motion.
- Cloud sprites or procedural clouds.
- Fog and atmospheric tint.
- Wind-influenced tree animation.
- Lightweight rain particles.
- Debris particles.
- Lighting transitions.

Use seeded randomness so the same scenario can be replayed.

Avoid expensive rigid-body destruction and excessive particle counts.

Implement graphics presets:

- Low.
- Medium.
- High.

Target smooth performance on an ordinary laptop.

## 10.7 Model-driven building visualization

This is non-negotiable.

Building condition must derive from backend scenario outputs.

Map risk and state to visuals:

Low modeled risk:
- Normal appearance.
- Small green status indicator.

Moderate modeled risk:
- Amber overlay.
- Inspection suggestion.

High modeled risk:
- Red risk overlay.
- Possible disruption indicators.

Simulated disruption:
- Windows darken.
- Facility status changes.
- Relevant visual effects appear.

Confirmed simulated restoration:
- Infrastructure status changes.
- Building condition updates.
- Service availability updates.

High-risk predictions must not automatically be displayed as confirmed destruction.

## 10.8 Building inspection

When hovering near a building:

- Highlight the structure.
- Show its name and basic classification.
- Display a contextual interaction prompt.

Press E:

Open a detailed property intelligence overlay containing:

- Building ID.
- Building type.
- Location.
- Market value.
- Replacement cost.
- Maintenance status.
- Operational dependencies.
- Hazard exposure.
- Model risk score.
- Model version.
- Predicted impact category.
- Estimated business interruption.
- Current scenario status.
- Community services provided.
- Upstream dependencies.
- Downstream consequences.
- Recommended mitigation actions.
- Data provenance and assumptions.

Allow the player to trace connections from the selected building to dependent infrastructure.

## 10.9 Dragonfly analytical vision modes

Implement three visual modes.

**Normal Vision**
Natural 3D world with minimal labels.

**Risk Vision**
Buildings color-coded by model-predicted risk.

**Dependency Vision**
Glowing connections between facilities, utilities, businesses, and services.

Optional:

**Human Impact Vision**
Highlights neighborhoods with unmet needs, interrupted services, and assistance requests.

Switching modes should not restart the scenario.

## 10.10 Prediction comparison

Create:

- Baseline scenario.
- Mitigated scenario.

Users can switch between them or view synchronized before/after analytics.

The backend should calculate both.

Do not simply recolor buildings manually when the user selects mitigation.

---

# 11. SCENARIO DESIGN

Primary scenario:

**Simulated Richardson Tornado**

This is a hypothetical event, not a current real-world tornado warning.

Initial conditions:

- Mixed commercial and residential neighborhood.
- 240 simulated residents potentially requiring shelter.
- 150 verified synthetic shelter spaces.
- Four facilities disrupted in the sample baseline.
- Two essential-service categories affected.

Sequence:

1. Dragonfly flies over the functioning city.
2. User activates tornado scenario.
3. The weather-risk model produces a prediction.
4. The impact engine evaluates buildings.
5. The dependency engine traces cascading disruptions.
6. The tornado animation begins.
7. Assets visibly transition according to scenario state.
8. Power infrastructure becomes unavailable in the selected scenario.
9. A pharmacy experiences service disruption.
10. A community center loses usable shelter capacity pending inspection.
11. The State Farm dashboard calculates unmet needs.
12. The CBRE dashboard calculates operational losses.
13. Nemotron investigates the failures.
14. Nemotron proposes interventions.
15. A human reviewer approves an eligible simulated intervention.
16. Backend calculations rerun.
17. Dragonfly shows the changed outcome.
18. Final comparison displays financial impact and remaining human needs.

Optional future disasters:

- Flood.
- Hurricane.
- Hail.
- Wildfire.
- Extreme heat.

Keep tornado as the fully implemented MVP.

---

# 12. NVIDIA NEMOTRON INTEGRATION

Use official NVIDIA API documentation:

https://docs.api.nvidia.com/nim/reference/llm-apis

API base:

https://integrate.api.nvidia.com

Chat endpoint:

POST /v1/chat/completions

Choose a supported Nemotron model that provides tool/function calling.

Make the model identifier configurable with:

NVIDIA_MODEL

Authentication:

NVIDIA_API_KEY

Store the key only on the backend.

Never embed API keys in frontend code.

Implement actual function/tool calls rather than pretending the agent called tools.

## Agent tools

getScenario(scenarioId)

getModelMetadata()

getPrediction(assetId, scenarioId)

getPredictionDrivers(assetId, scenarioId)

getGraphNode(nodeId)

traceDependencies(nodeId)

getAffectedBuildings(scenarioId)

runImpactAnalysis(scenarioId)

calculateBusinessImpact(scenarioId)

calculateCommunityNeeds(scenarioId)

findAlternativeResources(scenarioId)

getAvailableInterventions(scenarioId)

simulateIntervention(scenarioId, interventionId)

submitPlanForApproval(plan)

Each tool must call an actual backend function.

## Agent investigation workflow

Example prompt:

"Which failures will create the largest financial and community consequences in this tornado scenario, and which interventions should we prioritize?"

Agent should:

1. Retrieve the scenario.
2. Read relevant model predictions.
3. Inspect critical facilities.
4. Trace upstream and downstream dependencies.
5. Retrieve business impact.
6. Retrieve human needs.
7. Compare eligible interventions.
8. Run intervention simulations.
9. Generate an evidence-grounded plan.
10. Submit plan for human review.

Log all tool calls.

Expose the execution trace in the UI.

Avoid unsupported numerical claims.

## Structured response plan

Fields:

planId
scenarioId
summary
identifiedRisks
supportingEvidence
modelReferences
proposedActions
requiredResources
responsibleOrganizations
expectedOutcomes
remainingUnmetNeeds
uncertainties
approvalStatus
createdAt

## Human approval

Allow:

- Approve.
- Reject.
- Revise.
- Simulate.

Do not allow the model to independently trigger real emergency dispatch, evacuation instructions, facility reopening, or public safety decisions.

## Fallback mode

If NVIDIA API credentials are unavailable:

- Create a clearly labeled Demo Agent.
- Have it call the same backend tools.
- Use deterministic explanation templates.
- Show the real calculations.
- Never imply the demo agent is actual Nemotron inference.

The user must be able to identify whether Nemotron is connected.

---

# 13. RISK MITIGATION AND RE-SIMULATION

Build an intervention engine that modifies scenario inputs or infrastructure state and recalculates consequences.

Interventions:

- Install or activate backup power.
- Reinforce roofing in a hypothetical preparedness scenario.
- Add verified synthetic shelter capacity.
- Repair or reopen a road after simulated verification.
- Restore an electrical connection.
- Coordinate an alternative medication-service location.
- Provide transportation assistance through approved simulated resources.

Intervention schema:

id
scenarioId
targetNodeId
actionType
description
estimatedCost
requiredResources
eligibilityConditions
verificationRequirements
approvalRequired
expectedEffect
status

For an intervention:

1. Validate prerequisites.
2. Create a proposed change.
3. Run a hypothetical comparison without modifying the baseline.
4. Show cost and estimated consequences.
5. Require human approval.
6. Apply the change to a separate simulated scenario state.
7. Recompute affected predictions or impact calculations.
8. Update graph states.
9. Update financial impact.
10. Update community unmet needs.
11. Update 3D rendering.
12. Preserve the original scenario for comparison.

Never claim that a historical tornado is prevented by an intervention.

The intervention mitigates consequences; it does not alter the actual weather event.

---

# 14. APPLICATION PAGES

Create a polished multi-page interface.

## Page 1: Landing Experience

- Cinematic 3D dragonfly preview.
- Product name and tagline.
- Start Flight button.
- Explore Risk Intelligence button.
- Run Richardson Tornado button.
- Sponsor technology overview.
- Clear simulated-demo indicator.

Tagline:

"Predict the Impact. Experience the Consequences. Prevent the Next Failure."

## Page 2: Flight Simulator

- Full-screen first-person 3D scene.
- Flight HUD.
- Weather status.
- Current risk level.
- Simulation controls.
- Building inspection.
- Vision modes.
- Quick access to analytics.
- Risk legend.
- Scenario phase.

## Page 3: Model Intelligence

- Dataset browser.
- Training pipeline.
- Train/retrain control.
- Model comparison.
- Evaluation metrics.
- Confusion matrix.
- Feature importance.
- Model limitations.
- Model artifact status.

## Page 4: Data Fusion Center

- Upload CSV or JSON.
- Data previews.
- Normalize columns.
- Match entities.
- Review uncertain matches.
- Show provenance.
- Build dependency graph.
- Display data-quality summary.

## Page 5: Infrastructure Network

- React Flow graph.
- Node classifications.
- Dependency tracing.
- Cascading failure highlighting.
- Upstream/downstream inspection.
- Criticality metrics.
- Scenario-status comparison.

## Page 6: CBRE Business Impact

- Portfolio financial exposure.
- Risk-ranked properties.
- Building damage estimates.
- Revenue at risk.
- Operational downtime.
- Recovery costs.
- Financial impact charts.
- Mitigation comparison.

## Page 7: State Farm Human Impact

- Estimated people exposed.
- Potential displacement.
- Shelter demand.
- Verified capacity.
- Unmet shelter shortage.
- Assistance request queue.
- Essential-service gaps.
- Coverage audit.
- Resource matching.
- Human-review workflow.

## Page 8: Nemotron Action Center

- Agent chat.
- Connected model status.
- Available tools.
- Tool execution timeline.
- Prediction evidence.
- Investigation report.
- Proposed plans.
- Approval workflow.
- Intervention simulation.
- Remaining risks.

## Page 9: Scenario Comparison

- Before/after risk metrics.
- Total modeled losses.
- Avoided losses.
- Mitigation costs.
- Operational restoration.
- Shelter shortfall.
- Unresolved service interruptions.
- Explanation of model assumptions.

---

# 15. UI DESIGN DIRECTION

Aesthetic:

Professional disaster intelligence SaaS meets cinematic environmental exploration.

Not a generic admin template.

Visual styling:

- Dark navy / near-black foundation.
- Cyan for analytical information.
- Amber for caution.
- Red for critical simulated impacts.
- Green for mitigated/restored state.
- Transparent glass panels.
- Large geographic and 3D visuals.
- Beautiful typography.
- Smooth transitions.
- Highly readable charts.
- Precise numerical formatting.

Navigation:

- Compact left sidebar for dashboards.
- Floating HUD in Dragonfly mode.
- Right-side contextual inspection panels.
- Bottom scenario timeline.
- Top-level mode switcher.

Avoid visual clutter during flight.

Use consistent, understandable status labels:

- Historical.
- Official Alert.
- Forecast.
- Model Prediction.
- Simulated Outcome.
- Unverified.
- Approved.
- Restored.

Do not show a real-time or live badge for synthetic event data.

---

# 16. DATABASE AND SHARED TYPES

Define common types before parallel development.

Core entities:

WeatherObservation
WeatherForecast
HistoricalStormEvent
ModelArtifact
ModelPrediction
Asset
Business
InfrastructureNode
NetworkEdge
CommunityZone
Shelter
AssistanceRequest
DisasterScenario
ScenarioOutcome
FinancialImpact
CommunityImpact
MitigationAction
AgentToolCall
ResponsePlan
AuditRecord

Every important entity should have a stable ID.

Example scenario:

type DisasterScenario = {
  id: string;
  name: string;
  eventType: string;
  startTime: string;
  sourceType: "historical" | "forecast" | "simulated";
  phase: "normal" | "warning" | "impact" | "aftermath" | "response";
  severity: number;
  hazardGeometry: unknown;
  randomSeed: number;
  modelVersion: string | null;
  assumptions: string[];
};

Example predicted assessment:

type RiskAssessment = {
  assetId: string;
  scenarioId: string;
  modelVersion: string | null;
  predictionType: string;
  riskScore: number | null;
  riskBand: "low" | "moderate" | "high" | "unknown";
  predictionSource: string;
  uncertainty: string[];
  evidence: string[];
  timestamp: string;
};

Do not add artificial model confidence scores that lack a statistical meaning.

Ensure scenario results are serialized and safely returned to the frontend.

---

# 17. BACKEND API ENDPOINTS

Implement logical endpoints such as:

GET /api/health

GET /api/data/sources

POST /api/data/import

GET /api/data/quality

GET /api/ml/models

POST /api/ml/train

GET /api/ml/train/{jobId}

GET /api/ml/metrics

POST /api/ml/predict

GET /api/weather/current

GET /api/weather/alerts

GET /api/weather/history

GET /api/network

GET /api/network/nodes/{id}

GET /api/network/dependencies/{id}

GET /api/scenarios

POST /api/scenarios/run

GET /api/scenarios/{id}

GET /api/scenarios/{id}/impacts

GET /api/scenarios/{id}/community-needs

GET /api/scenarios/{id}/business-impacts

POST /api/scenarios/{id}/compare

POST /api/agent/chat

GET /api/agent/status

GET /api/agent/tool-calls

POST /api/plans

POST /api/plans/{id}/approve

POST /api/plans/{id}/reject

POST /api/interventions/simulate

GET /api/audit

Use Pydantic for validation.

Return consistent errors and status codes.

Long-running training should expose job status and not block the interface.

---

# 18. FILE STRUCTURE

Suggested repository:

dragonfly-ai/
  frontend/
    src/
      app/
      components/
      pages/
      flight/
        DragonflyController.tsx
        WorldScene.tsx
        Neighborhood.tsx
        BuildingMesh.tsx
        TornadoEffect.tsx
        WeatherEffects.tsx
        FlightHUD.tsx
        InspectionSystem.tsx
        RiskVision.tsx
        DependencyVision.tsx
      dashboards/
        ModelIntelligence.tsx
        BusinessImpact.tsx
        CommunityResponse.tsx
        NetworkExplorer.tsx
        ActionCenter.tsx
      store/
        useScenarioStore.ts
      api/
      hooks/
      types/
      styles/
  backend/
    app/
      main.py
      api/
      schemas/
      data/
        ingestion.py
        normalization.py
        sources.py
        provenance.py
      ml/
        preprocessing.py
        features.py
        labels.py
        train.py
        evaluate.py
        predict.py
        registry.py
      graph/
        network.py
        traversal.py
        propagation.py
      simulation/
        scenario.py
        exposure.py
        failures.py
        business_impact.py
        community_impact.py
        interventions.py
      agents/
        nemotron.py
        tools.py
        orchestrator.py
        approvals.py
        audit.py
      storage/
      tests/
  datasets/
    raw/
    processed/
    synthetic/
  models/
  scripts/
  docs/
  .env.example
  README.md

Adjust directory names where useful, but maintain separation between the 3D frontend, data pipeline, inference, simulation, and agent.

---

# 19. TESTING REQUIREMENTS

Test real functionality.

## ML tests

- Data parsing.
- Missing values.
- Temporal alignment.
- Label construction.
- Train/test leakage prevention.
- Model persistence.
- Inference schema.
- Probability range.
- Reproducible baseline evaluation.

## Graph tests

- Dependency traversal.
- Cycles.
- Backup systems.
- Independent alternatives.
- Failure propagation.
- Restored service propagation.

## Financial tests

- Downtime calculation.
- Revenue exposure.
- Repair expense.
- Aggregation.
- Avoided loss.
- Intervention cost.

## Human impact tests

- Shelter shortage.
- Capacity updates.
- Unverified resource exclusion.
- Assistance queue behavior.
- Service gap recalculation.

## Simulation tests

- Reproducible scenario seed.
- Pause/resume.
- State transitions.
- Baseline preservation.
- Intervention recalculation.

## Frontend tests

- Flight controls.
- Building selection.
- Dashboard navigation.
- Loading/error states.
- Scenario progress.
- Model-output synchronization.
- WebGL fallback.
- No dead controls.

## Agent tests

- Tool schema validation.
- Actual backend tool execution.
- Approval restrictions.
- Handling tool errors.
- No fabricated numerical outputs.
- Correct demo fallback labeling.

---

# 20. REQUIRED DEMONSTRATION

Create a fully reproducible demo flow that can be shown to hackathon judges in approximately three to five minutes.

Step 1:
Launch application.

Step 2:
Show the model intelligence dashboard, real training dataset, trained artifact, and evaluation results.

Step 3:
Start Dragonfly mode.

Step 4:
Fly above the simulated Richardson neighborhood.

Step 5:
Run a hypothetical tornado scenario.

Step 6:
Visualize model-derived risk assessments and sampled operational disruptions.

Step 7:
Inspect an affected commercial property.

Step 8:
Trace a substation failure through the infrastructure dependency network to the facility's disrupted operations.

Step 9:
Show estimated CBRE business losses.

Step 10:
Switch to the State Farm interface and inspect potential displacement, service gaps, and shelter demand.

Step 11:
Ask Nemotron to identify the highest-priority unresolved problems.

Step 12:
Display real agent tool calls and their results.

Step 13:
Review and approve a simulated intervention.

Step 14:
Recompute the scenario.

Step 15:
Show financial consequences and unmet needs before and after the action.

Step 16:
Return to Dragonfly mode, where the updated facility status is visually reflected.

The judges should understand:

The data drives the model.

The model drives the risk predictions.

The risk predictions drive the simulation.

The dependency model reveals cascading consequences.

Nemotron investigates and recommends actions.

Interventions change the modeled results.

---

# 21. HACKATHON EXECUTION STRATEGY

Team size: Three developers.

Estimated available time: Approximately 13 hours.

Build the essential vertical slice before expanding the feature set.

Developer 1:

Data ingestion, ML training, model registry, inference.

Developer 2:

Dragonfly 3D world, scenario controls, frontend state, visual synchronization.

Developer 3:

Dependency graph, business and human impact, Nemotron orchestration, intervention tools.

All developers contribute to frontend integration.

Share types and API contracts immediately.

Build using deterministic sample data while the real data preprocessing pipeline is being implemented.

Priority order:

P0:
- App runs.
- 3D dragonfly can fly.
- At least one legitimate trained model can make inference.
- Scenario state is shared.
- One tornado simulation works.

P1:
- Model predictions affect building visualization.
- Dependency propagation works.
- CBRE financial impact calculates.
- State Farm unmet needs calculate.
- Nemotron performs genuine tool calls.
- One mitigation action recomputes outcomes.

P2:
- Data fusion import interface.
- Model training visualizations.
- Full network explorer.
- Additional polished buildings.
- Advanced particle effects.
- Report export.

P3:
- Additional natural disasters.
- Real-time collaborative features.
- Full multi-user SaaS authentication.
- Large-scale production deployment.
- High-fidelity physical simulation.

Do not spend all available time implementing visual effects while the predictive and sponsor-specific systems remain placeholders.

---

# 22. FAILURE HANDLING AND HONEST DEMONSTRATION

Implement robust offline fallback.

If NOAA download fails:
- Use an included, clearly documented local historical dataset if legally distributable.
- Otherwise use a synthetic dataset with conspicuous synthetic labeling.

If Open-Meteo fails:
- Use cached responses or sample weather inputs with correct provenance.

If NVIDIA credentials are missing:
- Use the labeled Demo Agent.

If the trained model is unavailable:
- Use explicitly labeled assumption-based scenario outputs, never fake ML predictions.

If WebGL fails:
- Provide a map or guided scenario interface.

If the data is too limited for trustworthy model training:
- Train an experimental baseline.
- Display actual metrics.
- Explain its limitations.
- Keep real historical validation separate from synthetic simulation.

All dashboards must correctly indicate which numbers are observed, predicted, estimated, assumed, or simulated.

---

# 23. DEFINITION OF DONE

The project is complete when:

1. The app starts successfully.
2. The dragonfly moves in first person.
3. A coherent 3D neighborhood exists.
4. The tornado can be activated, paused, reset, and replayed.
5. A model is genuinely trained and serialized.
6. The inference endpoint loads and invokes the trained model.
7. Risk output reaches the frontend.
8. Asset visuals reflect scenario results.
9. A dependency graph calculates downstream impacts.
10. Business impact totals are computed correctly.
11. Community unmet needs are computed correctly.
12. Nemotron invokes real tools when configured.
13. A demo agent is available otherwise.
14. Proposed interventions require human review.
15. Simulating an intervention recalculates consequences.
16. Before/after results display correctly.
17. At least one complete judge demo works reliably.
18. The README documents setup, data sources, model limitations, and API-key configuration.
19. Tests and builds pass, or remaining issues are specifically reported.

---

# 24. FINAL INSTRUCTIONS

Start implementing immediately.

First inspect the current project environment and any existing files.

Then:

1. Establish the project structure.
2. Define shared types.
3. Generate a coherent synthetic neighborhood dataset.
4. Build a minimal working 3D flight experience.
5. Implement the training and inference backend.
6. Connect predictions to scenario state.
7. Implement graph and impact calculations.
8. Build sponsor dashboards.
9. Implement Nemotron agent tools.
10. Implement intervention comparison.
11. Run tests and repair integration issues.
12. Polish the final demonstration.

Do not stop after writing scaffolding.

Do not replace functionality with static screenshots.

Do not create buttons that appear functional but do nothing.

Do not report a trained model if only random or placeholder predictions exist.

Do not fabricate weather data, accuracy scores, external integrations, or actual emergency response outcomes.

Make reasonable architectural decisions without repeatedly requesting clarification.

Deliver the most complete functioning vertical slice possible, with clean code, useful documentation, and a reproducible judge presentation.

The intended final product is:

**DRAGONFLY AI — A predictive disaster intelligence engine experienced through the eyes of a dragonfly.**

The differentiating experience:

**Fly into a forecast-informed disaster scenario. Discover predicted cascading failures. Understand who and what is at risk. Ask an AI agent to investigate. Simulate the decisions that could reduce the damage.**