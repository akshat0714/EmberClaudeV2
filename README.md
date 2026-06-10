# Kenneth Fire — 3D Historical Fire-Spread Reconstruction

A judge-friendly, Google-Earth-style 3D demo that tells the Kenneth Fire story (West Hills /
Calabasas, January 2025) with three clear concepts: **dark-red burned history** (everything the
fire has covered, deepening with age), a bright pulsing **current active front**, and **one**
model-based prediction — *"Likely spread in next 30 minutes"* — drawn as a single gradient zone
with a crisp boundary, explained by faint wind streamlines, thin spread-pathway ribbons, and
dashed structure-edge lines. Everything is draped onto **Google photorealistic 3D terrain and
buildings**.

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
   - **Maps JavaScript API** (3D map)
   - **Map Tiles API** (photorealistic 3D tiles)
3. Create `.env` in the project root (see `.env.example`):

   ```bash
   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```

4. Restart `npm run dev` (Vite reads `.env` at startup).

If Google rejects the key at runtime, the app replaces the map with a clear diagnostic card
instead of a black screen.

## Help — rescue sim (decision support, not official guidance)

One press of **"Help — I need to evacuate"** runs the whole rescue story:

1. **Locate** — the world clock restarts at ignition and the card shows *"Locating your GPS
   position…"*; the simulated fix drops onto **E Las Virgenes Canyon Rd**, the dirt road
   through Upper Las Virgenes Canyon — about 1 km downwind of the ignition point, directly in
   the modeled spread path. A **clear blue dot** (halo, white ring, heading wedge, "You" pin)
   appears and the camera flies to it.
2. **Ask** — the assistant asks what the person has with them: **a car, a bike, on foot — or
   nothing — and whether a disability slows them down** (quick replies or free text). The
   answer is parsed locally; replies are phrased by **Gemini** when `VITE_GEMINI_API_KEY` is
   set, with a deterministic built-in fallback so the demo never blocks. The LLM only writes
   text — routing and safety always come from the risk model. The resource sets the speed
   (car ~36 km/h, bike ~15 km/h, foot ~5 km/h, limited mobility ~3 km/h).
3. **Guide, qualitatively** — two hand-authored escape routes along real road alignments
   (EAST: up E Las Virgenes Canyon Rd to the Valley Circle Blvd gate, then EAST on Vanowen St
   into West Hills; SOUTH-WEST: down the canyon to Las Virgenes Canyon Rd toward Calabasas)
   are **risk-scored against the live fire model** — anything crossing the fire, hugging the
   front, fleeing downwind, or re-entering the predicted envelope after the initial escape
   window is rejected. The best survivor draws as a **bright blue path** to a
   **green-highlighted safe zone**, and the card + assistant give directions the way a person
   needs them: a big compass arrow, *"Head NORTH-EAST"*, the road name, and a step list with
   ETA and a progress bar.
4. **Escape** — the simulated person responds perfectly: they follow the blue path in world
   time. While they reply the world runs in **real time** (1 fire-minute = 1 real minute);
   while they move it fast-forwards (**1 fire-minute = 1 real second**) — chatting genuinely
   costs progress. Routes and the destination are re-validated on every model refresh; if the
   spread cuts the route the backup is chosen and explained in chat. They make it out to the
   safe zone, and the fire timeline keeps playing.

**Honesty by construction** — the GPS fix, person and destinations are labelled *(simulated)*;
the card always shows *"Model-based guidance. Follow local authorities."* and *"Not official
emergency guidance."*; when every candidate is rejected the app says *"No modeled low-risk
route found. Follow official evacuation instructions immediately."* instead of faking a route.
Production use would require official evacuation zones, road closures, shelters and alerts.

The full rescue loop is covered by a node smoke test that replays the fire and walks the
person along the chosen path for every resource type:

```bash
npx tsx scripts/rescueSmoke.ts
```

---

## What a judge sees

1. **Fly-in** over photorealistic West Hills / Upper Las Virgenes Canyon — streets, ridgelines,
   and neighborhoods are immediately recognizable (hybrid mode keeps place labels on).
2. **Burned history** — terrain the fire has already covered renders as an unmistakable
   **dark-red** overlay that deepens as the burn ages (just-burned slightly brighter, old burn
   darkest) with faint past-arrival contour lines, so ridges, roads, and buildings stay
   visible underneath.
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
- **Position-dependent shapes:** a deterministic two-octave value-noise **fuel patchiness**
  field (×0.5–1.5 local speed, fixed seed) plus the strengthened slope and canyon terms make
  the fire grow **differently-shaped lobes in different places** — uphill-stretched fingers on
  the ridges and peaks, long thin runs down the drainages, broad wind-driven tongues in the
  open grass, and flat slow creep along the city edge — instead of one uniform oval.
- **Frontier-point front:** the displayed active edge is ~224 independent frontier points.
  Per interval, each point's advancement schedule comes from the model's pace toward its
  target position (progress = p^γ, γ smoothed around the ring, plus a position-hashed
  raggedness term that is stable between refreshes), so tongues surge downwind/upslope/along
  canyons while resisted edges stall — yet every point lands exactly on the historical stage
  ring at the interval end. 10–20 crimson tendrils grow out along the model's fastest routes
  (validated minimum-travel-time traces, not decoration).
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
  components/HelpMode.tsx        Help button + rescue card (chat, directions, steps)
  components/UserLocationLayer.tsx blue dot (halo/ring/dot/wedge) + "You" pin
  components/RescueRouteLayer.tsx blue escape path + green safe zone + framing
  components/TimelineControls.tsx play/pause/replay, stage scrubber, speeds
  components/InfoPanel.tsx       time, stage, drivers, legend, facts
  data/kennethFacts.ts           official incident facts + disclaimer
  data/kennethReconstruction.ts  stage rings, structure edges, camera framing
  data/spreadModelConfig.ts      model tunables, styles, Help config + wording
  data/helpScenario.ts           simulated GPS spot, road geometry, escape routes
  lib/arrivalTimeModel.ts        terrain grid + patchiness + anisotropic Dijkstra
  lib/helpController.ts          Help flow state machine (locate/ask/guide/escape)
  lib/rescueAssistant.ts         resource parsing + Gemini/LLM-phrased replies
  lib/routeRiskScoring.ts        route sampling vs front/envelope/wind, scoring
  lib/fireRiskGeometry.ts        distances, path projection/arc movement, shapes
  lib/userLocation.ts            LocationFix model for the simulated GPS
  lib/predictionBands.ts         marching-squares contours, dashes, pathways
  lib/spreadDrivers.ts           High/Medium/Low driver summary for the panel
  lib/interpolatePolygon.ts      ring resample/align/lerp + area helpers
  lib/frontierWarp.ts            per-vertex front schedules + shape raggedness
  lib/loadGoogleMaps.ts          runtime loader for the maps3d library
  lib/timeUtils.ts               PT/UTC formatting, easing, binary search
  types/maps3d.d.ts              minimal ambient types for the maps3d library
scripts/
  rescueSmoke.ts                 full rescue-loop smoke test (npx tsx)
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
