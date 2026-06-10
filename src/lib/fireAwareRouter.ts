/**
 * Fire-aware evacuation routing over the real street graph.
 *
 * The router is a time-dependent A* in the spirit of the wildfire-evacuation
 * "trigger buffer" literature (Cova et al. 2005; Dennison, Cova & Moritz
 * 2007 — see RESEARCH.md): a road segment is only usable if the FIRE'S
 * predicted arrival time at every point of the segment trails the EVACUEE'S
 * arrival time there by at least a safety margin. The fire side comes from
 * the same minimum-travel-time spread model that draws the prediction
 * overlay; the evacuee side comes from per-edge travel times on the real
 * street network.
 *
 *   clearance(point) = fireArrival(point) − evacueeArrival(point)
 *   edge usable      ⇔ min clearance over the edge ≥ hardMarginMin
 *   edge discouraged ⇔ min clearance over the edge < softMarginMin
 *                      (cost multiplied — kept as a last resort)
 *
 * So a street that is open RIGHT NOW but predicted to be overrun before you
 * would clear it is rejected, which is exactly the failure mode that traps
 * people in WUI evacuations.
 */
import { NAV } from '../data/navConfig';
import type { LatLng } from './interpolatePolygon';
import { MinHeap } from './minHeap';
import {
  distMeters,
  getStreetGraph,
  orientedPoints,
  snapToStreet,
  type SnapResult,
  type StreetEdge,
} from './streetGraph';

export type TravelMode = 'drive' | 'walk';

export interface FireHazard {
  /**
   * Minutes from the route's departure time until fire is predicted to reach
   * this point. ≤ 0 = burning or burned; Infinity = not predicted within the
   * model horizon (treated as safe — far beyond any evacuation timescale).
   */
  arrivalMinutes(p: LatLng): number;
}

export interface RouteTarget {
  id: string;
  name: string;
  point: LatLng;
}

export interface RouteEdge {
  edgeIndex: number;
  name?: string;
  hw: string;
  /** Oriented geometry in travel direction. */
  pts: LatLng[];
  lengthM: number;
  enterMin: number;
  exitMin: number;
}

export interface EvacRoute {
  target: RouteTarget;
  edges: RouteEdge[];
  /** Full polyline from the snapped origin to the snapped target. */
  path: LatLng[];
  totalMinutes: number;
  totalMeters: number;
  /** Worst clearance (minutes) between the evacuee and the predicted fire. */
  minClearanceMin: number;
  /** True when the whole route satisfies the hard safety margin. */
  safe: boolean;
  mode: TravelMode;
}

/** Travel speed (m/s) on an edge for a mode — real signed limit when mapped. */
export function edgeSpeedMps(edge: StreetEdge, mode: TravelMode): number {
  if (mode === 'walk') return NAV.walkSpeedMps;
  const limitKmh = edge.kmh ?? NAV.defaultSpeedKmh[edge.hw] ?? NAV.defaultSpeedKmh.residential;
  return (limitKmh / 3.6) * NAV.evacSpeedFactor;
}

function modeAllows(edge: StreetEdge, mode: TravelMode): boolean {
  if (mode === 'walk') return !NAV.noPedestrianClasses.has(edge.hw);
  return true;
}

/**
 * Walk an oriented geometry, sampling clearance every ≤ sampleM meters.
 * Returns the minimum clearance (minutes) along it, where clearance =
 * hazard arrival − evacuee arrival.
 */
function minClearanceAlong(
  pts: LatLng[],
  enterMin: number,
  speedMps: number,
  hazard: FireHazard,
  sampleM: number,
): number {
  let minClear = Infinity;
  let traveled = 0;
  for (let s = 0; s < pts.length; s++) {
    if (s > 0) traveled += distMeters(pts[s - 1], pts[s]);
    const tHere = enterMin + traveled / 60 / speedMps;
    const clear = hazard.arrivalMinutes(pts[s]) - tHere;
    if (clear < minClear) minClear = clear;
    // intermediate samples on long segments
    if (s + 1 < pts.length) {
      const segLen = distMeters(pts[s], pts[s + 1]);
      const extra = Math.floor(segLen / sampleM);
      for (let k = 1; k <= extra; k++) {
        const f = k / (extra + 1);
        const p = {
          lat: pts[s].lat + (pts[s + 1].lat - pts[s].lat) * f,
          lng: pts[s].lng + (pts[s + 1].lng - pts[s].lng) * f,
        };
        const t = enterMin + (traveled + segLen * f) / 60 / speedMps;
        const c = hazard.arrivalMinutes(p) - t;
        if (c < minClear) minClear = c;
      }
    }
  }
  return minClear;
}

