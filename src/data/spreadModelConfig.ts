/**
 * Tunables and styling for the spread-potential model and its visualization.
 *
 * The model follows the FARSITE/Huygens family of fire-growth methods: the
 * current front is the source, every grid cell gets a direction-dependent
 * local spread rate from an elliptical kernel (wind + slope set the ellipse
 * direction and elongation; fuel, canyon channeling and developed-edge
 * resistance scale it), and a Finney-style Minimum Travel Time (Dijkstra)
 * propagation produces an arrival-time surface. One predicted extent is
 * extracted from that surface — never raw cells, never multiple contours.
 *
 * Display wording required by the product lives here so it stays consistent.
 */

export const WIND = {
  /**
   * Direction the wind pushes the fire TOWARD, degrees clockwise from north.
   * Jan 9, 2025 was a Santa Ana event: strong, dry NE wind, driving the
   * Kenneth Fire west-southwest from its Victory Blvd ignition point.
   */
  spreadBearingDeg: 245,
  /** Dimensionless effective wind strength of the event (strong Santa Ana). */
  effectiveWindNumber: 1.6,
};

export const SPEEDS = {
  /** Base no-wind, flat-ground spread in continuous dry grass/chaparral, m/min. */
  baseFuel: 6,
  /** January 2025 critical dryness (drought + single-digit humidity). */
  drynessFactor: 1.15,
  /** Head-rate multiplier per unit of effective wind-slope number U. */
  headWindFactor: 1.05,
  /** Upslope contribution to the effective wind-slope vector (Rothermel-style:
   *  slope acts like added wind pointing uphill). */
  slopeWindEquivalent: 0.9,
  /** Ellipse length-to-breadth = 1 + lbPerU·U (simplified after Anderson
   *  1983), clamped for heterogeneous terrain. */
  lbPerU: 0.8,
  lbMin: 1.15,
  lbMax: 2.6,
  /** Channeling multiplier strength along canyon/drainage axes. */
  canyonFactor: 0.5,
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
export const MODEL_CAP_MINUTES = 45;

/**
 * Inner boundary level (minutes) used as the hole of the innermost shell,
 * so the zone geometry comes entirely from the same monotone arrival surface.
 */
export const INNER_LEVEL_MINUTES = 2;

/**
 * THE one primary prediction: "Likely spread in next 30 minutes".
 * When the front is moving extremely fast (head rate above the critical
 * threshold), the model narrows to a 20-minute critical interval instead —
 * still only ONE predicted extent on screen at a time.
 *
 * The zone is filled as three stacked shells of the same surface (stronger
 * near the front, softer outward) with a single crisp outer boundary; the
 * internal shell edges draw no outlines, so it reads as one gradient zone.
 */
export const PREDICTION_ZONE = {
  primaryMinutes: 30,
  criticalMinutes: 20,
  /** Switch to the critical interval above this head rate (m/min)... */
  criticalHeadSpeedMpm: 20,
  /** ...and relax back to the primary interval below this one (hysteresis). */
  relaxHeadSpeedMpm: 18.5,
  shellFractions: [1 / 3, 2 / 3, 1],
  shellFills: [
    'rgba(255, 140, 40, 0.30)',
    'rgba(255, 110, 40, 0.20)',
    'rgba(255, 88, 45, 0.13)',
  ],
  boundaryStroke: 'rgba(255, 172, 84, 0.95)',
  boundaryWidth: 2.5,
};

/** Faint wind streamlines (direction cue), laid out around the predicted zone. */
export const WIND_STREAMS = {
  cols: 4,
  rows: 3,
  spacingM: 880,
  lengthM: 620,
  arrowM: 100,
  arrowDeg: 26,
  color: 'rgba(255, 255, 255, 0.30)',
  width: 1.2,
};

/** Burned-history styling: terrain must stay clearly visible underneath. */
export const BURNED_STYLE = {
  /** Most recently reached interval. */
  recentFill: 'rgba(60, 20, 15, 0.18)',
  /** Intervals reached earlier. */
  olderFill: 'rgba(80, 25, 18, 0.22)',
  /** Faint historical arrival contours (past stage boundaries). */
  historyStroke: 'rgba(150, 55, 40, 0.4)',
  historyStrokeWidth: 1,
};

export const FRONT_STYLE = {
  line: 'rgba(255, 244, 180, 0.95)',
  glow: 'rgba(255, 190, 80, 0.22)',
};

export const PATHWAY_STYLE = {
  stroke: 'rgba(255, 236, 200, 0.55)',
  width: 1.8,
  maxCount: 5,
  /** At most this many pathways get an on-terrain cause label. */
  labelMax: 2,
};

export const STRUCTURE_EDGE_STYLE = {
  fill: 'rgba(255, 250, 235, 0.10)',
  dashColor: 'rgba(255, 255, 250, 0.92)',
  dashWidth: 2.2,
  dashMeters: 85,
  gapMeters: 55,
};

/** Exact display wording. */
export const WORDING = {
  potential: 'Spread potential, not official perimeter',
  model: 'Prediction uses wind, slope, fuel, canyon alignment, and structure-edge resistance.',
  modelPaused: 'Forward progress stopped — spread-potential model paused.',
  zoneLabel: (minutes: number) => `Likely spread in next ${minutes} minutes`,
  zoneBasis: (minutes: number) =>
    `Likely spread in next ${minutes} minutes based on terrain, wind, and spread drivers`,
};
