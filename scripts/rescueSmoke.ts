/**
 * Node smoke test for the Help rescue flow against the live spread model.
 *
 * Replays the fire timeline (warped multi-point front, exactly as the scene
 * computes it), drops the simulated person on E Las Virgenes Canyon Rd,
 * lets the controller's pure route selection pick a way out, then walks the
 * person along the blue path in fire time while re-validating the remaining
 * path every fire-minute — asserting they are never inside the fire and
 * that they reach the safe zone for every resource type.
 *
 * Run: npx tsx scripts/rescueSmoke.ts
 */
import { SPREAD_STAGES } from '../src/data/kennethReconstruction';
import { HELP_CONFIG, PREDICTION_ZONE, WIND } from '../src/data/spreadModelConfig';
import { computeArrivalField, getTerrainGrid } from '../src/lib/arrivalTimeModel';
import {
  distToRingM,
  pathLengthM,
  pointAtArc,
  pointInRing,
  projectOnPath,
  type FireRiskSnapshot,
} from '../src/lib/fireRiskGeometry';
import { computeFrontierGamma, warpFront } from '../src/lib/frontierWarp';
import {
  prepareTransition,
  ringCentroid,
  type LatLng,
} from '../src/lib/interpolatePolygon';
import { clampRingOutside, extractContour } from '../src/lib/predictionBands';
import { ESCAPE_ROUTES, HELP_GPS_POSITION } from '../src/data/helpScenario';
import { destinationClear, selectEscapeRoute } from '../src/lib/helpController';
import { classifyUserRisk, scoreRoute } from '../src/lib/routeRiskScoring';
import { clamp, smoothstep01 } from '../src/lib/timeUtils';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const stageTimes = SPREAD_STAGES.map((s) => Date.parse(s.timeIso));
const transitions = SPREAD_STAGES.slice(0, -1).map((s, j) =>
  prepareTransition(s.ring, SPREAD_STAGES[j + 1].ring, 224),
);
const gammas = transitions.map((t) => computeFrontierGamma(t));

function frontAt(timeMs: number): LatLng[] {
  let interval = 0;
  for (let j = 0; j < stageTimes.length - 1; j++) if (timeMs >= stageTimes[j]) interval = j;
  const span = Math.max(stageTimes[interval + 1] - stageTimes[interval], 1);
  const p =
    timeMs >= stageTimes[stageTimes.length - 1]
      ? 1
      : clamp(smoothstep01((timeMs - stageTimes[interval]) / span), 0.01, 1);
  return warpFront(transitions[interval], gammas[interval], p);
}

function snapshotAt(timeMs: number): FireRiskSnapshot {
  const front = frontAt(timeMs);
  const atEnd = timeMs >= stageTimes[stageTimes.length - 1];
  let envelope: LatLng[] | null = null;
  if (!atEnd) {
    const field = computeArrivalField(front);
    const contour = extractContour(field, PREDICTION_ZONE.primaryMinutes);
    envelope = contour ? clampRingOutside(contour, front) : null;
  }
  return {
    frontRing: front,
    envelopeRing: envelope,
    tendrils: [],
    windBearingDeg: WIND.spreadBearingDeg,
    fireCentroid: ringCentroid(front),
    horizonMinutes: PREDICTION_ZONE.primaryMinutes,
  };
}

// ---- terrain patchiness sanity ----
{
  const g = getTerrainGrid();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < g.patch.length; i++) {
    min = Math.min(min, g.patch[i]);
    max = Math.max(max, g.patch[i]);
  }
  check(
    'patchiness is heterogeneous and bounded',
    min >= 0.4 && max <= 1.7 && max - min > 0.4,
    `range ${min.toFixed(2)}..${max.toFixed(2)}`,
  );
  const g2 = getTerrainGrid();
  check('patchiness is deterministic (cached grid stable)', g2.patch[1234] === g.patch[1234]);
}

