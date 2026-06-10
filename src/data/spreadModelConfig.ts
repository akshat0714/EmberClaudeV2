/**
 * Tunables and styling for the spread-potential model and its visualization.
 *
 * All coefficients are deliberately simple, plausible planning-style values —
 * the UI labels everything produced from them as "spread potential", never as
 * an official perimeter. Display wording required by the product lives here
 * so it stays consistent across components.
 */

export const WIND = {
  /**
   * Direction the wind pushes the fire TOWARD, degrees clockwise from north.
   * Jan 9, 2025 was a Santa Ana event: strong, dry NE wind, driving the
   * Kenneth Fire west-southwest from its Victory Blvd ignition point.
   */
  spreadBearingDeg: 245,
  /** Extra spread speed (m/min) for travel perfectly aligned with the wind. */
  alignedBonus: 8,
  /**
   * Backing-fire penalty: fraction of speed removed when moving dead-upwind.
   * Fires creep against a strong Santa Ana far slower than they run with it.
   */
  headwindPenalty: 0.65,
};

export const SPEEDS = {
  /** Base no-wind, flat-ground spread in continuous dry grass/chaparral, m/min. */
  baseFuel: 6,
  /** January 2025 critical dryness (drought + single-digit humidity). */
  drynessFactor: 1.15,
  /** Extra m/min when running directly upslope (flames preheat uphill fuel). */
  uphillBonus: 4.5,
  /** Extra m/min when channeled along a canyon axis (terrain-funneled wind). */
  canyonBonus: 3.5,
  /** Multiplier inside developed blocks: roads, irrigation, structure defense. */
  developedFactor: 0.12,
  /** Multiplier in the wildland fringe right against structures (WUI edge). */
  wuiFactor: 0.8,
  minSpeed: 0.25,
  maxSpeed: 30,
};

/** Modeled area around the fire (covers the preserve and bordering streets). */
export const GRID = {
  latMin: 34.16,
  latMax: 34.212,
  lngMin: -118.722,
  lngMax: -118.652,
  cellMeters: 70,
};

/** Don't propagate arrival times beyond this horizon (keeps the model fast). */
export const MODEL_CAP_MINUTES = 120;

/**
 * Inner boundary level (minutes) used as the hole of the first potential
 * band, so all band boundaries come from the same monotone arrival surface.
 */
export const INNER_LEVEL_MINUTES = 2;

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface PredictionBandStyle {
  minutes: number;
  label: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Lower-confidence horizons get dashed outlines. */
  dashed: boolean;
  confidence: ConfidenceLevel;
  /** Whether this band gets an on-terrain label marker. */
  labelled: boolean;
}

export const PREDICTION_BANDS: PredictionBandStyle[] = [
  {
    minutes: 15,
    label: '+15 min spread potential',
    fill: 'rgba(255, 220, 80, 0.26)',
    stroke: 'rgba(255, 228, 110, 0.92)',
    strokeWidth: 2.4,
    dashed: false,
    confidence: 'High',
    labelled: true,
  },
  {
    minutes: 30,
    label: '+30 min spread potential',
    fill: 'rgba(255, 150, 50, 0.20)',
    stroke: 'rgba(255, 170, 80, 0.78)',
    strokeWidth: 2,
    dashed: false,
    confidence: 'Medium',
    labelled: true,
  },
  {
    minutes: 60,
    label: '+60 min spread potential',
    fill: 'rgba(255, 95, 40, 0.16)',
    stroke: 'rgba(255, 120, 60, 0.65)',
    strokeWidth: 1.8,
    dashed: true,
    confidence: 'Low',
    labelled: true,
  },
  {
    minutes: 90,
    label: '+90 min spread potential',
    fill: 'rgba(170, 45, 35, 0.12)',
    stroke: 'rgba(205, 80, 60, 0.55)',
    strokeWidth: 1.5,
    dashed: true,
    confidence: 'Low',
    labelled: false,
  },
];

/** Burned-history styling: terrain must stay clearly visible underneath. */
export const BURNED_STYLE = {
  /** Most recently reached interval. */
  recentFill: 'rgba(60, 20, 15, 0.18)',
  /** Intervals reached earlier. */
  olderFill: 'rgba(80, 25, 18, 0.22)',
  /** Faint historical arrival contours (past stage boundaries). */
  historyStroke: 'rgba(150, 55, 40, 0.45)',
  historyStrokeWidth: 1,
};

export const FRONT_STYLE = {
  line: 'rgba(255, 244, 180, 0.95)',
  glow: 'rgba(255, 190, 80, 0.30)',
};

export const PATHWAY_STYLE = {
  stroke: 'rgba(255, 236, 200, 0.55)',
  width: 1.8,
  maxCount: 5,
};

export const STRUCTURE_EDGE_STYLE = {
  fill: 'rgba(255, 250, 235, 0.10)',
  dashColor: 'rgba(255, 255, 250, 0.92)',
  dashWidth: 2.2,
  dashMeters: 85,
  gapMeters: 55,
};

export const DASH = {
  dashMeters: 130,
  gapMeters: 85,
};

/** Exact display wording. */
export const WORDING = {
  potential: 'Spread potential, not official perimeter.',
  model:
    'Arrival-time surface based on wind, slope, fuel, canyon alignment, and structure adjacency.',
  modelPaused: 'Forward progress stopped — spread-potential model paused.',
  confidenceKey: 'Solid outline = higher confidence · dashed = lower confidence.',
};
