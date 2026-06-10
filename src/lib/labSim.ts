/**
 * Prediction Lab simulation: the SAME minimum-travel-time model as the
 * scenario app (stepSpeedWind + computeArrivalFieldOn, verbatim), run as a
 * quasi-unsteady simulation under a wind that CHANGES over time.
 *
 * Method (event-scheduled MTT):
 *  - the fire keeps an IGNITION SCHEDULE: the absolute fire-minute each
 *    cell is due to ignite. Every fire-minute the burned frontier re-seeds
 *    a fresh Dijkstra under the CURRENT wind, and the schedule is composed
 *    as schedule = min(schedule, now + freshArrival): committed heating is
 *    never lost (slow flanks still arrive), while a wind shift toward a
 *    cell accelerates it immediately;
 *  - cells whose schedule passes `now` become burned,
 *  - the same fresh lookahead field doubles as the live 15-minute
 *    prediction drawn on screen,
 *  - an ember SPOT FIRE ignites across the river mid-run (merging fronts),
 *  - every 15 minutes the current prediction is archived and later graded
 *    against what actually burned (hit rate + cells missed) — when the wind
 *    shifts, the old forecast visibly fails and the model re-converges.
 *
 * Everything is deterministic (no randomness), so the run is replayable and
 * unit-testable.
 */
import {
  computeArrivalFieldOn,
  stepSpeedWind,
  type ArrivalField,
} from './arrivalTimeModel';
import { SPEEDS } from '../data/spreadModelConfig';
import { buildLabWorld, type LabWorld } from './labTerrain';

export const LAB_CONFIG = {
  /** Prediction horizon shown and graded, fire-minutes. */
  horizonMin: 15,
  /** Simulation advance per model refresh, fire-minutes. */
  stepMin: 1,
  /** Run length, fire-minutes. */
  endMin: 150,
  /** Ember spot fire lands across the river at this time. */
  spotAtMin: 35,
  /** Archive + grade a forecast every this many fire-minutes. */
  forecastEveryMin: 15,
  /** Lookahead cap for each refresh (a bit past the horizon). */
  capMin: 22,
  /** Wind schedule: steady, then a 40-minute rotation with a lull + surge. */
  wind: {
    startBearingDeg: 40,
    endBearingDeg: 120,
    shiftStartMin: 40,
    shiftEndMin: 80,
    startStrength: 1.8,
    lullStrength: 1.0,
    endStrength: 2.1,
  },
};

export interface WindState {
  bearingDeg: number;
  strength: number;
  /** Effective wind vector (strength × unit direction), east/north. */
  x: number;
  y: number;
  shifting: boolean;
}

/** Deterministic wind schedule with a gentle live wobble. */
export function windAt(tauMin: number, shiftingMode: boolean): WindState {
  const w = LAB_CONFIG.wind;
  let bearing = w.startBearingDeg;
  let strength = w.startStrength;
  let shifting = false;
  if (shiftingMode && tauMin > w.shiftStartMin) {
    const t = Math.min((tauMin - w.shiftStartMin) / (w.shiftEndMin - w.shiftStartMin), 1);
    const s = t * t * (3 - 2 * t); // smoothstep
    bearing = w.startBearingDeg + (w.endBearingDeg - w.startBearingDeg) * s;
    // lull in the middle of the shift, surge after it
    strength =
      t < 0.5
        ? w.startStrength + (w.lullStrength - w.startStrength) * (t * 2)
        : w.lullStrength + (w.endStrength - w.lullStrength) * ((t - 0.5) * 2);
    shifting = t < 1;
  }
  // small deterministic wobble so the live numbers visibly breathe
  bearing += 4 * Math.sin(tauMin * 0.55);
  strength += 0.06 * Math.sin(tauMin * 0.8 + 1.1);
  const rad = (bearing * Math.PI) / 180;
  return {
    bearingDeg: (bearing + 360) % 360,
    strength,
    x: Math.sin(rad) * strength,
    y: Math.cos(rad) * strength,
    shifting,
  };
}

export interface Forecast {
  madeAtMin: number;
  /** Mask of cells predicted to burn within the horizon (excludes already burned). */
  predicted: Uint8Array;
  graded: boolean;
}

export interface ForecastGrade {
  madeAtMin: number;
  /** Share of newly burned cells the forecast had covered (recall). */
  hitRate: number;
  missedCells: number;
  newlyBurnedCells: number;
}

/** Live numbers for the formula HUD, computed at the downwind head cell. */
export interface KernelDiagnostics {
  probeCell: number;
  windX: number;
  windY: number;
  slopeMag: number;
  effX: number;
  effY: number;
  U: number;
  fuel: number;
  headRos: number;
  lengthToBreadth: number;
  eccentricity: number;
  rHead: number;
  rFlank: number;
  rBack: number;
  canyonMult: number;
  patchMult: number;
  /** Final modified speed straight downwind at the probe (all multipliers). */
  speedDownwind: number;
}