// ---- the person's spot really is in the fire's path ----
{
  const finalRing = SPREAD_STAGES[SPREAD_STAGES.length - 1].ring;
  check(
    'simulated GPS position is overrun by the final footprint (susceptible)',
    pointInRing(HELP_GPS_POSITION, finalRing),
  );
  const early = snapshotAt(stageTimes[0] + 10 * 60_000);
  check(
    'person is not inside the fire at rescue start',
    !pointInRing(HELP_GPS_POSITION, early.frontRing),
    `risk class: ${classifyUserRisk(HELP_GPS_POSITION, early)}`,
  );
}

// ---- destinations keep their margins at every stage ----
for (const route of ESCAPE_ROUTES) {
  let clearAtAll = true;
  for (let j = 0; j < stageTimes.length; j++) {
    const snap = snapshotAt(stageTimes[j] + 1);
    if (!destinationClear(route.destination, snap)) clearAtAll = false;
  }
  check(`destination stays clear through all stages: ${route.destination.id}`, clearAtAll);
}

// ---- a route must exist at rescue start, and it should be the east one ----
{
  const t0 = stageTimes[0] + 4 * 60_000; // locate + chat in real time ≈ 4 fire-min
  const snap = snapshotAt(t0);
  const choice = selectEscapeRoute(snap, HELP_GPS_POSITION, HELP_CONFIG.movement.footMps);
  check('a low-risk escape route exists at rescue start', choice !== null);
  if (choice) {
    check(
      'primary choice leads into the city (east route)',
      choice.route.id === 'east-west-hills',
      `chose ${choice.route.id}`,
    );
  }
}

// ---- full escape simulation for every resource type ----
const speeds: Array<[string, number]> = [
  ['car', HELP_CONFIG.movement.carMps],
  ['bike', HELP_CONFIG.movement.bikeMps],
  ['foot', HELP_CONFIG.movement.footMps],
  ['limited', HELP_CONFIG.movement.limitedMps],
];

for (const [label, mps] of speeds) {
  const t0 = stageTimes[0] + 4 * 60_000;
  let snap = snapshotAt(t0);
  const first = selectEscapeRoute(snap, HELP_GPS_POSITION, mps);
  if (!first) {
    check(`escape (${label}): route available`, false);
    continue;
  }
  let path = first.path;
  let destination = first.route.destination;
  let routeId = first.route.id;
  let alongM = 0;
  let pos: LatLng = { ...HELP_GPS_POSITION };
  let burned = false;
  let arrived = false;
  let reroutes = 0;
  let minutes = 0;

  for (; minutes < 240 && !arrived && !burned; minutes++) {
    const now = t0 + minutes * 60_000;
    snap = snapshotAt(now);
    if (pointInRing(pos, snap.frontRing)) {
      burned = true;
      break;
    }
    // re-validate the remaining path from the current position (controller logic)
    const segIndex = projectOnPath(path, pos).segIndex;
    const ahead = [pos, ...path.slice(segIndex + 1)];
    if (ahead.length >= 2) {
      const rescored = scoreRoute(
        {
          destination,
          path: ahead,
          distanceM: pathLengthM(ahead),
          durationS: pathLengthM(ahead) / mps,
          source: 'authored',
        },
        snap,
      );
      if (rescored.status === 'rejected') {
        const alt = selectEscapeRoute(snap, pos, mps);
        if (alt) {
          path = alt.path;
          destination = alt.route.destination;
          alongM = 0;
          if (alt.route.id !== routeId) {
            routeId = alt.route.id;
            reroutes++;
          }
        }
      }
    }
    // one fire-minute of perfect movement along the blue path (arc length)
    alongM += mps * 60;
    const step = pointAtArc(path, alongM);
    pos = step.point;
    if (step.atEnd) arrived = true;
  }

  const finalDist = distToRingM(pos, snap.frontRing);
  check(
    `escape (${label}): reaches the safe zone unburned`,
    arrived && !burned,
    `route ${routeId}, ${minutes} fire-min, reroutes ${reroutes}, end ${Math.round(finalDist)} m from front`,
  );
}

process.exit(failures > 0 ? 1 : 0);
