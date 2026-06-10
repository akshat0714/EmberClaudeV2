# Ember — Urban Fire Spread & Guided Evacuation (3D)

A judge-friendly, Google-Earth-style 3D demo of a **simulated urban fire** in the West Hills
residential grid (under the real Santa Ana conditions of January 9, 2025): one house ignites,
embers carry to the neighbors, the block burns, and it grows into a wind-driven neighborhood
region — with three clear visual concepts: **dark-red burned history** (everything the fire has
covered, deepening with age), a bright pulsing **current active front**, and **one** model-based
prediction — *"Likely spread in next 30 minutes"*. Pressing **Help** runs a voice-guided
evacuation on the real street grid. Everything is draped onto **Google photorealistic 3D
terrain and buildings**.

> Simulated scenario with model-based spread potential.
> **Not a real incident. Not emergency guidance.**

No backend. The only network use is Google's map library + 3D tiles (and Gemini, if a key is
set).

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

## Help — voice-guided rescue (decision support, not official guidance)

Before Help is pressed the fire **creeps very slowly** — one house smoldering. Pressing
**"Help — I need to evacuate"** never resets it; the rescue joins the world as it is:

1. **Locate** — the card shows *"Locating your GPS position…"* and the simulated fix drops
   onto a **residential street in West Hills, two blocks downwind of the burning homes**. A
   **clear blue dot** (halo, white ring, heading wedge, "You" pin) appears and the camera
   flies to it.
2. **One spoken question** — the assistant speaks slowly and simply: *"I found you. The fire
   is close. Do you have a car, or are you on foot?"* The person answers by **talking (tap
   the mic)** or typing — no buttons, no menus. A disability mention plans a calmer pace.
   Replies are phrased by **Gemini** when `VITE_GEMINI_API_KEY` is set (deterministic
   fallback otherwise) and every reply is spoken aloud (Web Speech, in-browser, mute toggle).
   The LLM only writes text — routing and safety always come from the risk model.
3. **The way out depends on the answer** —
   - **"I have a car"** → get far away fast on the boulevards: WEST to Valley Circle Blvd,
     SOUTH to Victory Blvd, then EAST ~4.5 km to an evacuation center at Shoup Ave (≈9 min).
   - **"I'm on foot"** → use the streets to your advantage: the pedestrian walkway between
     the houses (a shortcut cars can't take) drops straight SOUTH to Victory Blvd, then EAST
     a few blocks to a pocket-park safe zone (≈21 min; ≈26 with limited mobility). A NORTH
     route to a Vanowen St staging point is the on-foot backup.
   Candidates allowed for the answer are **risk-scored against the live fire model** (fire
   crossings, front buffer, downwind flight, predicted-envelope re-entry, plus a
   time-exposure weight so people on foot get the shortest way out). The winner draws as a
   **bright blue path** to a **green safe zone**, with a big compass arrow, the street name,
   a step list, ETA and progress.
4. **Escape, with the fire held while you talk** — whenever the person is speaking, typing,
   or hearing a reply, **the fire stands still** so the exchange can be followed; once they
   move, the world fast-forwards (1 fire-minute = 1 real second). The simulated person
   responds perfectly and follows the blue path to the safe zone; routes and the destination
   are re-validated on every model refresh, and if the spread cuts the route the backup is
   chosen and explained. After arrival the fire keeps growing so you see what they escaped.

When every candidate is rejected the app says *"No low-risk route found. Follow official
evacuation instructions immediately."* instead of faking a route. Production use would
require official evacuation zones, road closures, shelters and alerts.

The full rescue loop is covered by a node smoke test that replays the fire and walks the
person along the chosen path for car, foot, and limited mobility:

```bash
npx tsx scripts/rescueSmoke.ts
```

## Prediction Lab — the same model on hostile terrain (`#lab`)

The scenario above is realistic and therefore *easy* to predict. The **Prediction Lab**
(∑ button in the corner, or open `/#lab` — no map key needed) is a separate screen built to
make prediction genuinely HARD and to show the actual math computing in real time:

- **A hostile synthetic world**, rendered raw, cell by cell: two crossing ridges, a steep
  peak, a meandering **river barrier with exactly one ford**, a lake, a side canyon, a
  grass/brush/timber/rock fuel mosaic with the same patchiness field, and a town strip.
- **A wind that changes mid-run**: steady toward 040°, then a 40-minute rotation to 120° with
  a lull and a surge (toggle to *Steady wind* for the contrast). An **ember spot fire** lands
  across the river at τ=35 — two fronts, one model.
- **The same algorithms, verbatim** — `stepSpeedWind` (the elliptical kernel) and
  `computeArrivalFieldOn` (the minimum-travel-time Dijkstra) are shared code with the
  scenario app, run as an event-scheduled simulation: every fire-minute the frontier
  re-seeds a fresh field under the current wind, and the ignition schedule composes as
  `min(schedule, now + arrival)` so committed heating is never lost.
- **The formulas, live** — a HUD recomputes and displays every term each refresh: the
  effective wind–slope vector U⃗, head rate R_h = R₀·fuel·dry·(1+a·U), ellipse L/B and
  eccentricity ε, the directional rate R(θ) = R_h(1−ε)/(1−ε·cosθ) (with a live polar plot of
  the kernel), Dijkstra cell/settle/millisecond counts, and the prediction set
  {c : T(c) ≤ 15 min}.
- **Forecast vs reality, graded** — every 15 minutes the model's belief is archived (white
  dashes on the map) and later scored against what actually burned. Under steady wind the
  forecasts grade ~98–100%; through the wind shift they fall to ~74–85% and then re-converge
  — the divergence is the point.

