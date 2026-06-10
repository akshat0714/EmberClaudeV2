/**
 * Turns the raw arrival-time grid into clean display geometry:
 *  - iso-arrival contours (marching squares + Chaikin smoothing) that render
 *    as neat nested bands, never as raw cells
 *  - dash segmentation for lower-confidence outlines
 *  - minimum-travel-time pathway ribbons traced back through the Dijkstra
 *    predecessor tree (these naturally follow canyons, ridgelines and the
 *    wind because that is what the model rewards)
 */
import type { ArrivalField } from './arrivalTimeModel';
import { cellLatLng } from './arrivalTimeModel';
import { pointInRing, resampleRing, ringCentroid, type LatLng } from './interpolatePolygon';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

interface GridPoint {
  x: number; // column units
  y: number; // row units
}

/**
 * Extract the main iso-contour of the arrival surface at `levelMinutes`.
 * Returns a smooth open ring in lat/lng, or null if no meaningful contour
 * exists. Grid border cells are treated as unreached so contours always
 * close inside the modeled area.
 */
export function extractContour(field: ArrivalField, levelMinutes: number): LatLng[] | null {
  const { grid, arrival } = field;
  const { rows, cols } = grid;
  const cap = levelMinutes * 2 + 240; // stand-in for Infinity, keeps lerp sane

  const valueAt = (r: number, c: number): number => {
    if (r <= 0 || r >= rows - 1 || c <= 0 || c >= cols - 1) return cap;
    const v = arrival[r * cols + c];
    return Number.isFinite(v) ? Math.min(v, cap) : cap;
  };

  // Marching squares: collect contour segments per grid square.
  const segments: Array<[GridPoint, GridPoint]> = [];
  const lerpPoint = (
    x0: number,
    y0: number,
    v0: number,
    x1: number,
    y1: number,
    v1: number,
  ): GridPoint => {
    const t = v1 === v0 ? 0.5 : (levelMinutes - v0) / (v1 - v0);
    const tc = Math.min(Math.max(t, 0), 1);
    return { x: x0 + (x1 - x0) * tc, y: y0 + (y1 - y0) * tc };
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = valueAt(r, c); // bottom-left
      const v10 = valueAt(r, c + 1); // bottom-right
      const v11 = valueAt(r + 1, c + 1); // top-right
      const v01 = valueAt(r + 1, c); // top-left
      let code = 0;
      if (v00 <= levelMinutes) code |= 1;
      if (v10 <= levelMinutes) code |= 2;
      if (v11 <= levelMinutes) code |= 4;
      if (v01 <= levelMinutes) code |= 8;
      if (code === 0 || code === 15) continue;

      const B = () => lerpPoint(c, r, v00, c + 1, r, v10); // bottom edge
      const R = () => lerpPoint(c + 1, r, v10, c + 1, r + 1, v11); // right edge
      const T = () => lerpPoint(c, r + 1, v01, c + 1, r + 1, v11); // top edge
      const L = () => lerpPoint(c, r, v00, c, r + 1, v01); // left edge

      switch (code) {
        case 1:
          segments.push([L(), B()]);
          break;
        case 2:
          segments.push([B(), R()]);
          break;
        case 3:
          segments.push([L(), R()]);
          break;
        case 4:
          segments.push([R(), T()]);
          break;
        case 5: {
          const centerInside = (v00 + v10 + v11 + v01) / 4 <= levelMinutes;
          if (centerInside) {
            segments.push([B(), R()], [L(), T()]);
          } else {
            segments.push([L(), B()], [R(), T()]);
          }
          break;
        }
        case 6:
          segments.push([B(), T()]);
          break;
        case 7:
          segments.push([L(), T()]);
          break;
        case 8:
          segments.push([L(), T()]);
          break;
        case 9:
          segments.push([B(), T()]);
          break;
        case 10: {
          const centerInside = (v00 + v10 + v11 + v01) / 4 <= levelMinutes;
          if (centerInside) {
            segments.push([L(), B()], [R(), T()]);
          } else {
            segments.push([B(), R()], [L(), T()]);
          }
          break;
        }
        case 11:
          segments.push([R(), T()]);
          break;
        case 12:
          segments.push([L(), R()]);
          break;
        case 13:
          segments.push([B(), R()]);
          break;
        case 14:
          segments.push([L(), B()]);
          break;
        default:
          break;
      }
    }
  }
  if (segments.length < 6) return null;

  // Chain segments into loops via shared endpoints.
  const key = (p: GridPoint) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const adjacency = new Map<string, Array<{ seg: number; end: 0 | 1 }>>();
  segments.forEach((seg, i) => {
    for (const end of [0, 1] as const) {
      const k = key(seg[end]);
      const list = adjacency.get(k);
      if (list) list.push({ seg: i, end });
      else adjacency.set(k, [{ seg: i, end }]);
    }
  });

  const used = new Uint8Array(segments.length);
  const loops: GridPoint[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const loop: GridPoint[] = [];
    let segIndex = start;
    let exitEnd: 0 | 1 = 1;
    used[start] = 1;
    loop.push(segments[start][0]);
    for (let guard = 0; guard < segments.length + 2; guard++) {
      const exitPoint: GridPoint = segments[segIndex][exitEnd];
      loop.push(exitPoint);
      const candidates: Array<{ seg: number; end: 0 | 1 }> = adjacency.get(key(exitPoint)) ?? [];
      const next = candidates.find((cand: { seg: number; end: 0 | 1 }) => !used[cand.seg]);
      if (!next) break;
      used[next.seg] = 1;
      segIndex = next.seg;
      exitEnd = next.end === 0 ? 1 : 0;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  if (loops.length === 0) return null;

  // Keep the main loop (largest area); drop islands/holes for a clean band.
  let best = loops[0];
  let bestArea = 0;
  for (const loop of loops) {
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      area += p.x * q.y - q.x * p.y;
    }
    area = Math.abs(area / 2);
    if (area > bestArea) {
      bestArea = area;
      best = loop;
    }
  }

  const ring = chaikinClosed(
    best.map((p) => ({
      lat: grid.latMin + p.y * grid.dLat,
      lng: grid.lngMin + p.x * grid.dLng,
    })),
    2,
  );
  // Dense vertices keep the draped boundary following the 3D terrain.
  return decimate(ring, 220);
}

