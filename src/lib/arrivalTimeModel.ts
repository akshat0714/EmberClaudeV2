/**
 * Minimum-travel-time fire-spread model for the Kenneth Fire area.
 *
 * A grid of 70 m terrain cells covers Upper Las Virgenes Canyon and the
 * bordering neighborhoods. A Finney-style Minimum Travel Time (Dijkstra)
 * propagation from the current fire front estimates when fire could reach
 * each cell. The directional kernel implements the researched relations
 * (RESEARCH.md §1):
 *
 *  - midflame wind = 0.4 × 10-m wind                  (RMRS-GTR-266)
 *  - slope as equivalent wind, vector-added            (GTR-371 §4.1/5.4.3, Table 24)
 *  - L/B = 0.936e^(0.2566U)+0.461e^(−0.1548U)−0.397    (FARSITE RMRS-RP-4 Eq.13)
 *  - ε = √(LB²−1)/LB; R(θ) = R_head(1−ε)/(1−ε·cosθ)    (GTR-371 §6.2, rear focus)
 *  - R_head = R0·fuel·dryness·(1 + k·U^1.5)            (Rothermel wind exponent
 *    for fine fuels; k calibrated to the Kenneth Fire's verified conditions)
 *
 * TERRAIN IS REAL where the bundled data loads: elevation from USGS
 * 3DEP-derived terrain tiles (see scripts/fetch-dem.mjs), developed areas and
 * road fuel breaks from the real OSM street network, and canyon channeling
 * derived from the DEM itself (structure-tensor terrain axis + relative
 * depression). Analytic approximations remain only as offline fallbacks.
 * Outputs are always labelled model-based prediction, never an official
 * perimeter.
 */
import { demElevation, loadDem } from './dem';
import { pointInRing, ringCentroid, type LatLng } from './interpolatePolygon';
import { MinHeap } from './minHeap';
import { loadStreetGraph, roadPointCounts } from './streetGraph';
import {
  FIRE_SHAPE,
  GRID,
  MIDFLAME_WIND_MPS,
  MODEL_CAP_MINUTES,
  SLOPE_WIND,
  SPEEDS,
  WIND,
} from '../data/spreadModelConfig';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100; // at ~34.18° N

const REF_LAT = 34.183;
const REF_LNG = -118.687;

/** Local metres east/north of the reference point. */
function toXY(lat: number, lng: number): { x: number; y: number } {
  return { x: (lng - REF_LNG) * M_PER_DEG_LNG, y: (lat - REF_LAT) * M_PER_DEG_LAT };
}

const gauss = (t: number) => Math.exp(-t * t);

interface LineFeature {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ux: number;
  uy: number;
  halfWidthM: number;
}

function lineFeature(aLat: number, aLng: number, bLat: number, bLng: number, halfWidthM: number): LineFeature {
  const a = toXY(aLat, aLng);
  const b = toXY(bLat, bLng);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ux: dx / len, uy: dy / len, halfWidthM };
}

