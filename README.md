# Kenneth Fire — 3D Historical Fire-Spread Reconstruction

A judge-friendly, Google-Earth-style 3D demo that tells the Kenneth Fire story (West Hills /
Calabasas, January 2025) with three clear concepts: subtle charcoal **burned history**, a bright
pulsing **current active front**, and **one** model-based prediction — *"Likely spread in next
30 minutes"* — drawn as a single gradient zone with a crisp boundary, explained by faint wind
streamlines, thin spread-pathway ribbons, and dashed structure-edge lines. Everything is draped
onto **Google photorealistic 3D terrain and buildings**.

> Observed and reconstructed spread zones with model-based spread potential.
> **Not an official perimeter. Not emergency guidance.**

No backend. The only network use is Google's map library + 3D tiles.

---

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`).

### Google Maps API key (required)

The app shows a clean setup screen until a key is configured:

1. In the [Google Cloud console](https://console.cloud.google.com/google/maps-apis), create an
   API key. The project must have **billing enabled** (photorealistic 3D tiles require it; the
   monthly free tier comfortably covers demo usage).
2. Enable for that project:
   - **Maps JavaScript API** (3D map + routing client)
   - **Map Tiles API** (photorealistic 3D tiles)
   - **Directions API** (evacuation route candidates via `DirectionsService`)
3. Create `.env` in the project root (see `.env.example`):

   ```bash
   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```

4. Restart `npm run dev` (Vite reads `.env` at startup).

If Google rejects the key at runtime, the app replaces the map with a clear diagnostic card
instead of a black screen. If only Directions is missing, the fire scene still works and the
evacuation card explains that routing is unavailable.

## Evacuation Mode (decision support, not official guidance)

A single toggle adds a Google-Maps-style evacuation layer on top of the simulation:

- **Your position** — browser GPS via `navigator.geolocation.watchPosition()` (high-accuracy,
  continuous), drawn as a blue dot with a white ring, a translucent accuracy circle, and a
  heading wedge when available. Location never leaves the browser. If permission is denied or
  GPS is unavailable: **Use demo location** or **Drop my location** (click the map).
- **Suggested evacuation route** — real road candidates from the Maps JS `DirectionsService`
  (with alternatives) to simulated safe destinations, each risk-scored against the live model:
  any candidate that crosses the current fire, the active-front buffer, or the predicted
  *"Likely spread in next 30 minutes"* envelope is rejected outright; survivors are ranked by
  duration, distance, envelope proximity, tendril crossings, downwind-toward-fire travel and
  canyon exposure. The best route draws as a bright blue path with a green safe-zone marker.
- **Honesty by construction** — destinations are labelled *(simulated)*; the card always shows
  *"Model-based route. Follow local authorities."* and *"Not official emergency guidance."*;
  and when every candidate is rejected the app says
  *"No modeled low-risk route found. Follow official evacuation instructions immediately."*
  instead of faking a route. Production use would require official evacuation zones, road
  closures, shelters and alerts.
- **Continuous updates** — the current route is re-scored on every model refresh and GPS fix;
  network re-routing fires when the user strays off-route, when the route becomes unsafe, or
  periodically (~15 s) after meaningful movement.
- **Demo controls** — judges can drive the dot along the route (with live ETA/distance and
  automatic rerouting) or nudge it toward the fire to watch the risk status and route react.

---

## What a judge sees

1. **Fly-in** over photorealistic West Hills / Upper Las Virgenes Canyon — streets, ridgelines,
   and neighborhoods are immediately recognizable (hybrid mode keeps place labels on).
2. **Burned history** — terrain already reached renders as a subtle dark charcoal overlay
   (recent intervals slightly lighter than older ones) with faint past-arrival contour lines,
   so ridges, roads, and buildings stay visible underneath.
3. **Current active front** — the brightest layer: a crisp, gently pulsing yellow-orange line
   that sweeps continuously between the reconstruction stages (3:34 PM ignition → 3:45 PM →
   5:00 PM → 5:30 PM → evening final footprint, official 1,052 acres), labelled on the terrain.
4. **One prediction zone** — at the current timeline position, a FARSITE/Huygens-style
   minimum-travel-time model propagates from the front and draws a single
   **"Likely spread in next 30 minutes"** extent: an anisotropic, terrain-aware gradient zone
   (stronger orange near the front, softer toward the edge) under one crisp boundary —
   stretched downwind/uphill, pinched at barriers, never a circle. When the front is running
   extremely fast (head rate ≥ ~20 m/min), the model narrows to a **20-minute critical
   interval** instead — still only one predicted extent at a time. On-terrain label:
   *"Likely spread in next 30 minutes"*, sublabel *"Spread potential, not official perimeter"*.
5. **Cause cues, kept thin** — faint wind-direction streamlines; 2–5 pale spread-pathway
   ribbons along the model's lowest-cost routes, with at most two cause labels
   ("Wind-driven spread", "Uphill slope influence", "Canyon channeling"); dashed
   structure-edge lines ("Structure-edge resistance", "Neighborhood edge risk") where the
   footprint meets neighborhoods — no building damage implied.
6. **Driver panel** — Wind / Slope / Fuel / Canyon channeling / Structure-edge resistance as
   live High–Medium–Low meters, captioned: *"Prediction uses wind, slope, fuel, canyon
   alignment, and structure-edge resistance."*
7. **Timeline** — play/pause, replay, stage-labeled scrubber (click to jump), 1x/5x/20x.
   At the final stage the prediction hides ("forward progress stopped") and the history +
   final perimeter remain.

## The spread model

A **FARSITE/Huygens-family fire-growth model** implemented as Finney-style **Minimum Travel
Time** propagation (Dijkstra over a terrain cost grid) with an **elliptical spread kernel**:

- ~7,700 terrain cells (70 m) cover the preserve and bordering neighborhoods. Elevation is an
  **approximated analytic surface** of the area's main landforms (northern ridge, Lasky Mesa,
  Castle Peak, Las Virgenes Creek canyon, the SW drainage) — no DEM download, no extra APIs.
- Slope acts like added wind (Rothermel-style): an effective wind-slope vector sets each
  cell's local head-spread direction; its magnitude drives the head rate and the ellipse
  length-to-breadth (simplified after Anderson 1983). Rate at angle θ off the head follows the
  rear-focus ellipse form R(θ) = R_head·(1−ε)/(1−ε·cosθ) — measured head/flank/back ≈
  18.7 / 1.8 / 1.0 m/min in open grass. Canyon channeling multiplies speed along drainage
  axes; developed blocks are near-barriers; the WUI fringe is slightly slowed.
- **Frontier-point front:** the displayed active edge is ~224 independent frontier points.
  Per interval, each point's advancement schedule comes from the model's pace toward its
  target position (progress = p^γ, γ smoothed around the ring), so tongues surge
  downwind/upslope/along canyons while resisted edges stall — yet every point lands exactly on
  the historical stage ring at the interval end. 10–20 crimson tendrils grow out along the
  model's fastest routes (validated minimum-travel-time traces, not decoration).
- The raw grid is never shown: marching-squares contours + Chaikin smoothing produce the dense
  (~200-vertex) zone geometry, clamped so the visible boundary never dips behind the front;
  the displayed zone morphs smoothly between model refreshes. The model refreshes ~1.4×/second
  as the timeline moves (~25 ms per refresh) and pauses at the final footprint.
- Verified by node smoke tests: kernel ratios, shell nesting, monotone growth, downwind
  stretch vs upwind pinch, barrier containment, pathway/cause and driver sanity.

## Honesty & accuracy

This is a **communication tool, clearly labelled as a reconstruction with model output**:

- **Official facts are verbatim**: start Jan 9, 2025, 3:34 PM PT; contained Jan 12, 2025,
  7:48 AM PT; final size 1,052 acres; location Victory Blvd west of Gilmore St.
- **Stage polygons are reconstructed**, not surveyed perimeters; the final ring's area is tuned
  to the official 1,052 acres, with strict ring nesting verified by script.
- **The predicted zone is explicitly model-based potential** — labelled *"Spread potential,
  not official perimeter"* on the terrain and in the panel, hidden once the reconstruction
  ends. It is a potential extent, not a deterministic future perimeter.
- Intermediate acreages are never displayed; only stage names, times, and an explicitly
  "(reconstructed)" percent readout.
- On-screen disclaimer: *"Observed and reconstructed spread zones with model-based spread
  potential. Not an official perimeter. Not emergency guidance."*

## Tech

| Piece | Choice |
| --- | --- |
| App | React 18 + Vite 5 + TypeScript (strict) — no other npm runtime deps |
| 3D map | Google Maps JavaScript API (`v=beta`, `maps3d` library): `Map3DElement` photorealistic tiles, `Polygon3DElement` zone bands draped with `CLAMP_TO_GROUND`, `Polyline3DElement` front line, `Marker3DElement` ignition pin |
| Camera | Cinematic low-angle fly-in (`flyCameraTo`), stable during playback, Recenter button |
| Animation | `requestAnimationFrame` clock over the real stage times; ring resample + align + lerp for the moving front |

```
src/
  App.tsx                        app state, rAF clock, key screen
  components/FireScene.tsx       Google 3D map + history/front/prediction layers
  components/TimelineControls.tsx play/pause/replay, stage scrubber, speeds
  components/InfoPanel.tsx       time, stage, drivers, legend, facts
  data/kennethFacts.ts           official incident facts + disclaimer
  data/kennethReconstruction.ts  stage rings, structure edges, camera framing
  data/spreadModelConfig.ts      model tunables, band styles, display wording
  lib/arrivalTimeModel.ts        terrain grid + anisotropic Dijkstra propagation
  lib/predictionBands.ts         marching-squares contours, dashes, pathways
  lib/spreadDrivers.ts           High/Medium/Low driver summary for the panel
  lib/interpolatePolygon.ts      ring resample/align/lerp + area helpers
  lib/loadGoogleMaps.ts          runtime loader for the maps3d library
  lib/timeUtils.ts               PT/UTC formatting, easing, binary search
  types/maps3d.d.ts              minimal ambient types for the maps3d library
