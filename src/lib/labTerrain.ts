/**
 * The Prediction Lab's synthetic stress-test world.
 *
 * A deliberately nasty 4.2 × 3.0 km landscape, built to make prediction
 * HARD and to exercise every term of the spread model at once:
 *
 *  - two crossing ridges and a steep peak (slope acts like added wind),
 *  - a meandering river that is a hard barrier — except one narrow ford,
 *    so the minimum-travel-time solver must FIND the way through,
 *  - a lake (second barrier),
 *  - a side canyon that channels fire up toward the saddle,
 *  - a fuel mosaic (grass / brush / timber / bare rock) plus the same
 *    deterministic patchiness field as the scenario app,
 *  - a small town strip (developed cells, urban-fuel behavior).
 *
 * The world satisfies the SAME TerrainGrid interface as the scenario app,
 * so `stepSpeedWind`, `computeArrivalFieldOn`, `extractPathways` and friends
 * run on it verbatim — same algorithms, harder ground.
 */
import { patchinessAt, type TerrainGrid } from './arrivalTimeModel';
import { SPEEDS } from '../data/spreadModelConfig';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

export const LAB_CELL_M = 30;
export const LAB_WIDTH_M = 4200;
export const LAB_HEIGHT_M = 3000;

/** Surface classes for rendering and the legend. */
export const SURFACE = {
  grass: 0,
  brush: 1,
  timber: 2,
  rock: 3,
  town: 4,
  water: 5,
} as const;

export interface LabWorld {
  grid: TerrainGrid;
  /** SURFACE class per cell (render + legend). */
  surface: Uint8Array;
  ignitionCell: number;
  /** Ember spot-fire landing cell, across the river. */
  spotCell: number;
  /** The one crossable ford in the river. */
  gapXY: { x: number; y: number };
  cellAt(x: number, y: number): number;
  xyOf(cell: number): { x: number; y: number };
}

const gauss = (t: number) => Math.exp(-t * t);

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ux: number;
  uy: number;
}

function seg(x1: number, y1: number, x2: number, y2: number): Seg {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x1, y1, x2, y2, ux: dx / len, uy: dy / len };
}

function distToSeg(px: number, py: number, s: Seg): number {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (s.x1 + vx * t), py - (s.y1 + vy * t));
}

// ---- landforms ----
const RIDGE_A = seg(600, 2600, 3600, 2200); // long north-west ridge
const RIDGE_B = seg(1800, 300, 4200, 1100); // south-east ridge toward the town
const PEAK = { x: 3000, y: 2400, sigma: 380, height: 230 };
const SIDE_CANYON = seg(2350, 1800, 2900, 2350); // channels up to the saddle
const LAKE = { x: 950, y: 2350, rx: 330, ry: 210 };

/** River centerline, west to east, with one ford at the gap. */
const RIVER: Seg[] = [
  seg(0, 1500, 700, 1350),
  seg(700, 1350, 1400, 1550),
  seg(1400, 1550, 2050, 1850),
  seg(2050, 1850, 2700, 1750),
  seg(2700, 1750, 3300, 1150),
  seg(3300, 1150, 4200, 950),
];
const RIVER_HALFWIDTH = 50;
const GAP = { x: 2050, y: 1850, radius: 85 };

const TOWN = { x0: 3350, y0: 80, x1: 4200, y1: 680 };

function riverDist(x: number, y: number): number {
  let best = Infinity;
  for (const s of RIVER) best = Math.min(best, distToSeg(x, y, s));
  return best;
}