export interface LabMetrics {
  tauMin: number;
  wind: WindState;
  burnedCells: number;
  burnedHa: number;
  settledCells: number;
  totalCells: number;
  dijkstraMs: number;
  predictedCells: number;
  predictedHa: number;
  headReachM: number;
  kernel: KernelDiagnostics | null;
  lastGrade: ForecastGrade | null;
  spotIgnited: boolean;
  done: boolean;
}

export interface LabSim {
  world: LabWorld;
  /** Absolute fire-minute each cell ignites (the schedule); Infinity = never. */
  igniteAt: Float64Array;
  tauMin: number;
  /** Latest lookahead field (T minutes from NOW under the current wind). */
  lookahead: ArrivalField | null;
  forecasts: Forecast[];
  metrics: LabMetrics;
  shiftingWind: boolean;
  isBurned(i: number): boolean;
  step(): void;
  reset(): void;
}

/** Mirror of the kernel formulas, exposed term by term for the live HUD. */
export function kernelDiagnostics(
  world: LabWorld,
  cell: number,
  wind: WindState,
): KernelDiagnostics {
  const g = world.grid;
  const slopeMag = Math.hypot(g.gradX[cell], g.gradY[cell]);
  let effX = wind.x;
  let effY = wind.y;
  if (slopeMag > 1e-6) {
    const slopeNumber = Math.min(slopeMag / 0.35, 1) * SPEEDS.slopeWindEquivalent;
    effX += (g.gradX[cell] / slopeMag) * slopeNumber;
    effY += (g.gradY[cell] / slopeMag) * slopeNumber;
  }
  const U = Math.hypot(effX, effY);
  const fuel = g.fuel[cell];
  const headRos = SPEEDS.baseFuel * fuel * SPEEDS.drynessFactor * (1 + SPEEDS.headWindFactor * U);
  const lb = Math.min(Math.max(1 + SPEEDS.lbPerU * U, SPEEDS.lbMin), SPEEDS.lbMax);
  const ecc = Math.sqrt(1 - 1 / (lb * lb));
  const headUnitX = U > 1e-6 ? effX / U : 0;
  const headUnitY = U > 1e-6 ? effY / U : 1;
  const canyonMult =
    1 +
    SPEEDS.canyonFactor *
      g.canyon[cell] *
      Math.abs(headUnitX * g.canDirX[cell] + headUnitY * g.canDirY[cell]);
  return {
    probeCell: cell,
    windX: wind.x,
    windY: wind.y,
    slopeMag,
    effX,
    effY,
    U,
    fuel,
    headRos,
    lengthToBreadth: lb,
    eccentricity: ecc,
    rHead: headRos,
    rFlank: headRos * (1 - ecc), // θ = 90°: cosθ = 0
    rBack: (headRos * (1 - ecc)) / (1 + ecc), // θ = 180°
    canyonMult,
    patchMult: g.patch[cell],
    speedDownwind: stepSpeedWind(g, cell, headUnitX, headUnitY, wind.x, wind.y),
  };
}