const toLatLng = (pts: Array<[number, number]>): LatLng[] =>
  pts.map(([lat, lng]) => ({ lat, lng }));

interface SearchOptions {
  hardMarginMin: number;
  softMarginMin: number;
}

interface NodeLabel {
  costMin: number;
  timeMin: number;
  fromNode: number;
  viaEdge: number;
}

/**
 * One A* search from a snapped origin to the best-reachable target.
 * Returns null when no target is reachable under the given margins.
 */
function search(
  originSnap: SnapResult,
  origin: LatLng,
  targets: Array<{ target: RouteTarget; snap: SnapResult }>,
  hazard: FireHazard,
  mode: TravelMode,
  departDelayMin: number,
  opts: SearchOptions,
): EvacRoute | null {
  const graph = getStreetGraph();
  if (!graph) return null;
  const n = graph.nodes.length;

  const labels = new Map<number, NodeLabel>();
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  const vMax =
    mode === 'walk'
      ? NAV.walkSpeedMps
      : (Math.max(...Object.values(NAV.defaultSpeedKmh)) / 3.6) * NAV.evacSpeedFactor;
  const heuristic = (node: number): number => {
    const p = { lat: graph.nodes[node][0], lng: graph.nodes[node][1] };
    let best = Infinity;
    for (const t of targets) {
      const d = distMeters(p, t.target.point);
      if (d < best) best = d;
    }
    return best / 60 / vMax;
  };

  /**
   * Try to traverse `pts` (already oriented) entering at `timeMin`.
   * Returns the soft-penalized cost and exit time, or null when blocked.
   */
  const traverse = (
    pts: LatLng[],
    lengthM: number,
    timeMin: number,
    speedMps: number,
  ): { addCost: number; addTime: number } | null => {
    const clear = minClearanceAlong(pts, timeMin, speedMps, hazard, NAV.clearanceSampleM);
    if (clear < opts.hardMarginMin) return null;
    const travelMin = lengthM / 60 / speedMps + NAV.intersectionPenaltyMin;
    const penalty = clear < opts.softMarginMin ? NAV.softPenaltyFactor : 1;
    return { addCost: travelMin * penalty, addTime: travelMin };
  };

  // ---- seed: from the snapped origin point toward each reachable endpoint
  const originEdge = graph.edges[originSnap.edgeIndex];
  const originSpeed = edgeSpeedMps(originEdge, mode);
  const seed = (towardNode: number) => {
    if (!modeAllows(originEdge, mode)) return;
    const forward = towardNode === originEdge.b; // travel a→b?
    if (mode === 'drive' && originEdge.ow === 1 && !forward) return;
    if (mode === 'drive' && originEdge.ow === -1 && forward) return;
    const full = toLatLng(forward ? originEdge.pts : [...originEdge.pts].reverse());
    const along = forward ? originSnap.alongM : originEdge.lenM - originSnap.alongM;
    // partial geometry from the snap point to that endpoint
    const pts = partialFrom(full, originEdge.lenM - along === 0 ? 0 : along);
    pts.unshift(originSnap.point);
    const lengthM = originEdge.lenM - along;
    const result = traverse(pts, lengthM, departDelayMin, originSpeed);
    if (!result) return;
    const label = labels.get(towardNode);
    const cost = result.addCost;
    if (!label || cost < label.costMin) {
      labels.set(towardNode, {
        costMin: cost,
        timeMin: departDelayMin + result.addTime,
        fromNode: -1,
        viaEdge: originSnap.edgeIndex,
      });
      heap.push(towardNode, cost + heuristic(towardNode));
    }
  };
  seed(originEdge.a);
  seed(originEdge.b);

  // ---- target bookkeeping: targets live mid-edge too
  const targetsByEdge = new Map<number, Array<{ target: RouteTarget; snap: SnapResult }>>();
  for (const t of targets) {
    const list = targetsByEdge.get(t.snap.edgeIndex) ?? [];
    list.push(t);
    targetsByEdge.set(t.snap.edgeIndex, list);
  }

  interface BestFinish {
    target: RouteTarget;
    snap: SnapResult;
    costMin: number;
    timeMin: number;
    endNode: number;
    finalPts: LatLng[];
    finalLenM: number;
  }
  // holder object: `v` is assigned inside tryFinish, which TS's control-flow
  // narrowing can't see through for a plain captured `let`
  const bestRef: { v: BestFinish | null } = { v: null };

  /** When settling `node`, check finishing along an incident target edge. */
  const tryFinish = (node: number, label: NodeLabel) => {
    for (const edgeIndex of graph.adjacency[node]) {
      const finals = targetsByEdge.get(edgeIndex);
      if (!finals) continue;
      const edge = graph.edges[edgeIndex];
      if (!modeAllows(edge, mode)) continue;
      const forward = node === edge.a;
      if (mode === 'drive' && edge.ow === 1 && !forward) continue;
      if (mode === 'drive' && edge.ow === -1 && forward) continue;
      const speed = edgeSpeedMps(edge, mode);
      for (const t of finals) {
        const along = forward ? t.snap.alongM : edge.lenM - t.snap.alongM;
        const oriented = toLatLng(orientedPoints(edge, node));
        const pts = truncateTo(oriented, along);
        pts.push(t.snap.point);
        const result = traverse(pts, along, label.timeMin, speed);
        if (!result) continue;
        const total = label.costMin + result.addCost;
        if (!bestRef.v || total < bestRef.v.costMin) {
          bestRef.v = {
            target: t.target,
            snap: t.snap,
            costMin: total,
            timeMin: label.timeMin + result.addTime,
            endNode: node,
            finalPts: pts,
            finalLenM: along,
          };
        }
      }
    }
  };

  // ---- main loop
  let guard = 0;
  while (heap.size > 0 && guard++ < 400_000) {
    const { index: node, priority } = heap.pop();
    if (closed[node]) continue;
    const label = labels.get(node);
    if (!label) continue;
    const settled = bestRef.v;
    if (settled && priority >= settled.costMin) break;
    closed[node] = 1;
    tryFinish(node, label);

    for (const edgeIndex of graph.adjacency[node]) {
      const edge = graph.edges[edgeIndex];
      if (!modeAllows(edge, mode)) continue;
      const forward = node === edge.a;
      const other = forward ? edge.b : edge.a;
      if (closed[other]) continue;
      if (mode === 'drive' && edge.ow === 1 && !forward) continue;
      if (mode === 'drive' && edge.ow === -1 && forward) continue;
      const speed = edgeSpeedMps(edge, mode);
      const pts = toLatLng(orientedPoints(edge, node));
      const result = traverse(pts, edge.lenM, label.timeMin, speed);
      if (!result) continue;
      const cost = label.costMin + result.addCost;
      const existing = labels.get(other);
      if (!existing || cost < existing.costMin) {
        labels.set(other, {
          costMin: cost,
          timeMin: label.timeMin + result.addTime,
          fromNode: node,
          viaEdge: edgeIndex,
        });
        heap.push(other, cost + heuristic(other));
      }
    }
  }

  const chosen = bestRef.v;
  if (!chosen) return null;

  // ---- reconstruct path: origin partial edge, middle edges, target partial
  const edgesOut: RouteEdge[] = [];
  const chain: Array<{ node: number; label: NodeLabel }> = [];
  let cursor: number | undefined = chosen.endNode;
  while (cursor !== undefined && cursor !== -1) {
    const label = labels.get(cursor);
    if (!label) break;
    chain.push({ node: cursor, label });
    cursor = label.fromNode;
  }
  chain.reverse(); // origin-side first

  let timeCursor = departDelayMin;
  let prevPoint: LatLng = originSnap.point;
  const path: LatLng[] = [origin, originSnap.point];
  for (const { node, label } of chain) {
    const edge = graph.edges[label.viaEdge];
    const speed = edgeSpeedMps(edge, mode);
    let pts: LatLng[];
    let lengthM: number;
    if (label.fromNode === -1) {
      // origin partial edge: from snap point to `node`
      const forward = node === edge.b;
      const full = toLatLng(forward ? edge.pts : [...edge.pts].reverse());
      const along = forward ? originSnap.alongM : edge.lenM - originSnap.alongM;
      pts = partialFrom(full, along);
      pts.unshift(originSnap.point);
      lengthM = edge.lenM - along;
    } else {
      pts = toLatLng(orientedPoints(edge, label.fromNode));
      lengthM = edge.lenM;
    }
    const exitMin = timeCursor + lengthM / 60 / speed + NAV.intersectionPenaltyMin;
    edgesOut.push({
      edgeIndex: label.viaEdge,
      name: edge.name,
      hw: edge.hw,
      pts,
      lengthM,
      enterMin: timeCursor,
      exitMin,
    });
    timeCursor = exitMin;
    for (const p of pts) {
      if (distMeters(p, prevPoint) > 0.5) {
        path.push(p);
        prevPoint = p;
      }
    }
  }
  // target partial edge
  {
    const edge = graph.edges[chosen.snap.edgeIndex];
    const speed = edgeSpeedMps(edge, mode);
    const exitMin = timeCursor + chosen.finalLenM / 60 / speed;
    edgesOut.push({
      edgeIndex: chosen.snap.edgeIndex,
      name: edge.name,
      hw: edge.hw,
      pts: chosen.finalPts,
      lengthM: chosen.finalLenM,
      enterMin: timeCursor,
      exitMin,
    });
    for (const p of chosen.finalPts) {
      if (distMeters(p, prevPoint) > 0.5) {
        path.push(p);
        prevPoint = p;
      }
    }
    timeCursor = exitMin;
  }
  path.push(chosen.target.point);

  let totalMeters = 0;
  for (const e of edgesOut) totalMeters += e.lengthM;
  let minClearance = Infinity;
  for (const e of edgesOut) {
    const speed = e.lengthM / 60 / Math.max(e.exitMin - e.enterMin - NAV.intersectionPenaltyMin, 1e-6);
    const c = minClearanceAlong(e.pts, e.enterMin, speed, hazard, NAV.clearanceSampleM);
    if (c < minClearance) minClearance = c;
  }

  return {
    target: chosen.target,
    edges: edgesOut,
    path,
    totalMinutes: timeCursor,
    totalMeters,
    minClearanceMin: minClearance,
    safe: minClearance >= NAV.hardMarginMin,
    mode,
  };
}

