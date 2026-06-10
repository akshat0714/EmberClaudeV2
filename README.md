# Kenneth Fire — 3D Historical Fire-Spread Reconstruction

A judge-friendly, Google-Earth-style 3D demo that tells the Kenneth Fire story (West Hills /
Calabasas, January 2025) as a **clean layered geographic reconstruction**: where the fire
started, which hillsides it crossed interval by interval, where it met neighborhood edges, and
what the final 1,052-acre footprint looks like — all over **Google photorealistic 3D terrain
and buildings**.

> Historical reconstruction using official incident facts and reconstructed spread geometry.
> **Not emergency guidance.**

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
2. **Ignition marker** — "Reported start area" at Victory Blvd west of Gilmore St
   (34.185198, −118.66991), with a bright yellow ignition zone.
3. **Time-interval zone bands** draped on the terrain — each interval is its own
   clearly-outlined, semi-transparent color band (yellow → orange → deep orange → red-orange →
   burgundy), so progression reads like a layered map, not particles:
   - 3:34 PM — Ignition
   - 3:45 PM — Early spread
   - 5:00 PM — Broader spread
   - 5:30 PM — Major spread
   - Evening — Final footprint (official 1,052 acres)
4. **Moving active front** — a pulsing bright line sweeps continuously outward between stages,
   filling the current interval's color behind it, so "current time" is always obvious.
5. **Developed-edge bands** — pale bands light up where the footprint meets the West Hills
   residential edge (from 3:45 PM) and the Hidden Hills north edge (from 5:30 PM), with a live
   status list in the right panel.
6. **Timeline** — play/pause, replay, scrubber with a labeled dot per stage (click to jump),
   1x / 5x / 20x speeds, and a current-stage chip ("Stage 3 of 5 · Broader spread"). At 1x the
   whole story plays in ~60 seconds.
7. **Right panel** — current time, stage + ≈% of final footprint, official facts (final size,
   start, containment, location), mode "Reconstruction", and a legend.

## Honesty & accuracy

This is a **communication tool, clearly labelled as a reconstruction**:

- **Official facts are verbatim**: start Jan 9, 2025, 3:34 PM PT; contained Jan 12, 2025,
  7:48 AM PT; final size 1,052 acres; location Victory Blvd west of Gilmore St.
- **Stage polygons are reconstructed**, not surveyed perimeters. They follow the real
  geography: ignition at the open-space trailhead, wind-driven growth west/southwest across
  Upper Las Virgenes Canyon toward Lasky Mesa and Las Virgenes Canyon, with the eastern (West
  Hills) and southern (Hidden Hills) edges nearly fixed across later stages — the
  structure-defense story.
- The **final ring's area is tuned to the official 1,052 acres** (a generator script verified
  stage areas and strict ring nesting). Intermediate stage acreages are never displayed —
  only stage names, times, and an explicitly "(reconstructed)" percent readout.
- The front-line morphing between stages is visual interpolation only.
- The disclaimer is always visible in the info panel.

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
  components/FireScene.tsx       Google 3D map + zone/front/structure layers
  components/TimelineControls.tsx play/pause/replay, stage scrubber, speeds
  components/InfoPanel.tsx       time, stage, facts, developed edges, legend
  data/kennethFacts.ts           official incident facts + disclaimer
  data/kennethReconstruction.ts  stage rings, structure bands, camera framing
  lib/interpolatePolygon.ts      ring resample/align/lerp + area helpers
  lib/loadGoogleMaps.ts          runtime loader for the maps3d library
  lib/timeUtils.ts               PT/UTC formatting, easing, binary search
  types/maps3d.d.ts              minimal ambient types for the maps3d library
```

Tuning the look: camera framing lives in `SCENE_CAMERA` and all stage geometry/colors in
`src/data/kennethReconstruction.ts`.

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
