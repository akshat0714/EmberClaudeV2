/**
 * Node smoke tests for the fire model, sub-fire structure, prediction trees
 * and — most importantly — the fire-aware router's safety guarantees.
 *
 * Run: npm test  (tsx; loads the real bundled DEM + street data from
 * public/data so the tests exercise exactly what the app ships).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPREAD_STAGES } from '../src/data/kennethReconstruction';
import { NAV, SAFE_ZONES } from '../src/data/navConfig';
import { HOTSPOTS, SPOT_FIRES, TREE_STYLE } from '../src/data/spreadModelConfig';
import {
  cellIndexAt,
  computeArrivalField,
  getTerrainGrid,
  lengthToBreadth,
  stepSpeed,
  WIND_UNIT,
} from '../src/lib/arrivalTimeModel';
import { setDemData, type RawDem } from '../src/lib/dem';
import { intensityBands } from '../src/lib/fireIntensity';
import type { FireHazard, RouteTarget } from '../src/lib/fireAwareRouter';
import { routeToSafety } from '../src/lib/fireAwareRouter';
import { STAGE_TIMES } from '../src/lib/fireTimeline';
import { detectHotspots, scheduleSpotFires } from '../src/lib/hotspots';
import { ringAreaAcres, type LatLng } from '../src/lib/interpolatePolygon';
import { extractHotspotTrees } from '../src/lib/predictionTrees';
import { setStreetGraphData, snapToStreet, type RawStreetGraph } from '../src/lib/streetGraph';
import { buildSteps, buildTrack, formatDistanceImperial, trackProgress } from '../src/lib/turnByTurn';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- load the real bundled data ------------------------------------------
setDemData(JSON.parse(readFileSync(path.join(here, '../public/data/dem.json'), 'utf8')) as RawDem);
setStreetGraphData(
  JSON.parse(readFileSync(path.join(here, '../public/data/streets.json'), 'utf8')) as RawStreetGraph,
);

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;
const distM = (a: LatLng, b: LatLng) =>
  Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);

console.log('\n— fire shape (FARSITE RMRS-RP-4 Eq. 13) —');
check('LB(0) = 1 (calm)', Math.abs(lengthToBreadth(0) - 1) < 0.02, `${lengthToBreadth(0)}`);
check('LB(3.6 m/s) ≈ 2.2 (Kenneth conditions)', Math.abs(lengthToBreadth(3.6) - 2.22) < 0.1);
check('LB monotone in wind', lengthToBreadth(5) > lengthToBreadth(2));
check('LB capped at 8 (Alexander 1985)', lengthToBreadth(40) === 8);

console.log('\n— terrain grid (real data) —');
const grid = getTerrainGrid();
check('real DEM in use', grid.realDem);
check('real street-derived development in use', grid.realStreets);
const westHillsCell = cellIndexAt(grid, 34.195, -118.66); // residential grid
const preserveCell = cellIndexAt(grid, 34.186, -118.685); // open preserve
check('West Hills cell marked developed', grid.developed[westHillsCell] === 1);
check('preserve cell is open fuel', grid.developed[preserveCell] === 0);
const elevRange = (() => {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.elev.length; i++) {
    min = Math.min(min, grid.elev[i]);
    max = Math.max(max, grid.elev[i]);
  }
  return { min, max };
})();
check(
  'elevation range plausible for Simi Hills (USGS 3DEP)',
  elevRange.min > 150 && elevRange.max > 450 && elevRange.max < 800,
  `${elevRange.min.toFixed(0)}–${elevRange.max.toFixed(0)} m`,
);

console.log('\n— elliptical kernel anisotropy (GTR-371 §6.2) —');
const head = stepSpeed(grid, preserveCell, WIND_UNIT.x, WIND_UNIT.y);
const flank = stepSpeed(grid, preserveCell, -WIND_UNIT.y, WIND_UNIT.x);
const back = stepSpeed(grid, preserveCell, -WIND_UNIT.x, -WIND_UNIT.y);
check('head > flank > back', head > flank && flank > back, `${head.toFixed(1)}/${flank.toFixed(1)}/${back.toFixed(1)} m/min`);
check('head:back ratio strong under Santa Ana wind', head / back > 5, `${(head / back).toFixed(1)}`);
check(
  'head rate within documented Santa Ana envelope',
  head > 8 && head < 60,
  `${head.toFixed(1)} m/min`,
);

console.log('\n— minimum-travel-time field —');
const earlyFront = SPREAD_STAGES[1].ring;
const field = computeArrivalField(earlyFront, 45);
// ~450 m downwind (SSW, spread bearing 200°) vs ~450 m upwind (NNE) of the
// early front's centroid — both in open fuel
const downwindPoint: LatLng = { lat: 34.1812, lng: -118.6711 };
const upwindPoint: LatLng = { lat: 34.1886, lng: -118.6677 };
const aDown = field.arrival[cellIndexAt(grid, downwindPoint.lat, downwindPoint.lng)];
const aUp = field.arrival[cellIndexAt(grid, upwindPoint.lat, upwindPoint.lng)];
check('downwind point reached within the cap', Number.isFinite(aDown), `${aDown}`);
check('downwind arrival earlier than upwind', aDown < aUp, `${aDown?.toFixed?.(1)} vs ${aUp} min`);
let reached15 = 0;
let reached30 = 0;
for (let i = 0; i < field.arrival.length; i++) {
  if (field.arrival[i] <= 15) reached15++;
  if (field.arrival[i] <= 30) reached30++;
}
check('monotone growth (30-min area > 15-min area)', reached30 > reached15 * 1.2);
const deepUrban = field.arrival[cellIndexAt(grid, 34.1965, -118.652)];
check('urban fabric resists spread', !Number.isFinite(deepUrban) || deepUrban > aDown * 2.5);

console.log('\n— sub-fires: hotspots + ember spots —');
const stage3Front = SPREAD_STAGES[2].ring;
const hotspots = detectHotspots(stage3Front);
check(
  `hotspot count in [${HOTSPOTS.minCount}, ${HOTSPOTS.maxCount}]`,
  hotspots.length >= HOTSPOTS.minCount && hotspots.length <= HOTSPOTS.maxCount,
  `${hotspots.length}`,
);
let minSep = Infinity;
for (let i = 0; i < hotspots.length; i++) {
  for (let j = i + 1; j < hotspots.length; j++) {
    minSep = Math.min(minSep, distM(hotspots[i].point, hotspots[j].point));
  }
}
check('hotspots well separated', minSep >= HOTSPOTS.separationM * 0.5, `${minSep.toFixed(0)} m`);
check('hotspots sorted strongest-first', hotspots[0].headRateMpm >= hotspots[hotspots.length - 1].headRateMpm);

const spotsA = scheduleSpotFires(hotspots, 42);
const spotsB = scheduleSpotFires(hotspots, 42);
check('spot fires ≤ max active', spotsA.length <= SPOT_FIRES.maxActive, `${spotsA.length}`);
check(
  'spot scheduling deterministic per seed',
  JSON.stringify(spotsA) === JSON.stringify(spotsB),
);
for (const spot of spotsA) {
  const nearest = Math.min(...hotspots.map((h) => distM(h.point, spot.point)));
  check('spot within observed spotting range', nearest <= SPOT_FIRES.maxDistM * 1.4, `${nearest.toFixed(0)} m`);
  check('spot lands in burnable fuel', grid.developed[cellIndexAt(grid, spot.point.lat, spot.point.lng)] === 0);
}

console.log('\n— per-hotspot prediction trees —');
const stage3Field = computeArrivalField(stage3Front, 45);
const trees = extractHotspotTrees(stage3Field, hotspots, 30);
check('trees extracted', trees.length >= 6, `${trees.length} segments`);
check('at least half the segments are trunks', trees.filter((t) => t.isTrunk).length >= trees.length / 2 - 1);
check(
  'every segment endpoint within the horizon window',
  trees.every((t) => {
    const end = t.pts[t.pts.length - 1];
    const a = stage3Field.arrival[cellIndexAt(grid, end.lat, end.lng)];
    return Number.isFinite(a) && a <= 33;
  }),
);
const perHotspotCounts = new Map<number, number>();
for (const t of trees) perHotspotCounts.set(t.hotspot, (perHotspotCounts.get(t.hotspot) ?? 0) + 1);
check(
  `≤ ${TREE_STYLE.branchesPerHotspot} segments per hotspot`,
  [...perHotspotCounts.values()].every((n) => n <= TREE_STYLE.branchesPerHotspot),
);

console.log('\n— intensity bands (Byram / time-since-burned) —');
const midTime = STAGE_TIMES[2] + 20 * 60_000;
const bands = intensityBands(midTime);
check('multiple nested bands mid-fire', bands.length >= 3, `${bands.length}`);
const nested = bands.every(
  (b) => !b.inner || ringAreaAcres(b.outer) >= ringAreaAcres(b.inner) * 0.98,
);
check('bands strictly nested (outer ≥ inner)', nested);

console.log('\n— street snapping (real OSM graph) —');
const snap = snapToStreet({ lat: 34.19383, lng: -118.65961 }); // Vanowen & Valley Circle
check('snaps near a real street', snap !== null && snap.distM < 60, `${snap?.distM.toFixed(1)} m`);

console.log('\n— fire-aware routing —');
const targets: RouteTarget[] = SAFE_ZONES.map((z) => ({ id: z.id, name: z.name, point: z.point }));
const routingField = computeArrivalField(stage3Front, NAV.routingCapMinutes);
const hazard: FireHazard = {
  arrivalMinutes(p: LatLng): number {
    if (
      p.lat < grid.latMin ||
      p.lat > grid.latMin + (grid.rows - 1) * grid.dLat ||
      p.lng < grid.lngMin ||
      p.lng > grid.lngMin + (grid.cols - 1) * grid.dLng
    ) {
      return Infinity;
    }
    const a = routingField.arrival[cellIndexAt(grid, p.lat, p.lng)];
    return Number.isFinite(a) ? a : Infinity;
  },
};

const origin: LatLng = { lat: 34.18667, lng: -118.66306 }; // Victory trailhead edge
const { route, degraded } = routeToSafety(origin, targets, hazard, 'drive');
check('route found from the evacuation area', route !== null);
if (route) {
  check('route is fully safe (not degraded)', !degraded && route.safe);
  check(
    `route clearance ≥ hard margin (${NAV.hardMarginMin} min)`,
    route.minClearanceMin >= NAV.hardMarginMin,
    `${route.minClearanceMin.toFixed(1)} min`,
  );
  check('route reaches a real evacuation center', SAFE_ZONES.some((z) => z.id === route.target.id));
  check('plausible ETA (< 45 min)', route.totalMinutes < 45, `${route.totalMinutes.toFixed(1)} min`);

  // independent re-verification: walk the final path with the route's pace
  // and assert the clearance inequality everywhere (the core safety claim)
  const paceMinPerM = route.totalMinutes / Math.max(route.totalMeters, 1);
  let traveled = 0;
  let worst = Infinity;
  for (let i = 0; i < route.path.length; i++) {
    if (i > 0) traveled += distM(route.path[i - 1], route.path[i]);
    const clear = hazard.arrivalMinutes(route.path[i]) - traveled * paceMinPerM;
    worst = Math.min(worst, clear);
  }
  check(
    'independent path-walk clearance check',
    worst >= NAV.hardMarginMin - 1.5,
    `worst ${worst.toFixed(1)} min`,
  );

  console.log('\n— turn-by-turn —');
  const steps = buildSteps(route);
  check('starts with depart', steps[0]?.type === 'depart');
  check('ends with arrive', steps[steps.length - 1]?.type === 'arrive');
  const stepSum = steps.reduce((s, st) => s + st.lengthM, 0);
  check(
    'step lengths cover the route',
    Math.abs(stepSum - route.totalMeters) / route.totalMeters < 0.06,
    `${stepSum.toFixed(0)} vs ${route.totalMeters.toFixed(0)} m`,
  );
  check(
    'instructions carry real street names',
    steps.some((s) => /\b(Boulevard|Street|Road|Avenue|Drive|Way|Lane|Circle)\b/.test(s.instruction)),
  );

  const track = buildTrack(route);
  const onRoute = trackProgress(track, route.path[Math.floor(route.path.length / 2)]);
  check('on-route point has tiny offRoute', onRoute.offRouteM < 5, `${onRoute.offRouteM.toFixed(1)} m`);
  const mid = route.path[Math.floor(route.path.length / 2)];
  const offPoint: LatLng = { lat: mid.lat + 120 / M_PER_DEG_LAT, lng: mid.lng };
  const offProgress = trackProgress(track, offPoint);
  check(
    'off-route detection beyond threshold',
    offProgress.offRouteM > NAV.offRouteM,
    `${offProgress.offRouteM.toFixed(0)} m`,
  );
}

// a hazard that burns everything east of -118.62 almost immediately must
// push the router away from Pierce College (which sits east of it)
const eastBurningHazard: FireHazard = {
  arrivalMinutes: (p) => (p.lng > -118.62 ? 1 : Infinity),
};
const calabasasOrigin: LatLng = { lat: 34.15425, lng: -118.66395 };
const blocked = routeToSafety(calabasasOrigin, targets, eastBurningHazard, 'drive');
check('router avoids the burning east side', blocked.route !== null && blocked.route.target.id !== 'pierce-college', blocked.route?.target.name);
if (blocked.route) {
  const crossesEast = blocked.route.path.some((p) => p.lng > -118.62);
  check('blocked route never enters the burning area', !crossesEast);
}

// walking profile sanity
const walk = routeToSafety(calabasasOrigin, targets, hazard, 'walk');
check('walking route exists', walk.route !== null);
if (walk.route && route) {
  check('walking is slower than driving', walk.route.totalMinutes > route.totalMinutes);
  check('pedestrians never routed onto freeways', walk.route.edges.every((e) => !NAV.noPedestrianClasses.has(e.hw)));
}

console.log('\n— formatting —');
check('100 m → 350 ft', formatDistanceImperial(100) === '350 ft');
check('2000 m → 1.2 mi', formatDistanceImperial(2000) === '1.2 mi');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
