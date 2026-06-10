/**
 * Simplified arrival-time model for the Kenneth Fire area.
 *
 * A grid of ~90 m terrain cells covers Upper Las Virgenes Canyon and the
 * bordering neighborhoods. Each cell carries terrain attributes (elevation,
 * slope, fuel, canyon alignment, developed/WUI flags) and a Dijkstra
 * (minimum-travel-time) propagation from the current fire front estimates
 * when fire could reach each cell:
 *
 *   spreadSpeed = baseFuelSpeed · fuel · dryness
 *               + windAlignmentBonus      (downwind travel is much faster)
 *               + uphillSlopeBonus        (flames preheat upslope fuel)
 *               + canyonChannelBonus      (terrain funnels wind along canyons)
 *               then × barrierPenalty     (developed blocks nearly stop spread)
 *               and  × structureAdjacencyModifier (WUI fringe slows slightly)
 *
 *   travelTime = stepDistance / spreadSpeed
 *
 * ELEVATION IS APPROXIMATED: no DEM is downloaded; a small analytic surface
 * reproduces the area's main landforms (northern ridge, Lasky Mesa, Castle
 * Peak, Las Virgenes Creek canyon, the SW drainage) well enough to make the
 * model terrain-aware. Outputs are always labelled "spread potential", never
 * an official perimeter.
 */
import { pointInRing, ringCentroid, type LatLng } from './interpolatePolygon';
import { GRID, MODEL_CAP_MINUTES, SPEEDS, WIND } from '../data/spreadModelConfig';

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
  /** Unit axis direction (east, north). */
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

// ---- approximated landforms (Upper Las Virgenes Canyon area) ----
const RIDGE_NORTH = lineFeature(34.199, -118.7, 34.199, -118.66, 450); // Ahmanson high ground
const LV_CREEK = lineFeature(34.212, -118.7035, 34.16, -118.7035, 300); // Las Virgenes Creek canyon
const SW_DRAIN = lineFeature(34.186, -118.67, 34.176, -118.7, 220); // drainage from the trailhead WSW
const LASKY_MESA = { lat: 34.1765, lng: -118.688, radiusM: 520, heightM: 40 };
const CASTLE_PEAK = { lat: 34.179, lng: -118.66, radiusM: 260, heightM: 55 };

/** True where streets/structures dominate (West Hills, Hidden Hills, Bell Canyon). */
export function isDeveloped(lat: number, lng: number): boolean {
  if (lng > -118.6648) return true; // West Hills residential grid
  if (lat < 34.1712 && lng > -118.692) return true; // Hidden Hills
  if (lat < 34.168 && lng < -118.7) return true; // Bell Canyon
  return false;
}

/** True when any development lies within ~radiusM of the point. */
export function isNearDevelopment(lat: number, lng: number, radiusM: number): boolean {
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

/** Approximate elevation (m). Analytic stand-in for a DEM — see file header. */
export function approxElevation(lat: number, lng: number): number {
  const { x, y } = toXY(lat, lng);
  let elev =
    300 -
    0.018 * x + // gentle rise to the west
    0.012 * y + // gentle rise to the north
    85 * gauss(distToSegment(x, y, RIDGE_NORTH) / RIDGE_NORTH.halfWidthM) +
    55 * gauss(Math.hypot(x - toXY(CASTLE_PEAK.lat, CASTLE_PEAK.lng).x, y - toXY(CASTLE_PEAK.lat, CASTLE_PEAK.lng).y) / CASTLE_PEAK.radiusM) -
    60 * gauss(distToSegment(x, y, LV_CREEK) / LV_CREEK.halfWidthM) -
    26 * gauss(distToSegment(x, y, SW_DRAIN) / SW_DRAIN.halfWidthM);
  // Lasky Mesa: a flat-topped plateau rather than a peak
  const mesa = toXY(LASKY_MESA.lat, LASKY_MESA.lng);
  const mesaT = Math.hypot(x - mesa.x, y - mesa.y) / LASKY_MESA.radiusM;
  elev += LASKY_MESA.heightM * Math.min(1, Math.max(0, 1.4 - mesaT));
  // Developed flats sit lower and are graded
  if (isDeveloped(lat, lng)) elev = elev * 0.3 + 268 * 0.7;
  return elev;
}

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
  /** 0..1 burnable fuel (grass/chaparral = 1, developed ≈ 0.15). */
  fuel: Float32Array;
  developed: Uint8Array;
  /** Wildland fringe within ~160 m of development (structure-adjacent). */
  wui: Uint8Array;
  /** 0..1 canyon membership and the local canyon axis direction. */
  canyon: Float32Array;
  canDirX: Float32Array;
  canDirY: Float32Array;
}

let cachedGrid: TerrainGrid | null = null;

