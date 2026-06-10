/**
 * Summarizes what is driving spread at the current front into the simple
 * High / Medium / Low labels shown in the driver panel — the raw model
 * numbers never appear in the UI.
 *
 * Method: sample probe points ~160 m outside the front ring along its
 * outward normals and average each driver's contribution there.
 */
import { getTerrainGrid, isNearDevelopment, WIND_UNIT } from './arrivalTimeModel';
import { resampleRing, ringCentroid, type LatLng } from './interpolatePolygon';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;
const PROBE_OFFSET_M = 200;
const PROBE_COUNT = 48;

export type DriverLevel = 'High' | 'Medium' | 'Low';

export interface SpreadDrivers {
  windAlignment: DriverLevel;
  slopeEffect: DriverLevel;
  fuelVegetation: DriverLevel;
  canyonChanneling: DriverLevel;
  structureAdjacency: DriverLevel;
}

export interface ModelSummary {
  drivers: SpreadDrivers | null;
  /** False once the reconstruction reaches the final footprint. */
  predictionActive: boolean;
}

function level(value: number, high: number, medium: number): DriverLevel {
  if (value >= high) return 'High';
  if (value >= medium) return 'Medium';
  return 'Low';
}

export function summarizeDrivers(frontRing: LatLng[]): SpreadDrivers {
  const g = getTerrainGrid();
  const ring = resampleRing(frontRing, PROBE_COUNT);
  const centroid = ringCentroid(frontRing);

  let windSum = 0;
  let slopeSum = 0;
  let fuelSum = 0;
  let canyonSum = 0;
  let structSum = 0;

  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const next = ring[(i + 1) % ring.length];

    // Outward normal of the ring at p (oriented away from the centroid).
    const tx = (next.lng - prev.lng) * M_PER_DEG_LNG;
    const ty = (next.lat - prev.lat) * M_PER_DEG_LAT;
    const tLen = Math.hypot(tx, ty) || 1;
    let nx = ty / tLen;
    let ny = -tx / tLen;
    const ox = (p.lng - centroid.lng) * M_PER_DEG_LNG;
    const oy = (p.lat - centroid.lat) * M_PER_DEG_LAT;
    if (nx * ox + ny * oy < 0) {
      nx = -nx;
      ny = -ny;
    }

    const probe: LatLng = {
      lat: p.lat + (ny * PROBE_OFFSET_M) / M_PER_DEG_LAT,
      lng: p.lng + (nx * PROBE_OFFSET_M) / M_PER_DEG_LNG,
    };
    const r = Math.max(0, Math.min(g.rows - 1, Math.round((probe.lat - g.latMin) / g.dLat)));
    const c = Math.max(0, Math.min(g.cols - 1, Math.round((probe.lng - g.lngMin) / g.dLng)));
    const idx = r * g.cols + c;

    windSum += Math.max(0, nx * WIND_UNIT.x + ny * WIND_UNIT.y);
    const climb = nx * g.gradX[idx] + ny * g.gradY[idx];
    slopeSum += Math.min(Math.max(climb / 0.35, 0), 1);
    fuelSum += g.fuel[idx];
    canyonSum += g.canyon[idx];
    // analytic proximity check — grid-cell rounding shouldn't decide this
    structSum += isNearDevelopment(probe.lat, probe.lng, 250) ? 1 : 0;
  }

  const count = ring.length;
  return {
    windAlignment: level(windSum / count, 0.32, 0.18),
    slopeEffect: level(slopeSum / count, 0.3, 0.15),
    fuelVegetation: level(fuelSum / count, 0.75, 0.45),
    canyonChanneling: level(canyonSum / count, 0.3, 0.15),
    structureAdjacency: level(structSum / count, 0.3, 0.08),
  };
}
