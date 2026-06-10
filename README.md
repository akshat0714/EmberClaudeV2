# Kenneth Fire 3D Timeline

A local web app that replays the **Kenneth Fire** (West Hills / Calabasas, January 2025) as a
continuous 3D timeline built from **real, timestamped NASA FIRMS satellite fire detections** —
rendered with Mapbox GL (dark 3D terrain) and deck.gl (glowing detections, pulse pings, and a
smoothed detection-envelope polygon).

> **Continuous animation from timestamped satellite detections — not real-time emergency guidance.**

No backend. No live API calls. Everything runs from local files.

![Stack](https://img.shields.io/badge/React%20%2B%20Vite%20%2B%20TypeScript-Mapbox%20GL%20%2B%20deck.gl-orange)

---

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL (usually `http://localhost:5173`).

Two things are required before the map appears — the app shows a clean instruction screen for
each if missing:

### 1. Mapbox token

Create a free access token at <https://account.mapbox.com/access-tokens/>, then create a `.env`
file in the project root (see `.env.example`):

```bash
VITE_MAPBOX_TOKEN=your_token_here
```

Restart `npm run dev` after creating or editing `.env`.

### 2. FIRMS detection data

Download a **NASA FIRMS archive CSV** for **Jan 9–12, 2025** around the Kenneth Fire area
(West Hills / Calabasas) and save it as:

```
public/data/kenneth_firms.csv
```

Steps:

1. Open <https://firms.modaps.eosdis.nasa.gov/download/> (free NASA Earthdata login).
2. Create an **archive download** request:
   - **Area:** draw a box around West Hills / Calabasas — suggested bounds
     `West -118.78, South 34.12, East -118.56, North 34.26`.
   - **Dates:** `2025-01-09` → `2025-01-13` (FIRMS dates are UTC; including Jan 13 UTC covers
     the evening of Jan 12 Pacific time).
   - **Source:** VIIRS (S-NPP and/or NOAA-20 / NOAA-21), **CSV** format.
3. Extract the archive and save the CSV to `public/data/kenneth_firms.csv`.

Expected columns: `latitude, longitude, acq_date, acq_time, satellite, confidence, frp,
bright_ti4`. MODIS exports (with `brightness` and numeric confidence) also work. If FIRMS gives
you one CSV per sensor you can simply concatenate them — repeated header lines are ignored.
The instruction screen also lets you drag-and-drop a CSV to preview it without restarting.

---

## What you'll see

- **Dark 3D terrain** centered on the official ignition area (34.185198, −118.66991), with a
  slow cinematic push-in.
- **Fire detections** appearing at their real acquisition times: glowing orange/red orbs that
  fade in with a pulse ring, sized by fire radiative power (FRP) and faded by detection
  confidence, then slowly dimming to ember tones as burned-area history.
- **Observed satellite detection envelope** — a translucent orange polygon with a glowing
  outline that smoothly expands around the visible detections.
- **Ignition marker** — “Reported start area” at Victory Boulevard west of Gilmore Street.
- **Official facts panel** — final size **1,052 acres**, contained **Jan 12, 2025, 7:48 AM**,
  start time, location, and a map label “CAL FIRE final size: 1,052 acres.”
- **Timeline controls** — play/pause, scrubber (with a tick for every real overpass timestamp),
  1x / 5x / 20x speeds, and the current timestamp in Pacific time + UTC. At 1x the full
  timeline plays in about 90 seconds.

## Accuracy & honesty rules

This is a historical visualization, built to be honest about what satellites actually saw:

- Every animated event comes from a **real FIRMS row**: `acq_date + acq_time` (UTC) parsed into
  a timestamp, sorted, and replayed. Nothing is randomly generated.
- **No intermediate acreage numbers are invented** — the only size shown is the official final
  1,052 acres.
- **No minute-by-minute perimeters are claimed.** The polygon is a smoothed convex hull around
  detections, labelled an *“Observed satellite detection envelope”*, not a fire perimeter.
- Interpolation is used **only for visual smoothness** between real timestamps (fade-in pulses,
  ember dimming, and the envelope easing outward to newly appeared detections). Detection
  positions are never moved.
- Detections are filtered to within ~6 km of the ignition point so other January 2025 incidents
  captured in the same FIRMS download (e.g. the Palisades Fire) don't contaminate the timeline.
- Satellite times are display in Pacific time (the fire's local time) alongside UTC.

> Historical visualization using satellite detections and official incident facts.
> **Not emergency guidance.**

## Tech

| Piece | Choice |
| --- | --- |
| App | React 18 + Vite 5 + TypeScript (strict) |
| 3D map | Mapbox GL JS v3 — `dark-v11`, terrain DEM, hillshade, fog |
| Fire layers | deck.gl v9 (`MapboxOverlay` interleaved): scatterplot glow/core/ping, polygon envelope, text labels |
| Data | Local CSV in `public/data/`, parsed in the browser |
| Animation | `requestAnimationFrame` clock over the real detection time range |

```
src/
  App.tsx                    app states, fallback screens, rAF animation clock
  components/MapView.tsx     Mapbox + deck.gl layers (detections, envelope, markers)
  components/InfoPanel.tsx   right-side stats + official facts + legend
  components/TimelineControls.tsx  play/pause, scrubber, speeds, timestamp
  data/kennethFacts.ts       official incident facts + disclaimer strings
  lib/loadFirmsCsv.ts        FIRMS CSV fetch/parse/filter
  lib/timeUtils.ts           timestamp parsing, formatting, easing, clock math
  lib/geometry.ts            convex hull, buffered detection envelope, densify
```

## Build

```bash
npm run build    # type-checks and produces dist/
npm run preview  # serve the production build locally
```

## Troubleshooting

- **“Mapbox token required” screen** — create `.env` with `VITE_MAPBOX_TOKEN=...` and restart
  the dev server (Vite only reads `.env` at startup).
- **“Fire detection data needed” screen** — the CSV isn't at
  `public/data/kenneth_firms.csv`, or no rows fall within 6 km of the ignition point (check
  your FIRMS area/date selection; it must include West Hills, Jan 9–13, 2025 UTC).
- **Blank/black map with panels visible** — the token exists but was rejected; the app shows a
  token-rejected notice. Verify the token is a public (`pk.`) token.
