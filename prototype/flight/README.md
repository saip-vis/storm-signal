# Dragonfly flight prototype

Standalone, no build step. Open `index.html` in a browser (needs internet once for Three.js from cdnjs and the post-processing scripts from jsDelivr).
Or serve it: `cd prototype/flight && python3 -m http.server 8080`, then open http://localhost:8080

## Controls
- Mouse: steer. W/S: speed up / slow down. Shift: dash (truck: siren boost).
- Space: Aerial, hold near a building to swing, release while rising for a big boost. Earth, handbrake.
- A: autopilot. M: live map. E: swap Aerial (dragonfly) and Earth (rescue truck). Q: quality. F: fps. H: menu.

## Modes
- **Aerial**: dragonfly flies over the skyline, glides down onto the roof, people hop in.
- **Earth**: rescue truck drives the street grid (Dijkstra shortest path, pure-pursuit steering), stops at the curb by the building entrance, people walk out of the door. Traffic pulls over for the siren. Flooded or tornado-blocked roads are closed, so some reports can be unreachable by road. The dragonfly docks on the truck roof and recharges.

## Disasters
- **Tornado**: wandering funnel, pull + swirl, flung debris, lightning.
- **Hurricane**: rain, dark sky, wind from a moving eye (vortex, counterclockwise), storm surge spreading out from the river and flooding streets, debris riding the wind, trees bending.

## Autopilot
- Aerial: cruise above the corridor ahead, then a smooth Bezier glide that cruises and brakes to zero exactly on the roof pad, board, lift off while turning toward the next target. Wind compensation, soft wall avoidance, a safety guard, and a watchdog that forces a new approach if it circles a target for 14 s.
- Earth: road path to the curb, slows for corners, brakes to stop at the door, K-turn when the target is behind, backs up if stuck.
- **Adaptive urgency** (rule-based, not machine learning): every missed report raises urgency, every rescue lowers it a bit. Higher urgency = faster cruise, quicker boarding, earlier approach, and older reports weighted up in the planner.

## Planner
Greedy rescue-priority (people x survival decay / travel time), plus a "right next to you" rule (any report within 110 m by air or 160 m by road goes first unless it's in the danger zone), and reports that would expire before arrival count as zero. Compared against nearest-first, and air vs road plans are shown side by side.

## Tested (headless, sped-up sim)
10 sim-minutes of autopilot per run, 3 seeds each. Aerial: 0 wall collisions and 0 frames inside a building in tornado and hurricane. Earth: a few light corner scrapes per 10 minutes.

## Honest limits
- The city is procedural (Houston-flavored layout with an invented river), not real footprints.
- Population split, report sizes, survival decay, risk and wind numbers are modeled assumptions, not predictions. The hurricane is game-scaled (eyewall ~1 km, real ones are tens of km).
- Planner is a greedy heuristic, not an optimizer. No audio yet.
