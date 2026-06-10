/**
 * Ring resampling / alignment / interpolation for the moving fire front.
 *
 * Consecutive reconstruction stages are morphed by resampling both rings to
 * the same vertex count by arc length, choosing the rotation of the target
 * ring that minimises total vertex travel, then lerping vertex-wise. This is
 * purely a visual easing between reconstructed stage shapes.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const METERS_PER_DEG_LAT = 111_320;
export const SQKM_PER_ACRE = 0.00404686;

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
}

function distMeters(a: LatLng, b: LatLng): number {
  const midLat = (a.lat + b.lat) / 2;
  return Math.hypot(
    (a.lat - b.lat) * METERS_PER_DEG_LAT,
    (a.lng - b.lng) * metersPerDegLng(midLat),
  );
}

/** Signed area (deg², equirectangular); positive = counter-clockwise. */
function signedArea(ring: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    sum += p.lng * q.lat - q.lng * p.lat;
  }
  return sum / 2;
}

/** Approximate ring area in km² (open ring, no repeated end vertex). */
export function ringAreaSqKm(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const kx = metersPerDegLng(meanLat) / 1000;
  const ky = METERS_PER_DEG_LAT / 1000;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    sum += p.lng * kx * (q.lat * ky) - q.lng * kx * (p.lat * ky);
  }
  return Math.abs(sum / 2);
}

export function ringAreaAcres(ring: LatLng[]): number {
  return ringAreaSqKm(ring) / SQKM_PER_ACRE;
}

export function ringCentroid(ring: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

/** Ray-casting point-in-polygon test (open ring). */
export function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Resample an open ring to exactly `n` vertices, spaced evenly by arc length. */
export function resampleRing(ring: LatLng[], n: number): LatLng[] {
  const closed = [...ring, ring[0]];
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const len = distMeters(closed[i], closed[i + 1]);
    segLengths.push(len);
    total += len;
  }
  const out: LatLng[] = [];
  const step = total / n;
  let seg = 0;
  let traversed = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < segLengths.length - 1 && traversed + segLengths[seg] < target) {
      traversed += segLengths[seg];
      seg++;
    }
    const segLen = segLengths[seg] || 1;
    const t = Math.min(Math.max((target - traversed) / segLen, 0), 1);
    const a = closed[seg];
    const b = closed[seg + 1];
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

export interface RingTransition {
  /** Resampled "from" ring. */
  a: LatLng[];
  /** Resampled and rotation-aligned "to" ring (same vertex count as `a`). */
  b: LatLng[];
}

/**
 * Prepare a morphable pair of rings: same vertex count, same orientation, and
 * the target ring rotated so corresponding vertices travel the least.
 */
export function prepareTransition(from: LatLng[], to: LatLng[], n = 96): RingTransition {
  const a = resampleRing(from, n);
  let b = resampleRing(to, n);
  if (signedArea(from) * signedArea(to) < 0) b = b.slice().reverse();

  let bestOffset = 0;
  let bestCost = Infinity;
  for (let offset = 0; offset < n; offset++) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const p = a[i];
      const q = b[(i + offset) % n];
      const dLat = (p.lat - q.lat) * METERS_PER_DEG_LAT;
      const dLng = (p.lng - q.lng) * metersPerDegLng(p.lat);
      cost += dLat * dLat + dLng * dLng;
      if (cost >= bestCost) break;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  const aligned: LatLng[] = new Array(n);
  for (let i = 0; i < n; i++) aligned[i] = b[(i + bestOffset) % n];
  return { a, b: aligned };
}

/** Vertex-wise lerp between a prepared transition's rings; t in [0, 1]. */
export function interpolateRings(transition: RingTransition, t: number): LatLng[] {
  const { a, b } = transition;
  const out: LatLng[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = {
      lat: a[i].lat + (b[i].lat - a[i].lat) * t,
      lng: a[i].lng + (b[i].lng - a[i].lng) * t,
    };
  }
  return out;
}

/** Return a closed copy of an open ring (first vertex repeated at the end). */
export function closeRing(ring: LatLng[]): LatLng[] {
  return [...ring, ring[0]];
}
