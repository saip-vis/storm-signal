# Storm Signal interface and bounded Nemotron investigations

Implemented on `feature/storm-signal-agent-reliability`, preserving the real-data adapters and the pre-existing raw OSM/Census working-tree edits. No main/develop merge or remote push.

## Interface

- All visible RIVRA branding is now **Storm Signal**. Internal project/API identifiers remain stable.
- Typography: locally hosted Barlow Condensed 500/600 display and Source Sans 3 400/600 body. Official SIL OFL notices are bundled in `frontend/fonts/`; no Inter or runtime font-CDN dependency.
- One charcoal panel surface (`#191c1f`), one neutral border and one blue accent (`#8bc9e8`) across navigation, dialogs, inspector, assistant and controls. Decorative gradients and map-selection glows were removed. Green/amber/red retain their experimental risk/status meanings; unknown exposure uses the accent, not red.
- Observed records, historical/hypothetical hazard provenance and derived geometry intersections are separate sections. Heights/floors stay absent when not supplied. Operating condition remains unknown in exposure mode.
- Geometry exposure remains the default. Only the loaded Richardson rectangle is selectable. Hypothetical Flood has exposure and explicitly experimental flood ML; historical NOAA Tornado has exposure only, with no unsupported ML option. Unsupported finance, closure, shelter, displacement, route or damage outcomes are not headline claims.
- Dragonfly is labeled unavailable when no game URL is configured; its functional explanation panel remains. A real configured destination is still supported.
- Primary console/assistant actions stay accessible while long disclosure panels scroll. Nemotron prompts and displayed investigation context follow the selected hazard.

## Investigation limits and data reuse

Effective defaults on the current server: **35 seconds total**, **15 seconds per NVIDIA call**, **3 model calls**, **6 tool calls**, **900 output tokens per model call**, **12,000 characters per tool result**. Environment values are clamped to hard ceilings (45 seconds total, 15 seconds/model call, three model calls and six tools). No automatic paid NVIDIA retries.

The last allowed model round disables tools and reserves synthesis. At most two investigations run concurrently, with one per session. Sessions/history/traces are bounded. Results include actual budget usage and runtime counters.

Each investigation shares a single in-flight graph build and memoizes exact tool results, scenario definitions, Census reads and analyses keyed by scenario/mode/overrides. Different report tools reuse the same full analysis. Only genuinely distinct counterfactuals may trigger additional analyses, capped at three. Node/relationship tools return compact attributes and bounded samples, not complete building polygons or the full graph. Counts and sample limits remain distinct.

`/api/agent/chat` preserves JSON compatibility and additionally serves newline-delimited progress/final records when requested. Progress reports real stages and remaining budget, not invented completion percentages. Client cancellation closes the stream; the server propagates AbortSignal to NVIDIA fetch, analysis and Python inference. Python children are killed on cancellation/deadline. The UI provides elapsed time, a cancel action, a client timeout and clear failed/partial/cancelled states.

`/api/agent/health` distinguishes configured credentials from live verification, reports effective budgets, real-source availability, Python status and the timestamp of a successful live smoke. Data/Python health probes are single-flight and cached for 60 seconds. The assistant checks health before a paid investigation and blocks missing-key, offline-provider, missing-source and unavailable experimental-ML cases with actionable errors. Exposure mode remains usable without Python.

Live verification is process-local and bound to the configured key/model/endpoint fingerprint. It resets after a server restart or configuration change. Ordinary responses, offline tests, failed/partial responses and prior-session traces cannot set it. An explicit live smoke must return a completed NVIDIA answer with a successful real summary tool and matching node/edge counts.

## Actual validation

Command:

```sh
node --test test/agent-reliability.test.js test/agent-http.test.js test/hazards.test.js test/hazard-api.test.js test/production.test.js test/agent.test.js test/control-center.test.js test/inspector.test.js test/frontend-contract.test.js test/geographic-explorer.test.js test/simulation/engine.test.js
```

**53 passed, 0 failed.** Includes real source/adaptor and flood regression tests; one graph/analysis across parallel report tools; oversized tool batches; full deadlines; cancellation/session cleanup; Python failure and process termination; safe NVIDIA 401 handling; streamed progress/final decoding; native HTTP cancellation of a local stub provider; and health/font/static module contracts. Fault tests make no paid calls.

`npm run build` passed JavaScript syntax/static-entrypoint checks and frontend asset build. `git diff --check` passed. This is a JavaScript repository without a separate TypeScript checker.

One actual live smoke was run against the configured NVIDIA endpoint through the running server:

```sh
AGENT_SMOKE_URL=http://localhost:3061 npm run agent:smoke
```

**Passed in 2,532 ms**: provider `nvidia`, model `nvidia/nemotron-3-ultra-550b-a55b`, two model calls, one successful `get_network_summary`, one graph load, zero analyses, no warnings. Answer reported the actual **11,018 nodes and 42 edges**. Health recorded verification at `2026-11-08T17:09:48.809Z`. No simulations or Python model runs were requested by this live smoke (the health preflight independently checks Python availability).

Browser QA against `http://localhost:3061/` confirmed Storm Signal typography/branding and neutral panels; 10,971 real building footprints; the one loaded region; Flood default exposure; Tornado with only exposure and the actual 2019 event; actual 215-building/0-facility historical intersections; separate observed/derived inspector sections; unknown operating condition; inferred associations; Dragonfly's unavailable label; and health reporting the successful live smoke. An initial disclosure-variable scope error was caught in browser QA and corrected before completion. No paid browser chat was needed after the live smoke.

## Files and remaining limits

Changed: `frontend/{index.html,style.css,app.js,agent-client.js}`, font files/notices under `frontend/fonts/`, `src/agent/{agent,contracts,tools,budget,runner,health}.js`, `src/server.js`, `src/ml.js`, `src/hazards/index.js`, `src/production-simulation.js`, `.env.example`, `scripts/nemotron-smoke.js`, `test/{agent-reliability,agent-http}.test.js`, and this report.

Coverage and scientific limits are unchanged: one Richardson study rectangle; hypothetical flood; one historical preliminary NOAA contour intersected with current buildings; no tornado damage model/live warnings; experimental historical NFIP claim severity is not independently validated local closure prediction; no private operating/financial/shelter/route data or integrated Dragonfly game. Details remain in `docs/real-data-tornado-audit.md`.