```

Tuning the look: camera framing lives in `SCENE_CAMERA` (`kennethReconstruction.ts`); wind,
speeds, band colors/horizons, and all model wording live in `src/data/spreadModelConfig.ts`.

### Why not CesiumJS?

CesiumJS + Google 3D Tiles was the fallback option; the Maps JS `maps3d` route was chosen
because it needs zero heavy dependencies, ships Google's own camera/clamping behavior, and
keeps the bundle at ~164 KB. If you ever need Cesium instead, the data layer
(`kennethReconstruction.ts`, `interpolatePolygon.ts`) is renderer-agnostic.

## Build

```bash
npm run build    # type-checks and produces dist/
npm run preview  # serve the production build
```

## Troubleshooting

- **"Google Maps API key required" screen** — create `.env` with
  `VITE_GOOGLE_MAPS_API_KEY=...` and restart the dev server.
- **"3D map unavailable" card** — the key was rejected: check that billing is enabled and that
  *Maps JavaScript API* + *Map Tiles API* are both enabled; remove referrer restrictions for
  `localhost` testing.
- **Tiles load slowly on first run** — photorealistic tiles stream progressively; give the
  fly-in a few seconds on a fresh cache.

---

*Earlier versions of this repo animated raw NASA FIRMS satellite detections with Mapbox +
deck.gl. That approach was replaced by this reconstruction because judges found discrete
detection points hard to read; the git history preserves it.*