/** Geometry suffix starting `alongM` meters into the oriented polyline. */
function partialFrom(pts: LatLng[], alongM: number): LatLng[] {
  if (alongM <= 0) return pts.slice();
  let traveled = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const seg = distMeters(pts[s], pts[s + 1]);
    if (traveled + seg >= alongM) {
      const f = seg > 0 ? (alongM - traveled) / seg : 0;
      const cut: LatLng = {
        lat: pts[s].lat + (pts[s + 1].lat - pts[s].lat) * f,
        lng: pts[s].lng + (pts[s + 1].lng - pts[s].lng) * f,
      };
      return [cut, ...pts.slice(s + 1)];
    }
    traveled += seg;
  }
  return [pts[pts.length - 1]];
}

/** Geometry prefix covering the first `alongM` meters of the polyline. */
function truncateTo(pts: LatLng[], alongM: number): LatLng[] {
  const out: LatLng[] = [pts[0]];
  let traveled = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const seg = distMeters(pts[s], pts[s + 1]);
    if (traveled + seg >= alongM) {
      const f = seg > 0 ? (alongM - traveled) / seg : 0;
      out.push({
        lat: pts[s].lat + (pts[s + 1].lat - pts[s].lat) * f,
        lng: pts[s].lng + (pts[s + 1].lng - pts[s].lng) * f,
      });
      return out;
    }
    traveled += seg;
    out.push(pts[s + 1]);
  }
  return out;
}

