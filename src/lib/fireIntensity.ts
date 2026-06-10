/**
 * Fire-intensity field visualization (RESEARCH.md §1.7–1.8).
 *
 * Byram (1959): I = H·w·R (kW/m). Combustion behind the front decays with
 * fuel-class time constants (post-frontal burning of woody fuels, Anderson's
 * 8·d rule) — so the map shows nested time-since-burned bands: the band just
 * behind the advancing front is at peak combustion (darkest red), older bands
 * cool through lighter reds toward the smoldering interior.
 *
 * Band geometry comes from the same reconstruction timeline as the front:
 * band k spans the area overrun between (t − edge[k]) and (t − edge[k−1]).
 */
import { FUELS, INTENSITY_STYLE } from '../data/spreadModelConfig';
import { frontAtTime, TIMELINE_START } from './fireTimeline';
import type { LatLng } from './interpolatePolygon';

export interface IntensityBand {
  outer: LatLng[];
  /** Hole ring (the next-older boundary); null = filled to the core. */
  inner: LatLng[] | null;
  fill: string;
}

/**
 * Nested intensity bands at clock time `timeMs`. Index 0 hugs the current
 * front (peak combustion); the last entry is the cooled interior.
 */
export function intensityBands(timeMs: number): IntensityBand[] {
  const edges = INTENSITY_STYLE.ageEdgesMin;
  const bands: IntensityBand[] = [];
  let outer = frontAtTime(timeMs);
  for (let k = 0; k < edges.length; k++) {
    const innerTime = timeMs - edges[k] * 60_000;
    const inner = innerTime > TIMELINE_START ? frontAtTime(innerTime) : null;
    bands.push({ outer, inner, fill: INTENSITY_STYLE.fills[k] });
    if (!inner) return bands; // everything burning is younger than this edge
    outer = inner;
  }
  // burned-out interior older than the last edge
  bands.push({ outer, inner: null, fill: INTENSITY_STYLE.emberFill });
  return bands;
}

export interface ByramEstimate {
  intensityKwm: number;
  flameLengthM: number;
}

/**
 * Byram head-fire estimate for a given head rate of spread (m/min) and fuel
 * class. I = H·w·R with R in m/s; flame length L = 0.0775·I^0.46 (metric).
 */
export function byramHead(headRateMpm: number, fuelClass: 'grass' | 'chaparral'): ByramEstimate {
  const w = FUELS.flamingLoadKgM2[fuelClass];
  const intensityKwm = FUELS.heatYieldKjKg * w * (headRateMpm / 60);
  return {
    intensityKwm,
    flameLengthM: 0.0775 * Math.pow(intensityKwm, 0.46),
  };
}