```bash
npx tsx scripts/labSmoke.ts   # barrier/ford proof (cameFrom trace), wind response, grading
```

---

## What a judge sees

1. **Fly-in** over the photorealistic West Hills street grid — houses, yards, and boulevards
   are immediately recognizable (hybrid mode keeps place labels on).
2. **Burned history** — everything the fire has already covered renders as an unmistakable
   **dark-red** overlay that deepens as the burn ages (just-burned slightly brighter, old burn
   darkest) with faint past-arrival contour lines, so streets and buildings stay visible
   underneath.
3. **Current active front** — the brightest layer: a crisp, gently pulsing yellow-orange line
   that sweeps continuously between the scenario stages (3:34 PM one house → 3:52 PM
   neighboring homes → 4:25 PM block → 5:15 PM across the streets → 6:30 PM neighborhood
   region, ≈121 simulated acres), labelled on the terrain.
4. **One prediction zone** — at the current timeline position, a FARSITE/Huygens-style
   minimum-travel-time model propagates from the front and draws a single
   **"Likely spread in next 30 minutes"** extent: an anisotropic, terrain-aware gradient zone
   (stronger orange near the front, softer toward the edge) under one crisp boundary —
   stretched downwind/uphill, pinched at barriers, never a circle. When the front is running
   extremely fast (head rate ≥ ~20 m/min), the model narrows to a **20-minute critical
   interval** instead — still only one predicted extent at a time. On-terrain label:
   *"Likely spread in next 30 minutes"*, sublabel *"Spread potential, not official perimeter"*.
5. **Cause cues, kept thin** — faint wind-direction streamlines and a few crimson advancing
   tendrils along the model's fastest house-to-house runs, with at most two cause labels
   ("Wind-driven spread", "Uphill run", "Canyon-aligned spread").
6. **Driver panel** — Wind / Slope / Fuel / Canyon channeling / Structure-edge resistance as
   live High–Medium–Low meters, captioned: *"Prediction uses wind, slope, fuel, canyon
   alignment, and structure-edge resistance."*
7. **Timeline** — play/pause, replay, stage-labeled scrubber (click to jump).
   At the final stage the prediction hides ("forward progress stopped") and the history +
   final perimeter remain.

## The spread model

A **FARSITE/Huygens-family fire-growth model** implemented as Finney-style **Minimum Travel
Time** propagation (Dijkstra over a terrain cost grid) with an **elliptical spread kernel**:

- ~9,000 terrain cells (70 m) cover the West Hills grid and the bordering open space.
  Elevation is an **approximated analytic surface** of the area's main landforms — no DEM
  download, no extra APIs.
