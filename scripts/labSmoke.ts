/**
 * Node smoke test for the Prediction Lab: terrain hazards, barrier/ford
 * behavior of the shared minimum-travel-time solver, wind sensitivity of
 * the prediction, the full shifting-wind run (spot fire, monotone growth,
 * determinism) and the forecast-vs-reality grading.
 *
 * Run: npx tsx scripts/labSmoke.ts
 */
import { computeArrivalFieldOn } from '../src/lib/arrivalTimeModel';
import { buildLabWorld, SURFACE } from '../src/lib/labTerrain';
import {
  createLabSim,
  kernelDiagnostics,
  windAt,
  LAB_CONFIG,
  type ForecastGrade,
} from '../src/lib/labSim';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const world = buildLabWorld();
const { grid } = world;
const n = grid.rows * grid.cols;

// ---- world sanity ----
{
  let water = 0;
  let town = 0;
  let rock = 0;
  for (let i = 0; i < n; i++) {
    if (world.surface[i] === SURFACE.water) water++;
    if (world.surface[i] === SURFACE.town) town++;
    if (world.surface[i] === SURFACE.rock) rock++;
  }
  check(
    'world has river+lake, town and rock',
    water > 200 && town > 100 && rock > 50,
    `water ${water}, town ${town}, rock ${rock}`,
  );
  check('the ford is crossable (not water)', world.surface[world.cellAt(2050, 1850)] !== SURFACE.water);
  check('the spot-fire cell is burnable land', world.surface[world.spotCell] <= SURFACE.timber);
}

// ---- the river is a barrier; the ford is the way through ----
{
  const wind = windAt(10, false); // steady, toward 040°
  const field = computeArrivalFieldOn(grid, [world.ignitionCell], 150, wind.x, wind.y);
  const midRiver = field.arrival[world.cellAt(1400, 1550)];
  const northCell = world.cellAt(2300, 2050);
  const gapExit = field.arrival[world.cellAt(2100, 2000)];
  check('mid-river water cell is unreachable within the cap', !Number.isFinite(midRiver));
  check(
    'north side is reached through the ford',
    Number.isFinite(gapExit) && Number.isFinite(field.arrival[northCell]),
    `gap exit T=${gapExit?.toFixed(0)} min`,
  );
  // The PROOF that the solver found the way through: trace the
  // minimum-travel-time path of a north-side cell back along cameFrom —
  // it must pass within the ford.
  let cursor = northCell;
  let throughFord = false;
  for (let hops = 0; hops < 4000 && cursor >= 0; hops++) {
    const { x, y } = world.xyOf(cursor);
    if (Math.hypot(x - world.gapXY.x, y - world.gapXY.y) < 150) {
      throughFord = true;
      break;
    }
    cursor = field.cameFrom[cursor];
  }
  check('the minimum-travel-time path crosses AT the ford (cameFrom trace)', throughFord);
}

// ---- the prediction follows the wind ----
{
  const mkBearing = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: Math.sin(rad) * 1.8, y: Math.cos(rad) * 1.8 };
  };
  const centroidBearing = (windDeg: number): number => {
    const w = mkBearing(windDeg);
    const field = computeArrivalFieldOn(grid, [world.ignitionCell], LAB_CONFIG.horizonMin, w.x, w.y);
    const o = world.xyOf(world.ignitionCell);
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(field.arrival[i])) continue;
      const { x, y } = world.xyOf(i);
      sx += x - o.x;
      sy += y - o.y;
      count++;
    }
    return ((Math.atan2(sx / count, sy / count) * 180) / Math.PI + 360) % 360;
  };
  const b40 = centroidBearing(40);
  const b120 = centroidBearing(120);
  const diff = Math.abs(((b120 - b40 + 540) % 360) - 180);
  check(
    'rotating the wind rotates the predicted envelope',
    180 - diff > 40,
    `envelope centroid ${Math.round(b40)}° → ${Math.round(b120)}°`,
  );
}

// ---- kernel diagnostics sanity ----
{
  const k = kernelDiagnostics(world, world.ignitionCell, windAt(0, true));
  check(
    'kernel: back < flank < head, ε in (0,1)',
    k.rBack < k.rFlank && k.rFlank < k.rHead && k.eccentricity > 0 && k.eccentricity < 1,
    `R=${k.rHead.toFixed(1)}/${k.rFlank.toFixed(2)}/${k.rBack.toFixed(2)}, ε=${k.eccentricity.toFixed(3)}`,
  );
}

// ---- the full shifting-wind run ----
function fullRun(): { burned: number[]; grades: ForecastGrade[]; spotMin: number } {
  const sim = createLabSim(true);
  const burned: number[] = [sim.metrics.burnedCells];
  const grades: ForecastGrade[] = [];
  let spotMin = -1;
  let lastGradeKey = -1;
  while (!sim.metrics.done) {
    sim.step();
    burned.push(sim.metrics.burnedCells);
    if (spotMin < 0 && sim.metrics.spotIgnited) spotMin = sim.metrics.tauMin;
    const g = sim.metrics.lastGrade;
    if (g && g.madeAtMin !== lastGradeKey) {
      lastGradeKey = g.madeAtMin;
      grades.push(g);
    }
  }
  return { burned, grades, spotMin };
}

{
  const run = fullRun();
  const monotone = run.burned.every((v, i) => i === 0 || v >= run.burned[i - 1]);
  check('burned area grows monotonically', monotone);
  check('ember spot fire ignites mid-run', run.spotMin > 0 && run.spotMin <= LAB_CONFIG.spotAtMin + 2);

  const finalBurned = run.burned[run.burned.length - 1];
  const finalHa = finalBurned * 0.09;
  check(
    'final burned area is a serious but contained fire',
    finalHa > 120 && finalHa < 900,
    `${finalHa.toFixed(0)} ha of ${(n * 0.09).toFixed(0)} ha`,
  );

  const sim2 = createLabSim(true);
  while (!sim2.metrics.done) sim2.step();
  check('run is deterministic (replayable)', sim2.metrics.burnedCells === finalBurned);

  console.log(
    '      forecast grades:',
    run.grades.map((g) => `τ${g.madeAtMin}:${Math.round(g.hitRate * 100)}%`).join(' '),
  );
  const worst = Math.min(...run.grades.map((g) => g.hitRate));
  const best = Math.max(...run.grades.map((g) => g.hitRate));
  check(
    'the wind shift makes at least one forecast go visibly stale',
    run.grades.length >= 5 && worst < 0.9,
    `worst hit rate ${Math.round(worst * 100)}%`,
  );
  check(
    'the model still re-converges (some forecasts stay strong)',
    best > 0.9,
    `best hit rate ${Math.round(best * 100)}%`,
  );

  // fire actually makes it through the ford to the north side, and the
  // spot fire spreads on its own
  const simN = createLabSim(true);
  while (!simN.metrics.done) simN.step();
  const gapNorth = simN.igniteAt[world.cellAt(2100, 2000)];
  const spotEast = simN.igniteAt[world.cellAt(2600, 2150)];
  check(
    'fire crosses the river through the ford during the run',
    gapNorth <= LAB_CONFIG.endMin,
    `gap north ignites at τ=${Number.isFinite(gapNorth) ? gapNorth.toFixed(0) : '∞'}`,
  );
  check(
    'the ember spot fire spreads downwind on the north side',
    spotEast <= LAB_CONFIG.endMin,
    `τ=${Number.isFinite(spotEast) ? spotEast.toFixed(0) : '∞'}`,
  );
}

process.exit(failures > 0 ? 1 : 0);
