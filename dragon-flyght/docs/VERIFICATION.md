# Build verification

Verified locally on November 7, 2026 (America/Chicago).

- Python 3.14.2 / Node 24.14.0.
- `python -m pytest -q`: **11 passed**. One upstream Starlette/httpx deprecation warning; no test failures.
- `npm run build`: TypeScript check and Vite production build pass. Three.js vendor chunk remains large (~325 KB compressed); the flight scene loads as a separate module. Build warns about a vendor chunk above 500 KB uncompressed.
- npm installation audit: zero reported vulnerabilities at installation time.
- Real NOAA download and model training completed; artifact loads through inference API. Actual held-out metrics are in `models/metadata.json`.
- Backend judge workflow: baseline → dependency traversal → inference → Demo Agent tools → plan revision/rejection/approval → recalculation. Repeated approval is rejected. Invalid intervention IDs, invalid humidity and invalid scenario severity are rejected.
- Financial totals reconcile; model score and asset outputs are reproducible for a fixed seed. Interventions preserve baseline and do not erase direct household displacement.
- Offline weather failure and stale-cache behavior tested with mocked HTTP failures.
- Real network checks: NWS alerts **available**, NWS discovered hourly forecast **available**, Open-Meteo ERA5 historical weather **available**. Responses cached with timestamps and source URLs.
- Browser: React development app and built static app served by FastAPI both load. Checked desktop and mobile responsive layouts; no horizontal overflow at the mobile breakpoint.
- Browser: actual sample normalization returns 44 source rows, 42 exact normalized matches, one duplicate merge and one uncertain-match suggestion.
- Browser: Demo Agent executed 15 backend calls; approval changed 39 disrupted facilities to 10 and unmet shelter spaces from 95 to 5 in default seed 1. Comparison retained baseline and direct displacement.
- Browser: 3D neighborhood, particle storm, phase controls, risk/dependency vision, keyboard E inspection, 2D overview and graph render. Embedded-browser pointer lock is denied by the host; keyboard movement and drag-to-look are provided independently as the fallback. Native-browser pointer locking was not independently verified.
- Live NVIDIA Nemotron inference was not tested because no API key was supplied. The labeled Demo Agent and actual shared tools were tested. FEMA, ACS and historical-forecast ingestion are not implemented and are not represented as connected.

Screenshots are saved in this folder. Browser-test plans/import reports remain in the local SQLite audit store as synthetic demonstration records. No real emergency actions were taken.

Final production navigation check after replacing DOM-based world labels with native 3D sprites: no new browser console errors across overview, flight, guided tour, CBRE and model views.