export interface RoutingResult {
  route: EvacRoute | null;
  /** Why no fully-safe route exists, when applicable. */
  degraded: boolean;
}

/**
 * Route from `origin` to the best-reachable safe zone.
 *
 * Pass 1 enforces the full hard safety margin. If nothing is reachable, a
 * fallback pass relaxes the hard margin to the survival minimum so the app
 * can still point somewhere rather than going silent — flagged `degraded`
 * and rendered as a warning, never as a safe route.
 */
export function routeToSafety(
  origin: LatLng,
  targets: RouteTarget[],
  hazard: FireHazard,
  mode: TravelMode,
  departDelayMin = 0,
): RoutingResult {
  const originSnap = snapToStreet(origin, NAV.maxSnapM);
  if (!originSnap) return { route: null, degraded: false };
  const snapped = targets
    .map((target) => ({ target, snap: snapToStreet(target.point, NAV.maxSnapM)! }))
    .filter((t) => t.snap !== null);
  if (snapped.length === 0) return { route: null, degraded: false };

  const strict = search(originSnap, origin, snapped, hazard, mode, departDelayMin, {
    hardMarginMin: NAV.hardMarginMin,
    softMarginMin: NAV.softMarginMin,
  });
  if (strict) return { route: strict, degraded: false };

  const relaxed = search(originSnap, origin, snapped, hazard, mode, departDelayMin, {
    hardMarginMin: NAV.survivalMarginMin,
    softMarginMin: NAV.softMarginMin,
  });
  return { route: relaxed, degraded: relaxed !== null };
}
