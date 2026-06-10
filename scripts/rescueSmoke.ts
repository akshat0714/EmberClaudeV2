/**
 * Node smoke test for the urban Help rescue flow against the live model.
 *
 * Replays the simulated West Hills fire (warped multi-point front, exactly
 * as the scene computes it), drops the person on the residential street,
 * lets the controller's pure route selection pick a way out for "car" and
 * "on foot" (plus limited mobility), then walks the person along the blue
 * path in fire time while re-validating the remaining path every
 * fire-minute — asserting they are never inside the fire and reach the
 * safe zone. Also verifies the generated stage rings nest strictly.
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
  ringAreaAcres,
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

// ---- generated stage rings: strict nesting, house-scale start ----
{
  let nested = true;
  for (let j = 0; j + 1 < SPREAD_STAGES.length; j++) {
    for (const p of SPREAD_STAGES[j].ring) {
      if (!pointInRing(p, SPREAD_STAGES[j + 1].ring)) nested = false;
    }
  }
  check('stage rings nest strictly (house → block → region)', nested);
  const firstAcres = ringAreaAcres(SPREAD_STAGES[0].ring);
  const finalAcres = ringAreaAcres(SPREAD_STAGES[SPREAD_STAGES.length - 1].ring);
  check(
    'starts at single-house scale and ends at a neighborhood region',
    firstAcres < 0.5 && finalAcres > 80,
    `${firstAcres.toFixed(2)} → ${Math.round(finalAcres)} acres`,
  );
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
}

// Help is pressed while the fire is still creeping (idle slow burn) —
// roughly 8 fire-minutes after ignition, with NO reset of the fire.
const HELP_AT = stageTimes[0] + 8 * 60_000;

// ---- the person's street really is in the fire's path ----
{
  const finalRing = SPREAD_STAGES[SPREAD_STAGES.length - 1].ring;
  check(
    'simulated GPS position is overrun by the final region (susceptible)',
    pointInRing(HELP_GPS_POSITION, finalRing),
  );
  const early = snapshotAt(HELP_AT);
  check(
    'person is not inside the fire when Help is pressed',
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

// ---- the way out depends on what the person has ----
// A car runs far east on the boulevards to the evacuation center; on foot
// (including limited mobility) the walkway shortcut leads to the nearby
// park — short, crosswind, never toward the fire.
const RESOURCES: Array<{ label: string; mode: 'car' | 'foot'; mps: number; expect: string }> = [
  { label: 'car', mode: 'car', mps: HELP_CONFIG.movement.carMps, expect: 'car-victory-east' },
  { label: 'foot', mode: 'foot', mps: HELP_CONFIG.movement.footMps, expect: 'foot-victory-park' },
  {
    label: 'limited',
    mode: 'foot',
    mps: HELP_CONFIG.movement.limitedMps,
    expect: 'foot-victory-park',
  },
];

{
  const snap = snapshotAt(HELP_AT);
  for (const r of RESOURCES) {
    const choice = selectEscapeRoute(snap, HELP_GPS_POSITION, r.mps, r.mode);
    check(
      `route choice for ${r.label} is ${r.expect}`,
      choice !== null && choice.route.id === r.expect,
      choice ? `chose ${choice.route.id}` : 'no route',
    );
  }
}

// ---- full escape simulation ----
function simulateEscape(label: string, mode: 'car' | 'foot', mps: number, pressAt: number): void {
  let snap = snapshotAt(pressAt);
  const first = selectEscapeRoute(snap, HELP_GPS_POSITION, mps, mode);
  if (!first) {
    check(`escape (${label}): route available`, false);
    return;
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
    const now = pressAt + minutes * 60_000;
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
        const alt = selectEscapeRoute(snap, pos, mps, mode);
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
  if (label === 'limited') {
    check('limited-mobility escape stays short', arrived && minutes <= 30, `${minutes} fire-min`);
  }
}

for (const r of RESOURCES) simulateEscape(r.label, r.mode, r.mps, HELP_AT);
// a later press (fire already at the neighboring-homes stage) still works
simulateEscape('foot, later press', 'foot', HELP_CONFIG.movement.footMps, stageTimes[0] + 20 * 60_000);

process.exit(failures > 0 ? 1 : 0);
