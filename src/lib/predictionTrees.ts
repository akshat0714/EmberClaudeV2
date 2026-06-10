/**
 * Per-hotspot prediction trees: for each active head (sub-fire), the
 * minimum-travel-time predecessor tree of the spread model traced out to the
 * prediction horizon. The deepest route is the TRUNK (the head's most likely
 * run); other well-separated endpoints whose traces diverge from it become
 * BRANCHES — so each sub-fire renders as a branching, worm-like decision
 * tree of where it could go, all from validated model routes (never
 * decoration).
 */
import { TREE_STYLE } from '../data/spreadModelConfig';
import { cellLatLng, type ArrivalField } from './arrivalTimeModel';
import type { Hotspot } from './hotspots';
import type { LatLng } from './interpolatePolygon';
import { chaikinOpen } from './predictionBands';

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

export interface TreeSegment {
  pts: LatLng[];
  /** Trunk = the hotspot's deepest minimum-travel-time route. */
  isTrunk: boolean;
  /** Index of the owning hotspot. */
  hotspot: number;
}

function distM(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * M_PER_DEG_LNG);
}

/** Walk the predecessor chain from a cell back to its seed; root-first. */
function traceCells(field: ArrivalField, endIndex: number): number[] {
  const chain: number[] = [];
  let i = endIndex;
  let guard = 0;
  while (i !== -1 && guard++ < 4000) {
    chain.push(i);
    i = field.cameFrom[i];
  }
  chain.reverse();
  return chain;
}

/**
 * Extract branching prediction trees for the given hotspots.
 *
 * Endpoint candidates are cells whose modeled arrival falls in the outer
 * window of the horizon; each candidate is assigned to the hotspot nearest
 * its trace ROOT (where the route leaves the front), so every tree really
 * grows out of its own sub-fire.
 */
export function extractHotspotTrees(
  field: ArrivalField,
  hotspots: Hotspot[],
  horizonMinutes: number,
): TreeSegment[] {
  const { arrival } = field;
  const minMinutes = horizonMinutes * TREE_STYLE.windowFraction;
  const maxMinutes = horizonMinutes + 2;

  const candidates: Array<{ index: number; minutes: number }> = [];
  for (let i = 0; i < arrival.length; i++) {
    const a = arrival[i];
    if (a >= minMinutes && a <= maxMinutes) candidates.push({ index: i, minutes: a });
  }
  // deepest first: trunks should reach as far as the model allows
  candidates.sort((a, b) => b.minutes - a.minutes);

  const ASSIGN_RADIUS_M = 420;
  const perHotspot: number[] = hotspots.map(() => 0);
  const endpointsByHotspot: LatLng[][] = hotspots.map(() => []);
  const segments: TreeSegment[] = [];
  /** Cells already drawn per hotspot, so branches stop at the junction. */
  const drawnByHotspot: Array<Set<number>> = hotspots.map(() => new Set());

  for (const cand of candidates) {
    if (segments.length >= TREE_STYLE.maxPolylines) break;
    const chain = traceCells(field, cand.index);
    if (chain.length < 4) continue;
    const root = cellLatLng(field.grid, chain[0]);

    // nearest hotspot to the route's exit point from the front
    let best = -1;
    let bestD = ASSIGN_RADIUS_M;
    for (let h = 0; h < hotspots.length; h++) {
      const d = distM(root, hotspots[h].point);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best === -1) continue;
    if (perHotspot[best] >= TREE_STYLE.branchesPerHotspot) continue;

    const end = cellLatLng(field.grid, cand.index);
    if (endpointsByHotspot[best].some((p) => distM(p, end) < TREE_STYLE.separationMeters)) continue;

    const drawn = drawnByHotspot[best];
    const isTrunk = perHotspot[best] === 0;
    // branches start where the trace leaves already-drawn cells (junction)
    let startIdx = 0;
    if (!isTrunk) {
      for (let k = chain.length - 1; k >= 0; k--) {
        if (drawn.has(chain[k])) {
          startIdx = k;
          break;
        }
      }
      if (startIdx >= chain.length - 3) continue; // diverges too late to read
    }
    const pts = chain.slice(startIdx).map((i) => cellLatLng(field.grid, i));
    let runM = 0;
    for (let k = 0; k + 1 < pts.length; k++) runM += distM(pts[k], pts[k + 1]);
    if (isTrunk && runM < TREE_STYLE.minRunMeters) continue;
    if (!isTrunk && runM < TREE_STYLE.minRunMeters * 0.45) continue;

    for (const cell of chain) drawn.add(cell);
    perHotspot[best]++;
    endpointsByHotspot[best].push(end);
    segments.push({
      pts: chaikinOpen(pts, TREE_STYLE.smoothIterations),
      isTrunk,
      hotspot: best,
    });
  }
  return segments;
}
