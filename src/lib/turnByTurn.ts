/**
 * Turn-by-turn guidance derived from a routed path over the real street
 * graph: maneuvers are classified from bearing changes at junctions and
 * carry the actual OSM street names, Google-Maps style ("In 500 ft, turn
 * left onto Vanowen Street").
 */
import type { EvacRoute } from './fireAwareRouter';
import type { LatLng } from './interpolatePolygon';
import { bearingDeg, distMeters } from './streetGraph';

export type ManeuverType =
  | 'depart'
  | 'continue'
  | 'slight-left'
  | 'slight-right'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'arrive';

export interface RouteStep {
  type: ManeuverType;
  /** Full instruction, e.g. "Turn left onto Vanowen Street". */
  instruction: string;
  /** Road being traveled AFTER the maneuver. */
  roadName?: string;
  /** Where the maneuver happens. */
  point: LatLng;
  /** Distance traveled on this step before the next maneuver, meters. */
  lengthM: number;
  /** Cumulative route distance at which this step begins, meters. */
  startCumM: number;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

function compass8(bearing: number): string {
  return COMPASS[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

/** Signed smallest angle from bearing a to bearing b, in (-180, 180]. */
export function bearingDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function maneuverFromDelta(delta: number): ManeuverType {
  const mag = Math.abs(delta);
  if (mag < 28) return 'continue';
  if (mag < 60) return delta < 0 ? 'slight-left' : 'slight-right';
  if (mag < 135) return delta < 0 ? 'left' : 'right';
  if (mag < 168) return delta < 0 ? 'sharp-left' : 'sharp-right';
  return 'uturn';
}

const TURN_WORD: Record<Exclude<ManeuverType, 'depart' | 'arrive' | 'continue'>, string> = {
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  left: 'Turn left',
  right: 'Turn right',
  'sharp-left': 'Turn sharply left',
  'sharp-right': 'Turn sharply right',
  uturn: 'Make a U-turn',
};

function instructionFor(type: ManeuverType, roadName: string | undefined, bearing: number): string {
  const onto = roadName ? ` onto ${roadName}` : '';
  if (type === 'depart') {
    return roadName ? `Head ${compass8(bearing)} on ${roadName}` : `Head ${compass8(bearing)}`;
  }
  if (type === 'continue') {
    return roadName ? `Continue on ${roadName}` : 'Continue straight';
  }
  if (type === 'arrive') return 'Arrive at your evacuation point';
  return `${TURN_WORD[type]}${onto}`;
}

/** Outgoing bearing of an edge's first meaningful segment. */
function headBearing(pts: LatLng[]): number {
  for (let i = 1; i < pts.length; i++) {
    if (distMeters(pts[0], pts[i]) > 4) return bearingDeg(pts[0], pts[i]);
  }
  return bearingDeg(pts[0], pts[pts.length - 1]);
}

/** Incoming bearing of an edge's last meaningful segment. */
function tailBearing(pts: LatLng[]): number {
  const last = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    if (distMeters(pts[i], last) > 4) return bearingDeg(pts[i], last);
  }
  return bearingDeg(pts[0], last);
}

/** Build the step list for a route. */
export function buildSteps(route: EvacRoute): RouteStep[] {
  const { edges, target } = route;
  if (edges.length === 0) return [];
  const steps: RouteStep[] = [];
  let cum = 0;

  const first = edges[0];
  steps.push({
    type: 'depart',
    instruction: instructionFor('depart', first.name, headBearing(first.pts)),
    roadName: first.name,
    point: first.pts[0],
    lengthM: first.lengthM,
    startCumM: 0,
  });
  cum += first.lengthM;

  for (let i = 1; i < edges.length; i++) {
    const prev = edges[i - 1];
    const next = edges[i];
    const delta = bearingDelta(tailBearing(prev.pts), headBearing(next.pts));
    const sameRoad = prev.name !== undefined && prev.name === next.name;
    let type = maneuverFromDelta(delta);
    if (type === 'continue' || (sameRoad && Math.abs(delta) < 50)) {
      // same road / straight through: extend the current step
      steps[steps.length - 1].lengthM += next.lengthM;
      cum += next.lengthM;
      continue;
    }
    // a real maneuver, but if the new road has the same name and the turn is
    // strong, keep the turn wording ("Turn left to stay on X").
    const roadName = next.name;
    let instruction = instructionFor(type, roadName, headBearing(next.pts));
    if (sameRoad && roadName) {
      instruction = `${TURN_WORD[type as keyof typeof TURN_WORD]} to stay on ${roadName}`;
    }
    steps.push({
      type,
      instruction,
      roadName,
      point: next.pts[0],
      lengthM: next.lengthM,
      startCumM: cum,
    });
    cum += next.lengthM;
  }

  steps.push({
    type: 'arrive',
    instruction: `Arrive at ${target.name}`,
    roadName: target.name,
    point: target.point,
    lengthM: 0,
    startCumM: cum,
  });
  return steps;
}

export interface RouteProgress {
  /** Step currently being executed (index into the steps array). */
  stepIndex: number;
  /** Distance until the NEXT maneuver, meters. */
  toManeuverM: number;
  /** Remaining distance to the destination, meters. */
  remainingM: number;
  /** Remaining time at the route's average pace, minutes. */
  remainingMin: number;
  /** How far the position lies off the route polyline, meters. */
  offRouteM: number;
  /** Closest point on the route. */
  snapped: LatLng;
  /** Distance along the route, meters. */
  alongM: number;
}

export interface RouteTrack {
  path: LatLng[];
  /** Cumulative distance at each path vertex, meters. */
  cum: number[];
  totalM: number;
  totalMin: number;
  steps: RouteStep[];
}

export function buildTrack(route: EvacRoute): RouteTrack {
  const steps = buildSteps(route);
  const cum: number[] = [0];
  for (let i = 1; i < route.path.length; i++) {
    cum.push(cum[i - 1] + distMeters(route.path[i - 1], route.path[i]));
  }
  return {
    path: route.path,
    cum,
    totalM: cum[cum.length - 1],
    totalMin: route.totalMinutes,
    steps,
  };
}

/** Project a position onto the route and locate guidance state. */
export function trackProgress(track: RouteTrack, position: LatLng): RouteProgress {
  const { path, cum, steps } = track;
  let bestD = Infinity;
  let bestAlong = 0;
  let snapped = path[0];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const vx = b.lng - a.lng;
    const vy = b.lat - a.lat;
    const wx = position.lng - a.lng;
    const wy = position.lat - a.lat;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    const p: LatLng = { lat: a.lat + vy * t, lng: a.lng + vx * t };
    const d = distMeters(position, p);
    if (d < bestD) {
      bestD = d;
      snapped = p;
      bestAlong = cum[i] + distMeters(a, p);
    }
  }

  // Current step = the last step whose start lies at/before our position;
  // bias slightly forward so "In 0 ft" flips to the next instruction cleanly.
  let stepIndex = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].startCumM <= bestAlong + 8) stepIndex = i;
  }
  const nextStart = stepIndex + 1 < steps.length ? steps[stepIndex + 1].startCumM : track.totalM;
  const remainingM = Math.max(track.totalM - bestAlong, 0);
  const paceMinPerM = track.totalMin / Math.max(track.totalM, 1);
  return {
    stepIndex,
    toManeuverM: Math.max(nextStart - bestAlong, 0),
    remainingM,
    remainingMin: remainingM * paceMinPerM,
    offRouteM: bestD,
    snapped,
    alongM: bestAlong,
  };
}

/** Route geometry from `alongM` onward (the not-yet-traveled part). */
export function remainingPath(track: RouteTrack, alongM: number): LatLng[] {
  const { path, cum } = track;
  if (alongM <= 0) return path;
  const out: LatLng[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    if (cum[i + 1] < alongM) continue;
    if (out.length === 0) {
      const segLen = cum[i + 1] - cum[i];
      const f = segLen > 0 ? (alongM - cum[i]) / segLen : 0;
      out.push({
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * f,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * f,
      });
    }
    out.push(path[i + 1]);
  }
  return out.length >= 2 ? out : path.slice(path.length - 2);
}

/** US-style distance wording: feet under ~0.18 mi, miles above. */
export function formatDistanceImperial(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 950) {
    const rounded = Math.max(50, Math.round(feet / 50) * 50);
    return `${rounded} ft`;
  }
  const miles = meters / 1609.344;
  return miles < 9.95 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