/** One round of corner-cutting per iteration; keeps closed rings smooth. */
export function chaikinClosed(ring: LatLng[], iterations: number): LatLng[] {
  let pts = ring;
  for (let it = 0; it < iterations; it++) {
    const out: LatLng[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      out.push(
        { lat: p.lat * 0.75 + q.lat * 0.25, lng: p.lng * 0.75 + q.lng * 0.25 },
        { lat: p.lat * 0.25 + q.lat * 0.75, lng: p.lng * 0.25 + q.lng * 0.75 },
      );
    }
    pts = out;
  }
  return pts;
}

function chaikinOpen(path: LatLng[], iterations: number): LatLng[] {
  let pts = path;
  for (let it = 0; it < iterations; it++) {
    const out: LatLng[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      out.push(
        { lat: p.lat * 0.75 + q.lat * 0.25, lng: p.lng * 0.75 + q.lng * 0.25 },
        { lat: p.lat * 0.25 + q.lat * 0.75, lng: p.lng * 0.25 + q.lng * 0.75 },
      );
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function decimate(ring: LatLng[], maxPoints: number): LatLng[] {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  const out: LatLng[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  return out;
}

function distMeters(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);
}

/**
 * Split an open polyline into dash segments (each a short polyline) so
 * lower-confidence or boundary lines can render dashed.
 */
export function dashPath(path: LatLng[], dashMeters: number, gapMeters: number): LatLng[][] {
  const dashes: LatLng[][] = [];
  let current: LatLng[] = [path[0]];
  let drawing = true;
  let remaining = dashMeters;

  for (let i = 0; i < path.length - 1; i++) {
    let a = path[i];
    const b = path[i + 1];
    let segLen = distMeters(a, b);
    while (segLen > remaining) {
      const t = remaining / segLen;
      const cut: LatLng = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      if (drawing) {
        current.push(cut);
        if (current.length >= 2) dashes.push(current);
        current = [];
      } else {
        current = [cut];
      }
      drawing = !drawing;
      remaining = drawing ? dashMeters : gapMeters;
      segLen -= segLen * t;
      a = cut;
    }
    remaining -= segLen;
    if (drawing) current.push(b);
  }
  if (drawing && current.length >= 2) dashes.push(current);
  return dashes;
}

/** Dash a closed ring (first vertex re-appended before splitting). */
export function dashRing(ring: LatLng[], dashMeters: number, gapMeters: number): LatLng[][] {
  return dashPath([...ring, ring[0]], dashMeters, gapMeters);
}

export interface PathwayOptions {
  /** Pick endpoints with arrival in [minMinutes, maxMinutes]. */
  minMinutes: number;
  maxMinutes: number;
  maxCount: number;
  /** Minimum spacing between pathway endpoints (m). */
  separationMeters: number;
  /** Minimum distance an endpoint must be from the front centroid (m). */
  minRunMeters: number;
  /** Chaikin smoothing passes applied to each traced route (default 1). */
  smoothIterations?: number;
  /**
   * Minimum spacing between pathway ORIGINS on the front, so each accepted
   * route extends a distinct active sub-front (default 0 = disabled).
   */
  originSeparationMeters?: number;
}

/**
 * Trace minimum-travel-time routes from far-but-reachable cells back to the
 * front. These ribbons explain *why* the prediction moves where it moves.
 */
export function extractPathways(field: ArrivalField, opts: PathwayOptions): LatLng[][] {
  const { grid, arrival, cameFrom } = field;
  const n = arrival.length;
  const candidates: Array<{ index: number; minutes: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = arrival[i];
    if (a >= opts.minMinutes && a <= opts.maxMinutes) candidates.push({ index: i, minutes: a });
  }
  candidates.sort((p, q) => p.minutes - q.minutes);

  // Front centroid ≈ centroid of seed cells' best ancestor; cheaper: centroid
  // of all zero-arrival cells.
  let seedLat = 0;
  let seedLng = 0;
  let seedCount = 0;
  for (let i = 0; i < n; i++) {
    if (arrival[i] === 0) {
      const p = cellLatLng(grid, i);
      seedLat += p.lat;
      seedLng += p.lng;
      seedCount++;
    }
  }
  const seedCentroid: LatLng =
    seedCount > 0 ? { lat: seedLat / seedCount, lng: seedLng / seedCount } : cellLatLng(grid, 0);

  const chosen: number[] = [];
  // Greedy pick of well-separated endpoints, but each route is traced and
  // validated immediately — endpoints whose minimum-travel-time route is too
  // short to be a meaningful tendril don't consume a slot (or spacing).
  // Origin separation makes each accepted tendril extend a DISTINCT active
  // sub-front segment of the fire edge.
  const pathways: LatLng[][] = [];
  const origins: LatLng[] = [];
  for (const cand of candidates) {
    if (pathways.length >= opts.maxCount) break;
    const p = cellLatLng(grid, cand.index);
    if (distMeters(p, seedCentroid) < opts.minRunMeters) continue;
    const tooClose = chosen.some(
      (other) => distMeters(p, cellLatLng(grid, other)) < opts.separationMeters,
    );
    if (tooClose) continue;

    const cells: LatLng[] = [];
    let i = cand.index;
    let guard = 0;
    while (i !== -1 && guard++ < 4000) {
      cells.push(cellLatLng(grid, i));
      i = cameFrom[i];
    }
    if (cells.length < 4) continue;
    cells.reverse(); // front -> outward
    let runMeters = 0;
    for (let k = 0; k + 1 < cells.length; k++) runMeters += distMeters(cells[k], cells[k + 1]);
    if (runMeters < opts.minRunMeters) continue;
    const originSep = opts.originSeparationMeters ?? 0;
    if (originSep > 0 && origins.some((o) => distMeters(o, cells[0]) < originSep)) continue;

    chosen.push(cand.index);
    origins.push(cells[0]);
    pathways.push(chaikinOpen(cells, opts.smoothIterations ?? 1));
  }
  return pathways;
}

/** Point of a ring furthest along a compass bearing (the "leading edge"). */
export function leadingPoint(ring: LatLng[], bearingDeg: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = Math.cos(rad);
  const c = ringCentroid(ring);
  let best = ring[0];
  let bestProj = -Infinity;
  for (const p of ring) {
    const proj = (p.lng - c.lng) * M_PER_DEG_LNG * ux + (p.lat - c.lat) * M_PER_DEG_LAT * uy;
    if (proj > bestProj) {
      bestProj = proj;
      best = p;
    }
  }
  return best;
}

/**
 * Keep a contour from dipping inside the front ring. Where the model says
 * spread potential is ~zero (rear/barrier edges), grid quantization can put
 * the contour slightly inside the smooth front polygon; semantically the zone
 * should collapse ONTO the front there, so offending vertices snap to the
 * nearest front point nudged `pushM` outward, followed by a light smoothing
 * pass to remove clamp zigzags.
 */
export function clampRingOutside(ring: LatLng[], keepOut: LatLng[], pushM = 10): LatLng[] {
  const refPts = resampleRing(keepOut, 128);
  const center = ringCentroid(keepOut);
  let changed = false;
  const clamped = ring.map((p) => {
    if (!pointInRing(p, keepOut)) return p;
    changed = true;
    let best = refPts[0];
    let bestD = Infinity;
    for (const q of refPts) {
      const dLat = (q.lat - p.lat) * M_PER_DEG_LAT;
      const dLng = (q.lng - p.lng) * M_PER_DEG_LNG;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    const outLat = (best.lat - center.lat) * M_PER_DEG_LAT;
    const outLng = (best.lng - center.lng) * M_PER_DEG_LNG;
    const len = Math.hypot(outLat, outLng) || 1;
    return {
      lat: best.lat + ((outLat / len) * pushM) / M_PER_DEG_LAT,
      lng: best.lng + ((outLng / len) * pushM) / M_PER_DEG_LNG,
    };
  });
  if (!changed) return ring;
  return clamped.map((p, i) => {
    const a = clamped[(i - 1 + clamped.length) % clamped.length];
    const b = clamped[(i + 1) % clamped.length];
    return { lat: (a.lat + 2 * p.lat + b.lat) / 4, lng: (a.lng + 2 * p.lng + b.lng) / 4 };
  });
}

/** Offset a point by `meters` along a compass bearing. */
export function offsetMeters(point: LatLng, bearingDeg: number, meters: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    lat: point.lat + (Math.cos(rad) * meters) / M_PER_DEG_LAT,
    lng: point.lng + (Math.sin(rad) * meters) / M_PER_DEG_LNG,
  };
}

export interface WindStream {
  line: LatLng[];
  /** Arrowhead at the downwind end: [left barb, tip, right barb]. */
  arrow: LatLng[];
}

export interface WindStreamOptions {
  cols: number;
  rows: number;
  spacingM: number;
  lengthM: number;
  arrowM: number;
  arrowDeg: number;
}

/**
 * Faint wind-direction streamlines: a small lattice of short arrows around
 * `center`, aligned with the wind bearing. Streams whose midpoint falls
 * inside `skipRing` (the burned front) are dropped to keep the map clean.
 */
export function buildWindStreams(
  center: LatLng,
  bearingDeg: number,
  opts: WindStreamOptions,
  skipRing?: LatLng[],
): WindStream[] {
  const rad = (bearingDeg * Math.PI) / 180;
  const ax = Math.sin(rad); // along-wind unit (east, north)
  const ay = Math.cos(rad);
  const px = -ay; // perpendicular unit
  const py = ax;
  const toLatLng = (x: number, y: number): LatLng => ({
    lat: center.lat + y / M_PER_DEG_LAT,
    lng: center.lng + x / M_PER_DEG_LNG,
  });

  const streams: WindStream[] = [];
  const barbRad = (opts.arrowDeg * Math.PI) / 180;
  for (let row = 0; row < opts.rows; row++) {
    for (let col = 0; col < opts.cols; col++) {
      const along = (col - (opts.cols - 1) / 2) * opts.spacingM;
      const across = (row - (opts.rows - 1) / 2) * opts.spacingM * 0.8;
      const cx = ax * along + px * across;
      const cy = ay * along + py * across;
      const mid = toLatLng(cx, cy);
      if (skipRing && pointInRing(mid, skipRing)) continue;
      const half = opts.lengthM / 2;
      const tipX = cx + ax * half;
      const tipY = cy + ay * half;
      const line = [toLatLng(cx - ax * half, cy - ay * half), toLatLng(tipX, tipY)];
      const barb = (sign: 1 | -1): LatLng => {
        const bx = -ax * Math.cos(barbRad) + sign * -px * Math.sin(barbRad);
        const by = -ay * Math.cos(barbRad) + sign * -py * Math.sin(barbRad);
        return toLatLng(tipX + bx * opts.arrowM, tipY + by * opts.arrowM);
      };
      streams.push({ line, arrow: [barb(1), toLatLng(tipX, tipY), barb(-1)] });
    }
  }
  return streams;
}