- Slope acts like added wind (Rothermel-style): an effective wind-slope vector sets each
  cell's local head-spread direction; its magnitude drives the head rate and the ellipse
  length-to-breadth (simplified after Anderson 1983). Rate at angle θ off the head follows the
  rear-focus ellipse form R(θ) = R_head·(1−ε)/(1−ε·cosθ). In developed blocks the houses
  themselves are the fuel bed: ember-driven house-to-house spread runs ≈5–8 m/min under
  Santa Ana wind (Palisades/Eaton-style), slowed but not stopped by streets and defended
  lots; canyon channeling multiplies speed along drainage axes in the open space.
- **Position-dependent shapes:** a deterministic two-octave value-noise **fuel patchiness**
  field (×0.5–1.5 local speed, fixed seed) plus the strengthened slope and canyon terms make
  the fire grow **differently-shaped lobes in different places** — uphill-stretched fingers on
  the ridges and peaks, long thin runs down the drainages, broad wind-driven tongues in the
  open grass, and flat slow creep along the city edge — instead of one uniform oval.
- **Frontier-point front:** the displayed active edge is ~224 independent frontier points.
  Per interval, each point's advancement schedule comes from the model's pace toward its
  target position (progress = p^γ, γ smoothed around the ring, plus a position-hashed
  raggedness term that is stable between refreshes), so tongues surge downwind/upslope/along
  canyons while resisted edges stall — yet every point lands exactly on the scenario stage
  ring at the interval end. 10–20 crimson tendrils grow out along the model's fastest routes
  (validated minimum-travel-time traces, not decoration).
- The raw grid is never shown: marching-squares contours + Chaikin smoothing produce the dense
  (~200-vertex) zone geometry, clamped so the visible boundary never dips behind the front;
  the displayed zone morphs smoothly between model refreshes. The model refreshes ~1.4×/second
  as the timeline moves (~25 ms per refresh) and pauses at the final footprint.
- Verified by node smoke tests: kernel ratios, shell nesting, monotone growth, downwind
  stretch vs upwind pinch, barrier containment, pathway/cause and driver sanity.

## Honesty & accuracy

This is a **communication tool, clearly labelled as a simulation with model output**:

- **The scenario is simulated** — a fictional ignition in a real neighborhood, under the real
  Santa Ana conditions of Jan 9, 2025. The info panel labels it "Simulated scenario" and every
  destination name carries "(simulated)".
- **Stage polygons are generated**, strictly nested (verified by the smoke test), with
  believable ember-driven timing — not surveyed perimeters.
- **The predicted zone is explicitly model-based potential** — labelled *"Spread potential,
  not official perimeter"* on the terrain and in the panel, hidden once the scenario ends.
- On-screen disclaimer: *"Simulated urban fire scenario with model-based spread potential.
  Not a real incident. Not emergency guidance."*

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
  components/ModelLab.tsx        Prediction Lab screen (canvas world + formula HUD)
  components/TimelineControls.tsx play/pause/replay, stage scrubber
  components/InfoPanel.tsx       time, stage, drivers, legend, facts
  data/kennethFacts.ts           scenario facts, app title, disclaimer
  data/kennethReconstruction.ts  generated urban stage rings, camera framing
  data/spreadModelConfig.ts      model tunables, styles, Help config + wording
  data/helpScenario.ts           simulated GPS spot, street routes (car / foot)
  lib/arrivalTimeModel.ts        terrain grid + patchiness + anisotropic Dijkstra
  lib/labTerrain.ts              the lab's hostile synthetic world (same TerrainGrid)
  lib/labSim.ts                  event-scheduled MTT sim, shifting wind, forecast grading
  lib/helpController.ts          Help flow state machine (locate/ask/guide/escape)
  lib/rescueAssistant.ts         resource parsing + Gemini/LLM-phrased replies
  lib/routeRiskScoring.ts        route sampling vs front/envelope/wind, scoring
  lib/fireRiskGeometry.ts        distances, path projection/arc movement, shapes
  lib/voice.ts                   calm spoken replies + tap-to-talk mic (Web Speech)
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
  labSmoke.ts                    Prediction Lab smoke test (npx tsx)
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
