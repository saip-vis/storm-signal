# NFIP Claims XGBoost Damage-Fraction Estimator

**Target:** `buildingDamageAmount / buildingPropertyValue`, retaining only records with positive comparable property value and a ratio in `[0, 1]`. This is a claim-record damage-severity target, not a building-failure probability.

**Training source:** FEMA OpenFEMA NFIP Claims API (`NfipClaims`), acquired locally by `ml-training/train.py`. The raw cache is not committed. The model uses water depth, floors, occupancy, foundation, elevation/build-era flags, and year of loss; it excludes payments and settlement fields to avoid target leakage.

**Experiment:** The local artifact records its actual training/test count and held-out grouped-event metrics in `ml-training/artifacts/model_metadata.json`. NFIP claims are selected insurance claims, not a random sample of all exposed buildings. Production uses sourced Overture floor count when present and explicitly assumed interior water depth in feet relative to the lowest floor. Unknown numeric covariates use -1 and missing Boolean indicators use false, matching training. These incomplete covariates limit transfer to real Richardson properties. Operational screening thresholds (0.18 and 0.45 damage fraction) are transparent scenario rules, not calibrated closure probabilities. No training or model artifact changes are made by the production integration.
