/**
 * Shared reconstruction timeline: the warped multi-point front at any clock
 * time. Used by the scene (current front), the intensity bands (past fronts)
 * and the navigation hazard (front for the routing field).
 */
import { SPREAD_STAGES } from '../data/kennethReconstruction';
import { WARP } from '../data/spreadModelConfig';
import { computeFrontierGamma, warpFront } from './frontierWarp';
import { prepareTransition, type LatLng, type RingTransition } from './interpolatePolygon';
import { clamp, countAtOrBefore, smoothstep01 } from './timeUtils';

export const STAGE_TIMES: number[] = SPREAD_STAGES.map((s) => Date.parse(s.timeIso));
export const TIMELINE_START = STAGE_TIMES[0];
export const TIMELINE_END = STAGE_TIMES[STAGE_TIMES.length - 1];

let transitions: RingTransition[] | null = null;
const gammas = new Map<number, Float64Array>();

export function getTransitions(): RingTransition[] {
  if (!transitions) {
    transitions = SPREAD_STAGES.slice(0, -1).map((stage, j) =>
      prepareTransition(stage.ring, SPREAD_STAGES[j + 1].ring, WARP.vertices),
    );
  }
  return transitions;
}

export function gammaFor(interval: number): Float64Array {
  let gamma = gammas.get(interval);
  if (!gamma) {
    gamma = computeFrontierGamma(getTransitions()[interval]);
    gammas.set(interval, gamma);
  }
  return gamma;
}

/** Precompute every interval's warp exponents (idle-time warmup). */
export function warmTimeline(): void {
  for (let j = 0; j < getTransitions().length; j++) gammaFor(j);
}

/** Drop cached warp exponents (the model grid changed, e.g. real DEM loaded). */
export function resetTimelineCache(): void {
  gammas.clear();
}

export interface TimelinePosition {
  interval: number;
  /** Eased progress within the interval, 0..1. */
  p: number;
  atEnd: boolean;
  /** Latest stage index reached. */
  stageIndex: number;
}

export function timelinePosition(timeMs: number): TimelinePosition {
  const stageIndex = Math.max(0, countAtOrBefore(STAGE_TIMES, timeMs) - 1);
  const atEnd = timeMs >= TIMELINE_END;
  const interval = Math.min(stageIndex, SPREAD_STAGES.length - 2);
  const span = Math.max(STAGE_TIMES[interval + 1] - STAGE_TIMES[interval], 1);
  const p = atEnd ? 1 : clamp(smoothstep01((timeMs - STAGE_TIMES[interval]) / span), 0, 1);
  return { interval, p, atEnd, stageIndex };
}

/** The reconstructed multi-point front at an arbitrary clock time. */
export function frontAtTime(timeMs: number): LatLng[] {
  const t = clamp(timeMs, TIMELINE_START, TIMELINE_END);
  const { interval, p } = timelinePosition(t);
  return warpFront(getTransitions()[interval], gammaFor(interval), Math.max(p, 0.001));
}
