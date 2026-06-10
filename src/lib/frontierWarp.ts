/**
 * Frontier-point warp: turns the uniform stage-to-stage interpolation into a
 * multi-point advancing front.
 *
 * For each reconstruction interval, the ~224 aligned vertex pairs
 * (a_i on the starting ring, b_i on the ending ring) become independent
 * frontier points. The arrival-time model is seeded at the starting ring and
 * the modeled travel time τ_i to each target vertex b_i ranks how favored
 * that direction is (downwind / uphill / canyon-aligned → small τ; barriers
 * and backing edges → large τ).
 *
 * Each vertex then advances as progress_i = p^γ_i, with γ derived from the
 * normalized τ ranking: favored points get γ < 1 (surge early, forming
 * tongues), resisted points get γ > 1 (stall, pinching the front). γ values
 * are smoothed around the ring (neighbor coupling) so the front stays one
 * coherent shape rather than dissolving — and because p^γ is exactly 0 at
 * p = 0 and exactly 1 at p = 1, the displayed front still matches the
 * historical reconstruction rings at every stage boundary. Nothing here is
 * random: the differentiation comes entirely from the spread model.
 */
import { computeArrivalField, cellIndexAt } from './arrivalTimeModel';
import type { LatLng, RingTransition } from './interpolatePolygon';
import { WARP } from '../data/spreadModelConfig';
import { clamp } from './timeUtils';

/** Per-vertex advancement exponents for one interval's transition. */
export function computeFrontierGamma(transition: RingTransition): Float64Array {
  const { a, b } = transition;
  const n = b.length;
  const field = computeArrivalField(a, WARP.capMinutes);

  // Modeled PACE (minutes per metre) from the interval's starting front to
  // each target vertex. Normalizing by the vertex's own travel distance makes
  // the ranking about how FAVORED the direction is (wind/slope/canyon/fuel),
  // not about how far the historical interval happens to carry that vertex —
  // so the main downwind run surges as a tongue even though it travels
  // furthest, while resisted edges rank late even over short hops.
  const M_PER_DEG_LAT = 111_320;
  const M_PER_DEG_LNG = 92_100;
  const tau = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const arrival = field.arrival[cellIndexAt(field.grid, b[i].lat, b[i].lng)];
    const travelM = Math.max(
      Math.hypot(
        (b[i].lat - a[i].lat) * M_PER_DEG_LAT,
        (b[i].lng - a[i].lng) * M_PER_DEG_LNG,
      ),
      30,
    );
    tau[i] = Number.isFinite(arrival) ? arrival / travelM : Infinity;
  }

  // Robust normalization between the 10th and 90th percentile of reachable
  // targets; unreachable targets rank as very late.
  const finite = Array.from(tau)
    .filter((v) => Number.isFinite(v))
    .sort((x, y) => x - y);
  const quantile = (f: number) =>
    finite.length > 0 ? finite[Math.min(finite.length - 1, Math.floor(f * finite.length))] : 1;
  const p10 = quantile(0.1);
  const p90 = Math.max(quantile(0.9), p10 + 1e-6);
  let lateness = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(tau[i]) ? tau[i] : p90 * 1.5;
    lateness[i] = clamp((v - p10) / (p90 - p10), 0, 1);
  }

  // Neighbor coupling: 1-2-1 ring blur keeps adjacent frontier points moving
  // together, so tongues read as tongues rather than spikes.
  for (let pass = 0; pass < WARP.smoothPasses; pass++) {
    const blurred = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      blurred[i] =
        (lateness[(i - 1 + n) % n] + 2 * lateness[i] + lateness[(i + 1) % n]) / 4;
    }
    lateness = blurred;
  }

  // Log-space interpolation between the fast and slow exponents.
  const gamma = new Float64Array(n);
  const ratio = WARP.gammaSlow / WARP.gammaFast;
  for (let i = 0; i < n; i++) {
    gamma[i] = WARP.gammaFast * Math.pow(ratio, lateness[i]);
  }
  return gamma;
}

/**
 * Displayed front at interval progress p: each frontier point advances along
 * its own a_i → b_i track at p^γ_i. Exact at both interval endpoints.
 */
export function warpFront(transition: RingTransition, gamma: Float64Array, p: number): LatLng[] {
  const { a, b } = transition;
  const pc = clamp(p, 0, 1);
  const out: LatLng[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const pi = Math.pow(pc, gamma[i]);
    out[i] = {
      lat: a[i].lat + (b[i].lat - a[i].lat) * pi,
      lng: a[i].lng + (b[i].lng - a[i].lng) * pi,
    };
  }
  return out;
}