function distToSegment(px: number, py: number, f: LineFeature): number {
  const vx = f.x2 - f.x1;
  const vy = f.y2 - f.y1;
  const t = Math.max(0, Math.min(1, ((px - f.x1) * vx + (py - f.y1) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (f.x1 + vx * t), py - (f.y1 + vy * t));
}

// ---- analytic FALLBACKS (used only when the bundled real data is missing)
const RIDGE_NORTH = lineFeature(34.199, -118.7, 34.199, -118.66, 450);
const LV_CREEK = lineFeature(34.212, -118.7035, 34.16, -118.7035, 300);
const SW_DRAIN = lineFeature(34.186, -118.67, 34.176, -118.7, 220);
const LASKY_MESA = { lat: 34.1765, lng: -118.688, radiusM: 520, heightM: 40 };
const CASTLE_PEAK = { lat: 34.179, lng: -118.66, radiusM: 260, heightM: 55 };

/** Fallback "developed" rectangles (West Hills, Hidden Hills, Bell Canyon). */
export function isDeveloped(lat: number, lng: number): boolean {
  if (lng > -118.6648) return true;
  if (lat < 34.1712 && lng > -118.692) return true;
  if (lat < 34.168 && lng < -118.7) return true;
  return false;
}

/** True when any development lies within ~radiusM of the point. */
export function isNearDevelopment(lat: number, lng: number, radiusM: number): boolean {
  const g = cachedGrid;
  if (g && g.realStreets) {
    const cells = Math.max(1, Math.round(radiusM / g.cellMeters));
    const r0 = Math.round((lat - g.latMin) / g.dLat);
    const c0 = Math.round((lng - g.lngMin) / g.dLng);
    for (let dr = -cells; dr <= cells; dr++) {
      for (let dc = -cells; dc <= cells; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) continue;
        if (g.developed[r * g.cols + c]) return true;
      }
    }
    return false;
  }
  if (isDeveloped(lat, lng)) return true;
  for (const r of [radiusM, radiusM / 2]) {
    const dLat = r / M_PER_DEG_LAT;
    const dLng = r / M_PER_DEG_LNG;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (isDeveloped(lat + Math.cos(a) * dLat, lng + Math.sin(a) * dLng)) return true;
    }
  }
  return false;
}

/** Analytic elevation fallback (m) — used only when the real DEM is absent. */
export function approxElevation(lat: number, lng: number): number {
  const { x, y } = toXY(lat, lng);
  let elev =
    300 -
    0.018 * x +
    0.012 * y +
    85 * gauss(distToSegment(x, y, RIDGE_NORTH) / RIDGE_NORTH.halfWidthM) +
    55 * gauss(Math.hypot(x - toXY(CASTLE_PEAK.lat, CASTLE_PEAK.lng).x, y - toXY(CASTLE_PEAK.lat, CASTLE_PEAK.lng).y) / CASTLE_PEAK.radiusM) -
    60 * gauss(distToSegment(x, y, LV_CREEK) / LV_CREEK.halfWidthM) -
    26 * gauss(distToSegment(x, y, SW_DRAIN) / SW_DRAIN.halfWidthM);
  const mesa = toXY(LASKY_MESA.lat, LASKY_MESA.lng);
  const mesaT = Math.hypot(x - mesa.x, y - mesa.y) / LASKY_MESA.radiusM;
  elev += LASKY_MESA.heightM * Math.min(1, Math.max(0, 1.4 - mesaT));
  if (isDeveloped(lat, lng)) elev = elev * 0.3 + 268 * 0.7;
  return elev;
}

/** 0 grass, 1 chaparral/scrub, 2 developed. */
export type FuelClass = 0 | 1 | 2;

export interface TerrainGrid {
  rows: number;
  cols: number;
  latMin: number;
  lngMin: number;
  dLat: number;
  dLng: number;
  cellMeters: number;
  elev: Float32Array;
  /** Elevation gradient, m per m east / north. */
  gradX: Float32Array;
  gradY: Float32Array;
  /** 0..1 burnable fuel continuity (grass/chaparral = 1, developed ≈ 0.15). */
  fuel: Float32Array;
  /** Fuel class per cell (grass / chaparral / developed). */
  fuelClass: Uint8Array;
  developed: Uint8Array;
  /** Open-fuel cell crossed by a single road (partial fuel break). */
  roadBreak: Uint8Array;
  /** Wildland fringe within ~210 m of development (structure-adjacent). */
  wui: Uint8Array;
  /** 0..1 canyon membership and the local canyon axis direction. */
  canyon: Float32Array;
  canDirX: Float32Array;
  canDirY: Float32Array;
  /** Provenance flags for the UI/tests. */
  realDem: boolean;
  realStreets: boolean;
}

