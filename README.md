# Ember — Wildfire Spread Prediction & Evacuation Navigator

A Google-Earth-style 3D app that simulates a wildfire spreading through a real region — the
**Kenneth Fire** (West Hills / Calabasas, January 9 2025) — and navigates a user out of danger
like Google Maps would, except every route is checked, point-by-point and **in time**, against
where the fire is **predicted to be**, not just where it is now.

Every behavioral number in the model is **derived from published research, verified against
the primary sources** — the FARSITE fire-shape equations, Rothermel-lineage wind/slope
relations, Byram's fireline intensity, Anderson's residence times, the Cova et al. evacuation
trigger-buffer methodology, NIST WUI evacuation reconstructions, and the actual NWS/ASOS
weather observations from the afternoon of the fire. **See [RESEARCH.md](RESEARCH.md)** for the
complete parameter-to-source mapping.

> Research-based simulation over a reconstructed historical scenario.
> **Not an official perimeter. Not emergency guidance — always follow official alerts.**

---

## What it does

### Fire simulation (the red)
- **Fire intensity field** rendered as nested red bands draped over photorealistic 3D
  terrain: **darkest, most saturated red where combustion peaks** (just behind the advancing
  front), cooling through lighter reds to the smoldering interior — the time-since-burned →
  intensity mapping follows Byram (1959) intensity and Anderson (1969) residence/burnout
  research.
- A **multi-point active front** (~224 independently advancing frontier points) sweeps
  continuously between reconstructed stages of the real fire (3:34 PM ignition → evening
  1,052-acre footprint, the official CAL FIRE size).
- **10–20 active sub-fires**: the front's strongest heads are detected as pulsing hotspots,
  and **ember spot fires** ignite downwind of them (distances bounded by the observed Santa
  Ana spotting record).

### Prediction (the yellow)
- A FARSITE/Huygens-family **minimum-travel-time model** (Finney-style Dijkstra over a 70 m
  terrain grid) propagates from the current front *and* the spot fires using the verified
  elliptical kernel — real DEM slope as equivalent wind, canyon channeling derived from the
  terrain itself, street-derived urban fuel breaks.
- **One merged "Predicted fire spread — next 30 min" envelope** drawn as a bold yellow
  gradient with a crisp boundary (narrows to a 20-minute critical interval when the head
  rate is extreme).
- **Per-sub-fire prediction trees**: each hotspot grows branching, worm-like yellow paths —
  the model's actual minimum-travel-time routes with their decision-tree branch points —
  showing where *that* sub-fire would run. Everything re-derives continuously (~1.4×/s) as
  the clock advances.

### Evacuation (the blue)
- The user is a **Google-Maps-style blue dot** (accuracy halo per the W3C 95% accuracy
  radius, heading wedge), positioned by real browser GPS, by clicking the map, or from demo
  locations inside the real January 2025 evacuation-order area.
- Routing runs on the **real street network** (OpenStreetMap: 13,779 edges, real names,
  one-ways, signed speed limits) with a time-dependent A*:

  ```
  clearance(point) = fire_arrival(point) − evacuee_arrival(point) ≥ 10 min
  ```

  A street that is open *now* but predicted to be overrun before you would clear it is
  **rejected** — the trigger-buffer logic of Cova et al. (2005) / WUIVAC applied per road
  segment. Soft penalties keep routes 20+ min clear when possible; if no fully safe route
  exists, the least-bad option is shown explicitly flagged, never as safe.
- Destinations are the **real evacuation centers** that served this area in January 2025
  (El Camino Real Charter High School; Calvary Community Church — the shelter Calabasas
  directed Kenneth evacuees to; Pierce College). The router picks the best safely-reachable
  one.
