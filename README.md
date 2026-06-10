# Kenneth Fire — 3D Historical Fire-Spread Reconstruction

A judge-friendly, Google-Earth-style 3D demo that tells the Kenneth Fire story (West Hills /
Calabasas, January 2025) as a **professional arrival-time overlay**: subtle charcoal burned
history, a bright pulsing active front, model-based **+15/+30/+60/+90 minute spread-potential
bands**, thin spread-pathway ribbons, and structure-adjacent edge markers — all over **Google
photorealistic 3D terrain and buildings**.

> Observed and reconstructed spread zones with model-based spread-potential intervals.
> **Not an official perimeter or emergency guidance.**

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
2. Enable the **Maps JavaScript API** and the **Map Tiles API** for that project.
3. Create `.env` in the project root (see `.env.example`):

   ```bash
   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```

4. Restart `npm run dev` (Vite reads `.env` at startup).

If Google rejects the key at runtime, the app replaces the map with a clear diagnostic card
instead of a black screen.

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
4. **Spread-potential bands** — at the current timeline position, a minimum-travel-time model
   propagates from the front and draws clean **+15 / +30 / +60 / +90 minute** iso-arrival
   bands: anisotropic contour bands stretched downwind and along terrain, never circles.
   Near horizons get solid outlines (higher confidence); +60/+90 render dashed and fainter
   (lower confidence). Labelled *"Spread potential, not official perimeter."*
5. **Spread pathways** — thin pale ribbons trace the model's fastest routes (canyon corridors,
   upslope and downwind runs), explaining *why* the bands lean where they lean.
6. **Structure-adjacent edges** — dashed boundary lines + faint bands where the footprint meets
   the West Hills edge ("Structure-adjacent edge", from 3:45 PM) and the Hidden Hills north
   edge ("Neighborhood edge risk", from 5:30 PM). No building damage is implied.
7. **Driver panel** — Wind alignment / Slope effect / Fuel / Canyon channeling / Structure
   adjacency as live High–Medium–Low meters, captioned with the model description.
8. **Timeline** — play/pause, replay, stage-labeled scrubber (click to jump), 1x/5x/20x.
   At the final stage the potential bands hide ("forward progress stopped") and the history +
   final perimeter remain.

## The spread-potential model

*Arrival-time surface based on wind, slope, fuel, canyon alignment, and structure adjacency.*

- ~7,700 terrain cells (70 m) cover the preserve and bordering neighborhoods. Elevation is an
  **approximated analytic surface** of the area's main landforms (northern ridge, Lasky Mesa,
  Castle Peak, Las Virgenes Creek canyon, the SW drainage) — no DEM download, no extra APIs.
- Per-step speed = base dry-grass rate × dryness, plus wind-alignment, uphill, and
  canyon-channeling bonuses, with a strong backing-fire penalty against the wind and a hard
  barrier penalty inside developed blocks (WUI fringe slightly slowed). Dijkstra
  (minimum-travel-time) propagation from the current front yields each cell's arrival time.
- The raw grid is never shown: marching-squares contours + Chaikin smoothing produce the neat
  bands; the Dijkstra predecessor tree produces the pathway ribbons. The model refreshes about
  once a second as the timeline moves (~30 ms per refresh) and pauses at the final footprint.
- Verified by node smoke tests: contour nesting, monotone growth, downwind-vs-upwind
  anisotropy (~4.5×), barrier containment, and driver sanity.

## Honesty & accuracy

This is a **communication tool, clearly labelled as a reconstruction with model output**:

- **Official facts are verbatim**: start Jan 9, 2025, 3:34 PM PT; contained Jan 12, 2025,
  7:48 AM PT; final size 1,052 acres; location Victory Blvd west of Gilmore St.
- **Stage polygons are reconstructed**, not surveyed perimeters; the final ring's area is tuned
  to the official 1,052 acres, with strict ring nesting verified by script.
- **Future bands are explicitly model-based potential** — bands with confidence styling, never
  one deterministic "future perimeter", hidden once the reconstruction ends.
- Intermediate acreages are never displayed; only stage names, times, and an explicitly
  "(reconstructed)" percent readout.
- On-screen disclaimer: *"Observed and reconstructed spread zones with model-based
  spread-potential intervals. Not an official perimeter or emergency guidance."*

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