let cachedGrid: TerrainGrid | null = null;
let terrainInitPending: Promise<{ realDem: boolean; realStreets: boolean }> | null = null;

/**
 * Load the real terrain inputs (DEM + street graph) and rebuild the grid
 * from them. Resolves with what actually loaded; the model works either way.
 */
export function initTerrain(): Promise<{ realDem: boolean; realStreets: boolean }> {
  if (terrainInitPending) return terrainInitPending;
  terrainInitPending = Promise.allSettled([loadDem(), loadStreetGraph()]).then(
    ([demResult, streetResult]) => {
      const realDem = demResult.status === 'fulfilled' && demResult.value !== null;
      const realStreets = streetResult.status === 'fulfilled';
      cachedGrid = null; // rebuild with whatever real data arrived
      return { realDem, realStreets };
    },
  );
  return terrainInitPending;
}

export function getTerrainGrid(): TerrainGrid {
  if (cachedGrid) return cachedGrid;
  const dLat = GRID.cellMeters / M_PER_DEG_LAT;
  const dLng = GRID.cellMeters / M_PER_DEG_LNG;
  const rows = Math.floor((GRID.latMax - GRID.latMin) / dLat) + 1;
  const cols = Math.floor((GRID.lngMax - GRID.lngMin) / dLng) + 1;
  const n = rows * cols;

  const elevationAt = (lat: number, lng: number): number =>
    demElevation(lat, lng) ?? approxElevation(lat, lng);
  const realDem = demElevation(GRID.latMin + 0.01, GRID.lngMin + 0.01) !== null;

  const g: TerrainGrid = {
    rows,
    cols,
    latMin: GRID.latMin,
    lngMin: GRID.lngMin,
    dLat,
    dLng,
    cellMeters: GRID.cellMeters,
    elev: new Float32Array(n),
    gradX: new Float32Array(n),
    gradY: new Float32Array(n),
    fuel: new Float32Array(n),
    fuelClass: new Uint8Array(n),
    developed: new Uint8Array(n),
    roadBreak: new Uint8Array(n),
    wui: new Uint8Array(n),
    canyon: new Float32Array(n),
    canDirX: new Float32Array(n),
    canDirY: new Float32Array(n),
    realDem,
    realStreets: false,
  };

  const eps = 60; // finite-difference step (m) for the slope estimate
  for (let r = 0; r < rows; r++) {
    const lat = GRID.latMin + r * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = GRID.lngMin + c * dLng;
      const i = r * cols + c;
      g.elev[i] = elevationAt(lat, lng);
      g.gradX[i] =
        (elevationAt(lat, lng + eps / M_PER_DEG_LNG) - elevationAt(lat, lng - eps / M_PER_DEG_LNG)) /
        (2 * eps);
      g.gradY[i] =
        (elevationAt(lat + eps / M_PER_DEG_LAT, lng) - elevationAt(lat - eps / M_PER_DEG_LAT, lng)) /
        (2 * eps);
    }
  }

  // ---- developed / road-break masks from the REAL street network.
  // A 70 m cell inside a residential block contains no street geometry, so
  // urban fabric is detected by the NEIGHBORHOOD pattern: many road-bearing
  // cells in a 5×5 (~350 m) window. A single arterial crossing wildland is a
  // thin line (≤ ~7 road-bearing cells in that window) and becomes a partial
  // fuel break instead.
  const roadCounts = roadPointCounts(g.latMin, g.lngMin, dLat, dLng, rows, cols);
  let roadCells = 0;
  for (let i = 0; i < n; i++) if (roadCounts[i] > 0) roadCells++;
  g.realStreets = roadCells > 50;
  const DEV_WINDOW = 2; // cells each side (5×5 ≈ 350 m)
  const DEV_MIN_ROAD_CELLS = 8;
  for (let r = 0; r < rows; r++) {
    const lat = GRID.latMin + r * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = GRID.lngMin + c * dLng;
      const i = r * cols + c;
      let dev: boolean;
      if (g.realStreets) {
        let roadNeighbors = 0;
        for (let dr = -DEV_WINDOW; dr <= DEV_WINDOW; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -DEV_WINDOW; dc <= DEV_WINDOW; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= cols) continue;
            if (roadCounts[rr * cols + cc] > 0) roadNeighbors++;
          }
        }
        dev = roadNeighbors >= DEV_MIN_ROAD_CELLS;
        if (!dev && roadCounts[i] >= 2) g.roadBreak[i] = 1;
      } else {
        dev = isDeveloped(lat, lng);
      }
      g.developed[i] = dev ? 1 : 0;
      g.fuel[i] = dev ? 0.15 : 1;
    }
  }

  // WUI fringe: wildland within ~3 cells (≈210 m) of developed cells.
  const WUI_CELLS = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (g.developed[i]) continue;
      let near = false;
      for (let dr = -WUI_CELLS; dr <= WUI_CELLS && !near; dr++) {
        for (let dc = -WUI_CELLS; dc <= WUI_CELLS && !near; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          if (g.developed[rr * cols + cc]) near = true;
        }
      }
      if (near) g.wui[i] = 1;
    }
  }

  // ---- canyon channeling derived from the terrain itself:
  // depression depth below the ~280 m neighborhood mean elevation gives
  // canyon membership; the structure tensor of the elevation gradient gives
  // the local terrain axis (direction of least elevation change), which is
  // the along-valley channeling direction.
  const SMOOTH_R = 4; // cells (~280 m)
  const smoothed = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let count = 0;
      for (let dr = -SMOOTH_R; dr <= SMOOTH_R; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -SMOOTH_R; dc <= SMOOTH_R; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          sum += g.elev[rr * cols + cc];
          count++;
        }
      }
      smoothed[r * cols + c] = sum / count;
    }
  }
  const TENSOR_R = 2;
  const FULL_DEPTH_M = 16; // this far below the neighborhood mean = canyon 1.0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const depth = smoothed[i] - g.elev[i];
      const canyon = Math.min(Math.max(depth / FULL_DEPTH_M, 0), 1);
      g.canyon[i] = canyon;
      if (canyon <= 0.05) continue;
      // structure tensor over the neighborhood gradient field
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (let dr = -TENSOR_R; dr <= TENSOR_R; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -TENSOR_R; dc <= TENSOR_R; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const k = rr * cols + cc;
          sxx += g.gradX[k] * g.gradX[k];
          sxy += g.gradX[k] * g.gradY[k];
          syy += g.gradY[k] * g.gradY[k];
        }
      }
      // minor eigenvector = axis of least elevation change (valley axis)
      const half = (sxx + syy) / 2;
      const disc = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
      const lambdaMin = half - disc;
      let vx = sxy;
      let vy = lambdaMin - sxx;
      if (Math.abs(vx) < 1e-12 && Math.abs(vy) < 1e-12) {
        vx = lambdaMin - syy;
        vy = sxy;
      }
      const len = Math.hypot(vx, vy);
      if (len > 1e-12) {
        g.canDirX[i] = vx / len;
        g.canDirY[i] = vy / len;
      }
    }
  }

  // ---- fuel classes: the preserve is a grassland/chaparral mosaic — rolling
  // grass on mesas and gentle ground (Lasky Mesa), shrub on steeper slopes
  // and canyon walls. Approximation documented in RESEARCH.md §1.6.
  for (let i = 0; i < n; i++) {
    if (g.developed[i]) {
      g.fuelClass[i] = 2;
      continue;
    }
    const slopeMag = Math.hypot(g.gradX[i], g.gradY[i]);
    g.fuelClass[i] = slopeMag > 0.18 || g.canyon[i] > 0.45 ? 1 : 0;
  }

  cachedGrid = g;
  return g;
}

