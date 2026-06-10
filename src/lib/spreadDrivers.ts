/**
 * Summarizes what is driving spread at the current front into the simple
 * High / Medium / Low labels shown in the driver panel — the raw model
 * numbers never appear in the UI. Also estimates the head rate of spread,
 * which the scene uses to pick between the primary 30-minute prediction and
 * a 20-minute "critical interval" when the front is moving extremely fast.
 *
 * Method: sample probe points ~200 m outside the front ring along its
 * outward normals and average each driver's contribution there.
 */
import {
  cellIndexAt,
  getTerrainGrid,
  isNearDevelopment,
  stepSpeed,
  WIND_UNIT,
} from './arrivalTimeModel';
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

export interface DriverSummary {
  drivers: SpreadDrivers;
  /** Estimated downwind head rate of spread near the front, m/min. */
  headSpeedMpm: number;
}

export interface ModelSummary {
  drivers: SpreadDrivers | null;
  /** False once the reconstruction reaches the final footprint. */
  predictionActive: boolean;
  /** The single prediction interval currently shown (e.g. 30, or 20 when critical). */
  horizonMinutes: number;
}

function level(value: number, high: number, medium: number): DriverLevel {
  if (value >= high) return 'High';
  if (value >= medium) return 'Medium';
  return 'Low';
}

export function summarizeDrivers(frontRing: LatLng[]): DriverSummary {
  const g = getTerrainGrid();
  const ring = resampleRing(frontRing, PROBE_COUNT);
  const centroid = ringCentroid(frontRing);

  let windSum = 0;
  let slopeSum = 0;
  let fuelSum = 0;
  let canyonSum = 0;
  let structSum = 0;
  let headSpeedSum = 0;

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
    const idx = cellIndexAt(g, probe.lat, probe.lng);

    windSum += Math.max(0, nx * WIND_UNIT.x + ny * WIND_UNIT.y);
    const climb = nx * g.gradX[idx] + ny * g.gradY[idx];
    slopeSum += Math.min(Math.max(climb / 0.35, 0), 1);
    fuelSum += g.fuel[idx];
    canyonSum += g.canyon[idx];
    // analytic proximity check — grid-cell rounding shouldn't decide this
    structSum += isNearDevelopment(probe.lat, probe.lng, 250) ? 1 : 0;
    // local head rate: how fast the model would run dead-downwind from here
    headSpeedSum += stepSpeed(g, idx, WIND_UNIT.x, WIND_UNIT.y);
  }

  const count = ring.length;
  return {
    drivers: {
      windAlignment: level(windSum / count, 0.32, 0.18),
      slopeEffect: level(slopeSum / count, 0.3, 0.15),
      fuelVegetation: level(fuelSum / count, 0.75, 0.45),
      canyonChanneling: level(canyonSum / count, 0.3, 0.15),
      structureAdjacency: level(structSum / count, 0.3, 0.08),
    },
    headSpeedMpm: headSpeedSum / count,
  };
}

export type PathwayCause = 'Wind-driven' | 'Uphill run' | 'Canyon-aligned spread';

/**
 * Classify a spread pathway by its dominant driver, for the small on-terrain
 * cause labels. Scores are normalised per step; slope and canyon get modest
 * weights so wind (which is almost always present) doesn't mask them.
 */
export function classifyPathway(path: LatLng[]): PathwayCause {
  const g = getTerrainGrid();
  let wind = 0;
  let slope = 0;
  let canyon = 0;
  let steps = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = (b.lng - a.lng) * M_PER_DEG_LNG;
    const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const idx = cellIndexAt(g, b.lat, b.lng);
    wind += Math.max(0, ux * WIND_UNIT.x + uy * WIND_UNIT.y);
    const climb = ux * g.gradX[idx] + uy * g.gradY[idx];
    slope += Math.min(Math.max(climb / 0.35, 0), 1);
    canyon += g.canyon[idx] * Math.abs(ux * g.canDirX[idx] + uy * g.canDirY[idx]);
    steps++;
  }
  if (steps === 0) return 'Wind-driven';
  const windScore = wind / steps;
  const slopeScore = (slope / steps) * 1.7;
  const canyonScore = (canyon / steps) * 1.5;
  if (canyonScore >= windScore && canyonScore >= slopeScore) return 'Canyon-aligned spread';
  if (slopeScore >= windScore) return 'Uphill run';
  return 'Wind-driven';
}