function riverAxis(x: number, y: number): Seg {
  let best = RIVER[0];
  let bestD = Infinity;
  for (const s of RIVER) {
    const d = distToSeg(x, y, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function rawElevation(x: number, y: number): number {
  let e =
    210 +
    0.012 * y +
    170 * gauss(distToSeg(x, y, RIDGE_A) / 300) +
    130 * gauss(distToSeg(x, y, RIDGE_B) / 260) +
    PEAK.height * gauss(Math.hypot(x - PEAK.x, y - PEAK.y) / PEAK.sigma) -
    55 * gauss(riverDist(x, y) / 130) -
    45 * gauss(distToSeg(x, y, SIDE_CANYON) / 140);
  // small deterministic relief so slopes are never perfectly smooth
  e += 18 * Math.sin(x / 260 + 1.3) * Math.cos(y / 310 + 0.4);
  const lakeT = Math.hypot((x - LAKE.x) / LAKE.rx, (y - LAKE.y) / LAKE.ry);
  if (lakeT < 1.25) e -= 40 * (1.25 - lakeT);
  return e;
}

function isWater(x: number, y: number): boolean {
  if (Math.hypot((x - LAKE.x) / LAKE.rx, (y - LAKE.y) / LAKE.ry) < 1) return true;
  if (riverDist(x, y) < RIVER_HALFWIDTH) {
    // the ford: the one place the river can be crossed
    if (Math.hypot(x - GAP.x, y - GAP.y) < GAP.radius) return false;
    return true;
  }
  return false;
}

function inTown(x: number, y: number): boolean {
  return x >= TOWN.x0 && x <= TOWN.x1 && y >= TOWN.y0 && y <= TOWN.y1;
}

let cached: LabWorld | null = null;

export function buildLabWorld(): LabWorld {
  if (cached) return cached;
  const cols = Math.round(LAB_WIDTH_M / LAB_CELL_M);
  const rows = Math.round(LAB_HEIGHT_M / LAB_CELL_M);
  const n = rows * cols;
  const dLat = LAB_CELL_M / M_PER_DEG_LAT;
  const dLng = LAB_CELL_M / M_PER_DEG_LNG;

  const grid: TerrainGrid = {
    rows,
    cols,
    latMin: 34.0,
    lngMin: -119.0,
    dLat,
    dLng,
    cellMeters: LAB_CELL_M,
    elev: new Float32Array(n),
    gradX: new Float32Array(n),
    gradY: new Float32Array(n),
    fuel: new Float32Array(n),
    patch: new Float32Array(n),
    developed: new Uint8Array(n),
    wui: new Uint8Array(n),
    canyon: new Float32Array(n),
    canDirX: new Float32Array(n),
    canDirY: new Float32Array(n),
  };
  const surface = new Uint8Array(n);

  for (let r = 0; r < rows; r++) {
    const y = r * LAB_CELL_M;
    for (let c = 0; c < cols; c++) {
      const x = c * LAB_CELL_M;
      const i = r * cols + c;
      grid.elev[i] = rawElevation(x, y);
      grid.patch[i] = patchinessAt(x, y);

      // canyon channeling: the river corridor and the side canyon
      const rDist = riverDist(x, y);
      const rMembership = gauss(rDist / 150);
      const sMembership = gauss(distToSeg(x, y, SIDE_CANYON) / 120);
      if (sMembership >= rMembership) {
        grid.canyon[i] = sMembership;
        grid.canDirX[i] = SIDE_CANYON.ux;
        grid.canDirY[i] = SIDE_CANYON.uy;
      } else {
        const axis = riverAxis(x, y);
        grid.canyon[i] = rMembership;
        grid.canDirX[i] = axis.ux;
        grid.canDirY[i] = axis.uy;
      }

      // surface / fuel mosaic
      const water = isWater(x, y);
      const town = !water && inTown(x, y);
      const elev = grid.elev[i];
      if (water) {
        surface[i] = SURFACE.water;
        grid.fuel[i] = 0.02; // effectively a barrier at the model cap
        grid.canyon[i] = 0;
      } else if (town) {
        surface[i] = SURFACE.town;
        grid.fuel[i] = SPEEDS.urbanFuel;
        grid.developed[i] = 1;
      } else if (Math.hypot(x - PEAK.x, y - PEAK.y) < 240 || elev > 560) {
        surface[i] = SURFACE.rock;
        grid.fuel[i] = 0.12;
      } else if (elev > 420) {
        surface[i] = SURFACE.timber;
        grid.fuel[i] = 0.45;
      } else if (elev > 300) {
        surface[i] = SURFACE.brush;
        grid.fuel[i] = 0.72;
      } else {
        surface[i] = SURFACE.grass;
        grid.fuel[i] = 1;
      }
    }
  }

  // slope from the finished elevation surface (central differences)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cw = Math.max(c - 1, 0);
      const ce = Math.min(c + 1, cols - 1);
      const rs = Math.max(r - 1, 0);
      const rn = Math.min(r + 1, rows - 1);
      grid.gradX[i] = (grid.elev[r * cols + ce] - grid.elev[r * cols + cw]) / ((ce - cw) * LAB_CELL_M);
      grid.gradY[i] = (grid.elev[rn * cols + c] - grid.elev[rs * cols + c]) / ((rn - rs) * LAB_CELL_M);
    }
  }

  // WUI fringe: burnable cells right against the town
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (grid.developed[i] || surface[i] === SURFACE.water) continue;
      const x = c * LAB_CELL_M;
      const y = r * LAB_CELL_M;
      if (x >= TOWN.x0 - 200 && y <= TOWN.y1 + 200 && x <= TOWN.x1 && y >= TOWN.y0 - 200) {
        grid.wui[i] = 1;
      }
    }
  }

  const cellAt = (x: number, y: number): number => {
    const r = Math.max(0, Math.min(rows - 1, Math.round(y / LAB_CELL_M)));
    const c = Math.max(0, Math.min(cols - 1, Math.round(x / LAB_CELL_M)));
    return r * cols + c;
  };
  const xyOf = (cell: number) => ({
    x: (cell % cols) * LAB_CELL_M,
    y: Math.floor(cell / cols) * LAB_CELL_M,
  });

  cached = {
    grid,
    surface,
    // in the grass valley south of the river, with the early wind pointing
    // the head straight at the ford
    ignitionCell: cellAt(1400, 1300),
    spotCell: cellAt(2350, 2150),
    gapXY: { x: GAP.x, y: GAP.y },
    cellAt,
    xyOf,
  };
  return cached;
}