export function cellLatLng(g: TerrainGrid, index: number): LatLng {
  const r = Math.floor(index / g.cols);
  const c = index % g.cols;
  return { lat: g.latMin + r * g.dLat, lng: g.lngMin + c * g.dLng };
}

export function cellIndexAt(g: TerrainGrid, lat: number, lng: number): number {
  const r = Math.max(0, Math.min(g.rows - 1, Math.round((lat - g.latMin) / g.dLat)));
  const c = Math.max(0, Math.min(g.cols - 1, Math.round((lng - g.lngMin) / g.dLng)));
  return r * g.cols + c;
}

const WIND_RAD = (WIND.spreadBearingDeg * Math.PI) / 180;
export const WIND_UNIT = { x: Math.sin(WIND_RAD), y: Math.cos(WIND_RAD) };

/** FARSITE length-to-breadth from effective midflame wind (m/s). */
export function lengthToBreadth(uMps: number): number {
  const lb =
    FIRE_SHAPE.a * Math.exp(FIRE_SHAPE.b * uMps) +
    FIRE_SHAPE.c * Math.exp(-FIRE_SHAPE.d * uMps) -
    FIRE_SHAPE.offset;
  return Math.min(Math.max(lb, 1), FIRE_SHAPE.lbMax);
}

/**
 * Directional spread speed (m/min) for a step arriving at cell `to`,
 * travelling along the unit direction (dirX east, dirY north). See the file
 * header for the formula provenance.
 */