export function getTerrainGrid(): TerrainGrid {
  if (cachedGrid) return cachedGrid;
  const dLat = GRID.cellMeters / M_PER_DEG_LAT;
  const dLng = GRID.cellMeters / M_PER_DEG_LNG;
  const rows = Math.floor((GRID.latMax - GRID.latMin) / dLat) + 1;
  const cols = Math.floor((GRID.lngMax - GRID.lngMin) / dLng) + 1;
  const n = rows * cols;

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
    developed: new Uint8Array(n),
    wui: new Uint8Array(n),
    canyon: new Float32Array(n),
    canDirX: new Float32Array(n),
    canDirY: new Float32Array(n),
  };

  // Structure-adjacency fringe width: wildland within this distance of
  // development counts as the WUI edge (slightly slowed, flagged as risk).
  const WUI_FRINGE_M = 220;
  const eps = 60; // finite-difference step (m) for the slope estimate

  for (let r = 0; r < rows; r++) {
    const lat = GRID.latMin + r * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = GRID.lngMin + c * dLng;
      const i = r * cols + c;
      g.elev[i] = approxElevation(lat, lng);
      g.gradX[i] =
        (approxElevation(lat, lng + eps / M_PER_DEG_LNG) -
          approxElevation(lat, lng - eps / M_PER_DEG_LNG)) /
        (2 * eps);
      g.gradY[i] =
        (approxElevation(lat + eps / M_PER_DEG_LAT, lng) -
          approxElevation(lat - eps / M_PER_DEG_LAT, lng)) /
        (2 * eps);

      const dev = isDeveloped(lat, lng);
      g.developed[i] = dev ? 1 : 0;
      g.fuel[i] = dev ? 0.15 : 1;
      if (!dev && isNearDevelopment(lat, lng, WUI_FRINGE_M)) g.wui[i] = 1;

      // canyon channeling: strongest nearby canyon wins
      const { x, y } = toXY(lat, lng);
      const sCreek = gauss(distToSegment(x, y, LV_CREEK) / LV_CREEK.halfWidthM);
      const sDrain = gauss(distToSegment(x, y, SW_DRAIN) / SW_DRAIN.halfWidthM);
      if (sCreek >= sDrain) {
        g.canyon[i] = sCreek;
        g.canDirX[i] = LV_CREEK.ux;
        g.canDirY[i] = LV_CREEK.uy;
      } else {
        g.canyon[i] = sDrain;
        g.canDirX[i] = SW_DRAIN.ux;
        g.canDirY[i] = SW_DRAIN.uy;
      }
    }
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

/**
 * Directional spread speed (m/min) for a step arriving at cell `to`,
 * travelling along the unit direction (dirX east, dirY north).
 *
 * FARSITE/Huygens-style elliptical kernel:
 *  - Slope acts like added wind (Rothermel): an effective wind-slope vector
 *    sets the local head-spread direction; its magnitude U drives both the
 *    head rate and the ellipse elongation.
 *  - Rate at angle θ off the head direction follows the rear-focus ellipse
 *    polar form R(θ) = R_head·(1−ε)/(1−ε·cosθ): full rate at the head,
 *    ≈(1−ε) of it on the flanks, ≈(1−ε)/(1+ε) backing into the wind.
 *  - Length-to-breadth (hence eccentricity ε) grows with U, simplified after
 *    Anderson (1983) and clamped for heterogeneous terrain.
 *  - Canyon/drainage channeling multiplies speed along canyon axes; developed
 *    blocks (roads, irrigation, structure defense) act as near-barriers and
 *    the structure-adjacent WUI fringe is slightly slowed.
 */
export function stepSpeed(g: TerrainGrid, to: number, dirX: number, dirY: number): number {
  const fuel = g.fuel[to];

  // Effective wind-slope vector: wind plus an uphill-pointing slope term.
  const slopeMag = Math.hypot(g.gradX[to], g.gradY[to]);
  let effX = WIND.effectiveWindNumber * WIND_UNIT.x;
  let effY = WIND.effectiveWindNumber * WIND_UNIT.y;
  if (slopeMag > 1e-6) {
    const slopeNumber = Math.min(slopeMag / 0.35, 1) * SPEEDS.slopeWindEquivalent;
    effX += (g.gradX[to] / slopeMag) * slopeNumber;
    effY += (g.gradY[to] / slopeMag) * slopeNumber;
  }
  const U = Math.hypot(effX, effY);

  // Head rate of spread, scaled by fuel, dryness and the wind-slope number.
  const headRos = SPEEDS.baseFuel * fuel * SPEEDS.drynessFactor * (1 + SPEEDS.headWindFactor * U);

  // Elliptical direction dependence.
  const lb = Math.min(Math.max(1 + SPEEDS.lbPerU * U, SPEEDS.lbMin), SPEEDS.lbMax);
  const ecc = Math.sqrt(1 - 1 / (lb * lb));
  const cosTheta = U > 1e-6 ? (dirX * effX + dirY * effY) / U : 0;
  let speed = (headRos * (1 - ecc)) / (1 - ecc * cosTheta);

  // Canyon channeling: terrain funnels wind and convection along canyon axes.
  const canyonDot = Math.abs(dirX * g.canDirX[to] + dirY * g.canDirY[to]);
  speed *= 1 + SPEEDS.canyonFactor * g.canyon[to] * canyonDot;

  // Roads / developed-edge resistance, and the slightly-slowed WUI fringe.
  if (g.developed[to]) speed *= SPEEDS.developedFactor;
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

/** Binary min-heap keyed on arrival minutes. */
class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(index: number, priority: number): void {
    this.idx.push(index);
    this.pri.push(priority);
    let i = this.idx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { index: number; priority: number } {
    const top = { index: this.idx[0], priority: this.pri[0] };
    const lastIdx = this.idx.pop() as number;
    const lastPri = this.pri.pop() as number;
    if (this.idx.length > 0) {
      this.idx[0] = lastIdx;
      this.pri[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.pri.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.pri.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
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

/**
 * Minimum-travel-time (Dijkstra) propagation from the current front polygon.
 * Cells whose centre lies inside the front seed at time 0.
 */
export function computeArrivalField(
  frontRing: LatLng[],
  capMinutes: number = MODEL_CAP_MINUTES,
): ArrivalField {
  const g = getTerrainGrid();
  const n = g.rows * g.cols;
  const arrival = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const heap = new MinHeap();

  // Seed: cells inside the front (bounding-box prefilter keeps this cheap).
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