export function createLabSim(shiftingWind = true): LabSim {
  const world = buildLabWorld();
  const { rows, cols } = world.grid;
  const n = rows * cols;
  const cellHa = (world.grid.cellMeters * world.grid.cellMeters) / 10_000;

  const sim: LabSim = {
    world,
    igniteAt: new Float64Array(n).fill(Infinity),
    tauMin: 0,
    lookahead: null,
    forecasts: [],
    shiftingWind,
    metrics: {
      tauMin: 0,
      wind: windAt(0, shiftingWind),
      burnedCells: 0,
      burnedHa: 0,
      settledCells: 0,
      totalCells: n,
      dijkstraMs: 0,
      predictedCells: 0,
      predictedHa: 0,
      headReachM: 0,
      kernel: null,
      lastGrade: null,
      spotIgnited: false,
      done: false,
    },
    isBurned: (i) => sim.igniteAt[i] <= sim.tauMin,
    step,
    reset,
  };

  function frontierSeeds(): number[] {
    const seeds: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (sim.igniteAt[i] > sim.tauMin) continue;
        let edge = false;
        for (let dr = -1; dr <= 1 && !edge; dr++) {
          for (let dc = -1; dc <= 1 && !edge; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (sim.igniteAt[nr * cols + nc] > sim.tauMin) edge = true;
          }
        }
        if (edge) seeds.push(i);
      }
    }
    return seeds;
  }

  /** The frontier cell farthest downwind = the fire's head (HUD probe). */
  function probeCell(seeds: number[], wind: WindState): number {
    let best = seeds[0] ?? world.ignitionCell;
    let bestProj = -Infinity;
    for (const i of seeds) {
      const { x, y } = world.xyOf(i);
      const proj = x * wind.x + y * wind.y;
      if (proj > bestProj) {
        bestProj = proj;
        best = i;
      }
    }
    return best;
  }

  function gradeForecasts(): void {
    for (const f of sim.forecasts) {
      if (f.graded || sim.tauMin < f.madeAtMin + LAB_CONFIG.horizonMin) continue;
      f.graded = true;
      let newlyBurned = 0;
      let hits = 0;
      for (let i = 0; i < n; i++) {
        const t = sim.igniteAt[i];
        if (t > f.madeAtMin && t <= f.madeAtMin + LAB_CONFIG.horizonMin) {
          newlyBurned++;
          if (f.predicted[i]) hits++;
        }
      }
      sim.metrics = {
        ...sim.metrics,
        lastGrade: {
          madeAtMin: f.madeAtMin,
          hitRate: newlyBurned > 0 ? hits / newlyBurned : 1,
          missedCells: newlyBurned - hits,
          newlyBurnedCells: newlyBurned,
        },
      };
    }
  }

  function step(): void {
    if (sim.metrics.done) return;
    const wind = windAt(sim.tauMin, sim.shiftingWind);

    // ember spot fire across the river
    let spotIgnited = sim.metrics.spotIgnited;
    if (!spotIgnited && sim.tauMin >= LAB_CONFIG.spotAtMin) {
      sim.igniteAt[world.spotCell] = Math.min(sim.igniteAt[world.spotCell], sim.tauMin);
      spotIgnited = true;
    }

    // one Dijkstra serves both: re-scheduling ignition under the CURRENT
    // wind AND the 15-minute prediction drawn on screen
    const seeds = frontierSeeds();
    const t0 = performance.now();
    const field = computeArrivalFieldOn(world.grid, seeds, LAB_CONFIG.capMin, wind.x, wind.y);
    const dijkstraMs = performance.now() - t0;
    sim.lookahead = field;

    // compose the schedule: committed heating is never lost, a wind shift
    // toward a cell accelerates it immediately
    for (let i = 0; i < n; i++) {
      if (sim.igniteAt[i] <= sim.tauMin) continue; // already burned
      const fresh = field.arrival[i];
      if (Number.isFinite(fresh) && fresh > 0) {
        sim.igniteAt[i] = Math.min(sim.igniteAt[i], sim.tauMin + fresh);
      }
    }

    // archive a forecast on the cadence: the model's full current belief —
    // the composed ignition schedule within the horizon. Under steady wind
    // this grades near-perfect; a wind shift makes it visibly fail.
    if (sim.tauMin % LAB_CONFIG.forecastEveryMin === 0) {
      const predicted = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (sim.igniteAt[i] > sim.tauMin && sim.igniteAt[i] <= sim.tauMin + LAB_CONFIG.horizonMin) {
          predicted[i] = 1;
        }
      }
      sim.forecasts.push({ madeAtMin: sim.tauMin, predicted, graded: false });
      if (sim.forecasts.length > 12) sim.forecasts.shift();
    }

    // advance the clock; cells whose schedule passes become burned
    sim.tauMin += LAB_CONFIG.stepMin;
    gradeForecasts();

    // metrics for the HUD
    let burnedCells = 0;
    let settled = 0;
    let predictedCells = 0;
    for (let i = 0; i < n; i++) {
      if (sim.igniteAt[i] <= sim.tauMin) burnedCells++;
      if (Number.isFinite(field.arrival[i])) settled++;
      if (sim.igniteAt[i] > sim.tauMin && field.arrival[i] <= LAB_CONFIG.horizonMin) {
        predictedCells++;
      }
    }
    const probe = probeCell(seeds, wind);
    const kernel = kernelDiagnostics(world, probe, wind);

    sim.metrics = {
      tauMin: sim.tauMin,
      wind,
      burnedCells,
      burnedHa: burnedCells * cellHa,
      settledCells: settled,
      totalCells: n,
      dijkstraMs,
      predictedCells,
      predictedHa: predictedCells * cellHa,
      headReachM: kernel.speedDownwind * LAB_CONFIG.horizonMin,
      kernel,
      lastGrade: sim.metrics.lastGrade,
      spotIgnited,
      done: sim.tauMin >= LAB_CONFIG.endMin,
    };
  }

  function reset(): void {
    sim.igniteAt.fill(Infinity);
    sim.igniteAt[world.ignitionCell] = 0;
    sim.tauMin = 0;
    sim.lookahead = null;
    sim.forecasts = [];
    sim.metrics = { ...sim.metrics, lastGrade: null, spotIgnited: false, done: false };
    step(); // produce the first field so the screen is never empty
  }

  reset();
  return sim;
}
