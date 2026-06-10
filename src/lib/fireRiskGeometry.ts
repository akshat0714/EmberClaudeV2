/**
 * Pure geometry for evacuation risk checks: distances to the fire front,
 * predicted envelope and tendrils, plus small builders for the user-location
 * visuals. Everything here is renderer-free and unit-testable.
 */
import { pointInRing, type LatLng } from './interpolatePolygon';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100; // at ~34.18° N

/** Snapshot of the modeled fire risk at the current timeline position. */
export interface FireRiskSnapshot {
  /** Current active front polygon (everything inside is modeled fire). */
  frontRing: LatLng[];
  /** "Likely spread in next N minutes" outer boundary, null when paused. */
  envelopeRing: LatLng[] | null;
  /** Active tendril pathways (modeled advancing fire fingers). */
  tendrils: LatLng[][];
  windBearingDeg: number;
  fireCentroid: LatLng;
  horizonMinutes: number;
}

export function distMeters(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);
}

export function bearingDeg(from: LatLng, to: LatLng): number {
  const x = (to.lng - from.lng) * M_PER_DEG_LNG;
  const y = (to.lat - from.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function distToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const ax = (a.lng - p.lng) * M_PER_DEG_LNG;
  const ay = (a.lat - p.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - p.lng) * M_PER_DEG_LNG;
  const by = (b.lat - p.lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.min(Math.max(-(ax * dx + ay * dy) / lenSq, 0), 1) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/** Distance from a point to an open polyline, metres. */
export function distToPolylineM(p: LatLng, line: LatLng[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, distToSegmentM(p, line[i], line[i + 1]));
  }
  return best;
}

/** Distance from a point to a closed ring's boundary, metres. */
export function distToRingM(p: LatLng, ring: LatLng[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, distToSegmentM(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) total += distMeters(path[i], path[i + 1]);
  return total;
}

/** Resample an open path at roughly `stepM` spacing (keeps both endpoints). */
export function resamplePath(path: LatLng[], stepM: number): LatLng[] {
  if (path.length < 2) return path.slice();
  const out: LatLng[] = [path[0]];
  let carry = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = distMeters(a, b);
    if (segLen <= 0) continue;
    let along = stepM - carry;
    while (along < segLen) {
      const t = along / segLen;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      along += stepM;
    }
    carry = (carry + segLen) % stepM;
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Nearest sample index of `path` to a point. */
export function nearestIndexOnPath(path: LatLng[], p: LatLng): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = distMeters(path[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Walk `stepM` metres forward along a path from a start index. */
export function advanceAlongPath(
  path: LatLng[],
  fromIndex: number,
  stepM: number,
): { point: LatLng; index: number; headingDeg: number | null; atEnd: boolean } {
  let remaining = stepM;
  let i = Math.min(Math.max(fromIndex, 0), path.length - 1);
  let current = path[i];
  while (i + 1 < path.length && remaining > 0) {
    const next = path[i + 1];
    const segLen = distMeters(current, next);
    if (segLen > remaining) {
      const t = remaining / segLen;
      const point = {
        lat: current.lat + (next.lat - current.lat) * t,
        lng: current.lng + (next.lng - current.lng) * t,
      };
      return { point, index: i, headingDeg: bearingDeg(current, next), atEnd: false };
    }
    remaining -= segLen;
    current = next;
    i++;
  }
  const heading = i > 0 ? bearingDeg(path[i - 1], path[i]) : null;
  return { point: path[path.length - 1], index: path.length - 1, headingDeg: heading, atEnd: true };
}

/** Move a point by `meters` along a compass bearing. */
export function offsetByBearing(p: LatLng, bearing: number, meters: number): LatLng {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: p.lat + (Math.cos(rad) * meters) / M_PER_DEG_LAT,
    lng: p.lng + (Math.sin(rad) * meters) / M_PER_DEG_LNG,
  };
}

/** Closed circle ring around a point (for the user dot / accuracy circle). */
export function circleRing(center: LatLng, radiusM: number, n = 36): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      lat: center.lat + (Math.cos(a) * radiusM) / M_PER_DEG_LAT,
      lng: center.lng + (Math.sin(a) * radiusM) / M_PER_DEG_LNG,
    });
  }
  return out;
}

/** Small triangular heading wedge in front of the user dot. */
export function headingWedge(center: LatLng, headingDeg: number, sizeM: number): LatLng[] {
  const tip = offsetByBearing(center, headingDeg, sizeM * 1.6);
  const left = offsetByBearing(center, headingDeg - 130, sizeM * 0.7);
  const right = offsetByBearing(center, headingDeg + 130, sizeM * 0.7);
  return [tip, left, right];
}

export { pointInRing };
