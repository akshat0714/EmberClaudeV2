/**
 * Geometry helpers for the "observed satellite detection envelope".
 *
 * The envelope is a deliberately simple, visibly-smoothed shape: the convex
 * hull of small discs centred on each visible detection (a Minkowski-style
 * buffered hull). It approximates the area where satellites observed fire —
 * it is NOT a mapped fire perimeter and the UI never claims it is.
 */

export type LonLat = [number, number];

const EARTH_RADIUS_KM = 6371;
const METERS_PER_DEG_LAT = 111_320;

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Convert a distance in metres to degrees of latitude/longitude near a latitude. */
export function metersToDegrees(meters: number, latDeg: number): { dLat: number; dLon: number } {
  const cosLat = Math.max(Math.cos((latDeg * Math.PI) / 180), 0.01);
  return {
    dLat: meters / METERS_PER_DEG_LAT,
    dLon: meters / (METERS_PER_DEG_LAT * cosLat),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Andrew's monotone-chain convex hull. Returns the hull ring (no closing
 * point). Degenerate inputs may return fewer than 3 points.
 */
export function convexHull(points: LonLat[]): LonLat[] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: LonLat, a: LonLat, b: LonLat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: LonLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LonLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface EnvelopeSource {
  lon: number;
  lat: number;
  /** Disc radius (metres) this point currently contributes to the envelope. */
  radiusM: number;
}

const DISC_SAMPLES = 10;
const MIN_DISC_M = 20;

/**
 * Smooth detection envelope: convex hull of discs centred on each source.
 * Returns a closed ring (first point repeated at the end), or null when no
 * valid polygon can be formed yet.
 */
export function detectionEnvelope(sources: EnvelopeSource[]): LonLat[] | null {
  if (sources.length === 0) return null;
  const cloud: LonLat[] = [];
  for (const s of sources) {
    const r = Math.max(s.radiusM, MIN_DISC_M);
    const { dLat, dLon } = metersToDegrees(r, s.lat);
    for (let i = 0; i < DISC_SAMPLES; i++) {
      const a = (i / DISC_SAMPLES) * Math.PI * 2;
      cloud.push([s.lon + Math.cos(a) * dLon, s.lat + Math.sin(a) * dLat]);
    }
  }
  const hull = convexHull(cloud);
  if (hull.length < 3) return null;
  hull.push([hull[0][0], hull[0][1]]);
  return hull;
}

/**
 * Insert intermediate vertices so no ring edge is longer than `stepM` metres.
 * A dense ring lets the outline follow 3D terrain once per-vertex elevations
 * are applied.
 */
export function densifyRing(ring: LonLat[], stepM: number): LonLat[] {
  if (ring.length < 2) return ring.slice();
  const out: LonLat[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const midLat = (lat1 + lat2) / 2;
    const { dLat, dLon } = metersToDegrees(1, midLat);
    const dx = (lon2 - lon1) / dLon;
    const dy = (lat2 - lat1) / dLat;
    const distM = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distM / stepM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([lerp(lon1, lon2, t), lerp(lat1, lat2, t)]);
    }
  }
  out.push([ring[ring.length - 1][0], ring[ring.length - 1][1]]);
  return out;
}