export function stepSpeed(g: TerrainGrid, to: number, dirX: number, dirY: number): number {
  // Effective wind–slope vector (m/s, midflame): wind plus the upslope
  // equivalent-wind term (GTR-371 Table 24 fit), vector-added.
  const slopeMag = Math.hypot(g.gradX[to], g.gradY[to]);
  let effX = MIDFLAME_WIND_MPS * WIND_UNIT.x;
  let effY = MIDFLAME_WIND_MPS * WIND_UNIT.y;
  if (slopeMag > 1e-6) {
    const uSlope = Math.min(
      SLOPE_WIND.coefMps * Math.pow(Math.min(slopeMag, 1), SLOPE_WIND.exponent),
      SLOPE_WIND.capMps,
    );
    effX += (g.gradX[to] / slopeMag) * uSlope;
    effY += (g.gradY[to] / slopeMag) * uSlope;
  }
  const U = Math.hypot(effX, effY);

  // Head rate of spread (m/min): R0·fuel·dryness·(1 + k·U^1.5).
  const classFactor = g.fuelClass[to] === 1 ? SPEEDS.chaparralSpeedFactor : 1;
  const headRos =
    SPEEDS.baseRosMpm *
    g.fuel[to] *
    classFactor *
    SPEEDS.drynessFactor *
    (1 + SPEEDS.windK * Math.pow(U, SPEEDS.windExponent));

  // Rear-focus elliptical direction dependence.
  const lb = lengthToBreadth(U);
  const ecc = Math.sqrt(Math.max(1 - 1 / (lb * lb), 0));
  const cosTheta = U > 1e-6 ? (dirX * effX + dirY * effY) / U : 0;
  let speed = (headRos * (1 - ecc)) / (1 - ecc * cosTheta);

  // Canyon channeling: terrain funnels wind and convection along the
  // DEM-derived valley axis.
  const canyonDot = Math.abs(dirX * g.canDirX[to] + dirY * g.canDirY[to]);
  speed *= 1 + SPEEDS.canyonFactor * g.canyon[to] * canyonDot;

  // Urban fabric near-barrier, single-road partial fuel break, WUI fringe.
  if (g.developed[to]) speed *= SPEEDS.developedFactor;
  else if (g.roadBreak[to]) speed *= SPEEDS.roadBreakFactor;
  else if (g.wui[to]) speed *= SPEEDS.wuiFactor;

  return Math.min(Math.max(speed, SPEEDS.minSpeed), SPEEDS.maxSpeed);
}