- **Turn-by-turn guidance** with real street names ("In 500 ft, turn left onto Vanowen
  Street"), live ETA, remaining distance, the route's fire-clearance margin, optional voice
  prompts (Web Speech API), continuous off-route detection and **automatic rerouting when
  the fire prediction cuts the road ahead** — with a drive simulator so the whole loop is
  demoable end-to-end. Driving and walking profiles (HCM 1.2 m/s pedestrian default;
  evacuation-factored vehicle speeds).

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`), then use the **Evacuation demo** mode
toggle (top-left). `npm test` runs 49 node smoke tests, including independent verification
that no route ever violates the fire-clearance margin.

### Google Maps API key (required)

1. In the [Google Cloud console](https://console.cloud.google.com/google/maps-apis), create an
   API key (the project must have **billing enabled** — photorealistic 3D tiles require it;
   the monthly free tier comfortably covers demo usage).
2. Enable the **Maps JavaScript API** and the **Map Tiles API**.
3. `cp .env.example .env` and paste the key; restart `npm run dev`.

No other keys or services are needed at runtime.

## Real data

| Data | Source | Fetched |
| --- | --- | --- |
| Streets (names, one-ways, speed limits) | OpenStreetMap via Overpass (`© OpenStreetMap contributors`, ODbL) | build time → `public/data/streets.json` |
| Elevation (10 m USGS 3DEP/NED) | AWS Open Data Terrain Tiles (terrarium) | build time → `public/data/dem.json` |
| Development / urban fuel breaks | derived from the street network | grid build |
| Canyon channeling | derived from the DEM (structure tensor + relative depression) | grid build |
| Weather (wind 20°@15–22 mph G31, RH 5–6%) | VNY ASOS observations + NWS Red Flag Warning, Jan 9 2025 | verified constants |
| Incident facts, evacuation centers | CAL FIRE / LAFD / Cal OES / City of Calabasas records | verified constants |

Both data files are committed, so the app runs offline-from-bundle; refresh them with
`npm run fetch-data`.

## Architecture

```
scripts/
  fetch-streets.mjs       Overpass → routing graph (junctions + edge geometry)
  fetch-dem.mjs           terrarium tiles → 30 m elevation grid (int16 base64)
  smoke.test.ts           49 model/router/guidance verification tests
src/
  App.tsx                 modes (timeline | evacuate), sim clock, wiring
  components/FireScene.tsx     all 3D layers (fire, prediction, navigation)
  components/NavigationPanel.tsx  setup + live turn-by-turn card
  components/InfoPanel.tsx     fire-behavior readouts, legend, facts
  components/TimelineControls.tsx playback (real-time-multiple speeds in evac mode)
  data/spreadModelConfig.ts    every model constant, each tied to RESEARCH.md
  data/navConfig.ts            routing margins/speeds + real safe zones
  data/kennethReconstruction.ts stage rings (labelled reconstruction)
  lib/arrivalTimeModel.ts      terrain grid + researched elliptical MTT kernel
  lib/fireIntensity.ts         Byram intensity bands (time-since-burned)
  lib/hotspots.ts              sub-fire heads + ember spot scheduling
  lib/predictionTrees.ts       per-hotspot branching MTT trees
  lib/fireAwareRouter.ts       time-dependent A* with clearance margins
  lib/turnByTurn.ts            maneuvers from real street geometry/names
  lib/useNavigation.ts         GPS/sim fixes, reroutes, voice, arrival
  lib/fireHazard.ts            fire model → router bridge (90-min field)
  lib/streetGraph.ts           graph load, spatial hash, GPS snapping
  lib/dem.ts                   real-DEM sampling (analytic fallback)
  lib/fireTimeline.ts          front geometry at any sim time
```

The model refresh budget is small (measured): terrain grid 56 ms once; prediction field 14 ms;
hotspots + spots + trees ~3 ms; routing field 10 ms; full route 6 ms.

## Honesty & accuracy

- Official facts are verbatim (start Jan 9 2025 3:34 PM PT; contained Jan 12; 1,052 acres;
  Victory Blvd west of Gilmore St). Stage polygons are a labelled **reconstruction**, not
  surveyed perimeters; the final ring matches the official acreage.
- The prediction is explicitly **model-based potential** and the routing demo is labelled
  **not emergency guidance**.
- Known divergences from the research are listed in [RESEARCH.md §6](RESEARCH.md) (no crown
  fire/plume dynamics, fixed congestion factor, stochastic-illustrative spotting, calibration
  to a Kenneth-scale event).

## Build & test

```bash
npm run build       # typecheck + production bundle (~77 KB gzip JS)
npm test            # 49 smoke tests (model physics, sub-fires, router safety, guidance)
npm run fetch-data  # refresh the bundled OSM + DEM extracts
```

## Troubleshooting

- **"Google Maps API key required"** — create `.env` with `VITE_GOOGLE_MAPS_API_KEY=...`.
- **"3D map unavailable"** — key rejected: check billing + that *Maps JavaScript API* and
  *Map Tiles API* are enabled; remove referrer restrictions for `localhost`.
- **GPS button errors** — browser geolocation needs HTTPS or localhost; use click-to-place
  or the demo locations instead.
- **Tiles load slowly on first run** — photorealistic tiles stream progressively.

---

*This repo previously hosted the Kenneth Fire 3D reconstruction; it has been extended into a
full evacuation navigator. Attribution: streets © OpenStreetMap contributors (ODbL); 3DEP
elevation data courtesy of the U.S. Geological Survey; map © Google.*