export interface ArrivalField {
  grid: TerrainGrid;
  /** Estimated minutes from the seed front; Infinity = beyond the model cap. */
  arrival: Float64Array;
  /** Predecessor cell index along the minimum-travel-time route, or -1. */
  cameFrom: Int32Array;
}

// 8-neighbour steps: row delta, col delta, unit direction (east, north).
const SQRT2 = Math.SQRT1_2;
const STEPS = [
  { dr: 1, dc: 0, ux: 0, uy: 1, dist: 1 },
  { dr: -1, dc: 0, ux: 0, uy: -1, dist: 1 },
  { dr: 0, dc: 1, ux: 1, uy: 0, dist: 1 },
  { dr: 0, dc: -1, ux: -1, uy: 0, dist: 1 },
  { dr: 1, dc: 1, ux: SQRT2, uy: SQRT2, dist: Math.SQRT2 },
  { dr: 1, dc: -1, ux: -SQRT2, uy: SQRT2, dist: Math.SQRT2 },
  { dr: -1, dc: 1, ux: SQRT2, uy: -SQRT2, dist: Math.SQRT2 },
  { dr: -1, dc: -1, ux: -SQRT2, uy: -SQRT2, dist: Math.SQRT2 },
];

/** Extra ignition seeded into the propagation (ember spot fire). */
export interface SeedPoint {
  lat: number;
  lng: number;
  /** Minutes after the field's time origin at which this seed ignites. */
  delayMin: number;
}

/**
 * Minimum-travel-time (Dijkstra) propagation from the current front polygon
 * plus any delayed point seeds (spot fires). Cells whose centre lies inside
 * the front seed at time 0.
 */
export function computeArrivalField(
  frontRing: LatLng[],
  capMinutes: number = MODEL_CAP_MINUTES,
  extraSeeds: SeedPoint[] = [],
): ArrivalField {
  const g = getTerrainGrid();
  const n = g.rows * g.cols;
  const arrival = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const heap = new MinHeap();

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of frontRing) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const r0 = Math.max(0, Math.floor((minLat - g.latMin) / g.dLat));
  const r1 = Math.min(g.rows - 1, Math.ceil((maxLat - g.latMin) / g.dLat));
  const c0 = Math.max(0, Math.floor((minLng - g.lngMin) / g.dLng));
  const c1 = Math.min(g.cols - 1, Math.ceil((maxLng - g.lngMin) / g.dLng));
  let seeded = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g.cols + c;
      if (pointInRing(cellLatLng(g, i), frontRing)) {
        arrival[i] = 0;
        heap.push(i, 0);
        seeded++;
      }
    }
  }
  if (seeded === 0) {
    const centroid = ringCentroid(frontRing);
    const i = cellIndexAt(g, centroid.lat, centroid.lng);
    arrival[i] = 0;
    heap.push(i, 0);
  }
  for (const seed of extraSeeds) {
    const i = cellIndexAt(g, seed.lat, seed.lng);
    if (seed.delayMin < arrival[i]) {
      arrival[i] = seed.delayMin;
      heap.push(i, seed.delayMin);
    }
  }

  const stepBase = g.cellMeters;
  while (heap.size > 0) {
    const { index, priority } = heap.pop();
    if (priority > arrival[index]) continue; // stale entry
    if (priority >= capMinutes) continue;
    const r = Math.floor(index / g.cols);
    const c = index % g.cols;
    for (const s of STEPS) {
      const nr = r + s.dr;
      const nc = c + s.dc;
      if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
      const ni = nr * g.cols + nc;
      const speed = stepSpeed(g, ni, s.ux, s.uy);
      const t = priority + (stepBase * s.dist) / speed;
      if (t < arrival[ni] && t <= capMinutes) {
        arrival[ni] = t;
        cameFrom[ni] = index;
        heap.push(ni, t);
      }
    }
  }

  return { grid: g, arrival, cameFrom };
}
