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
  /** Gradient: bold yellow (highest-confidence next spread, nearest the
   *  front) fading through amber to soft orange at the envelope edge. */
  shellFills: [
    'rgba(255, 228, 92, 0.32)',
    'rgba(255, 190, 64, 0.22)',
    'rgba(255, 150, 60, 0.14)',
  ],
  boundaryStroke: 'rgba(255, 212, 96, 0.95)',
  boundaryWidth: 2.5,
  /** Displayed zone morphs to each new model result over this long. */
  morphMs: 480,
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

/** Burned-history styling: terrain must stay clearly visible underneath.
 *  Fire core (just reached) reads deep crimson — the most intense area —
 *  fading through red-brown to a transparent charcoal for old burned. */
export const BURNED_STYLE = {
  /** Region currently being overrun (behind the advancing front). */
  activeFill: 'rgba(150, 32, 20, 0.26)',
  /** Age ramp: [fire core / just reached, one stage back, old burned]. */
  ageRamp: ['rgba(120, 26, 18, 0.30)', 'rgba(92, 30, 20, 0.25)', 'rgba(58, 26, 18, 0.20)'],
  /** Faint historical arrival contours (past stage boundaries). */
  historyStroke: 'rgba(150, 55, 40, 0.4)',
  historyStrokeWidth: 1,
};

export const FRONT_STYLE = {
  line: 'rgba(255, 244, 180, 0.95)',
  glow: 'rgba(255, 190, 80, 0.30)',
};

/**
 * Frontier warp: every front vertex advances on its own schedule.
 * Vertex progress = p^γ, where γ comes from the model's travel time to that
 * vertex's target position — favored directions (downwind, uphill, canyons)
 * get γ < 1 and surge ahead as tongues; resisted edges get γ > 1 and stall.
 * All vertices still reach the historical stage ring exactly at p = 1.
 */
export const WARP = {
  /** Frontier sample count around the active front. */
  vertices: 224,
  /** Exponent for the fastest frontier points (advance earliest). */
  gammaFast: 0.5,
  /** Exponent for the slowest frontier points (advance last). */
  gammaSlow: 2.2,
  /** Ring-neighbor smoothing passes so the front stays one coherent shape. */
  smoothPasses: 2,
  /** Propagation cap when ranking target-vertex travel times. */
  capMinutes: 160,
};

export const PATHWAY_STYLE = {
  /** Crimson advancing tendrils extending from the active front. */
  stroke: 'rgba(228, 68, 48, 0.78)',
  /** Leading (fastest) tendrils draw slightly heavier. */
  widthMain: 2.9,
  width: 2.0,
  mainCount: 4,
  maxCount: 14,
  /** At most this many pathways get an on-terrain cause label. */
  labelMax: 3,
  /** Progressive grow-out animation per model refresh. */
  growMs: 600,
  staggerMs: 40,
  /** Endpoint selection: arrival window (fraction of horizon) and spacing. */
  windowFraction: 0.4,
  separationMeters: 220,
  minRunMeters: 300,
  /**
   * Tendril ORIGINS must also be separated, so the 10–20 pathways genuinely
   * start from distinct active sub-fronts around the fire edge rather than
   * fanning out of one hot spot.
   */
  originSeparationMeters: 240,
};

/** Evacuation routing: buffers, scoring weights and update cadence.
 *  All outputs are model-based suggestions, never official guidance. */
export const EVACUATION = {
  /** Route samples closer than this to the active front are hard-rejected. */
  frontBufferM: 250,
  /** Route samples closer than this to a fire tendril are penalized hard. */
  tendrilBufferM: 140,
  /** Accepted routes nearer than this to the envelope show a caution state. */
  envelopeCautionM: 400,
  /** Sampling step along candidate routes. */
  sampleStepM: 60,
  /** GPS accuracy above this shows the "Location accuracy is low." note. */
  lowAccuracyM: 75,
  /** Demo-drive step per second along the suggested route. */
  demoDriveStepM: 230,
  /** Demo "move toward fire" nudge. */
  demoNudgeM: 220,
  reroute: {
    /** Re-route when the user moves at least this far from the route origin. */
    moveThresholdM: 120,
    /** Re-route when the user strays this far off the suggested route. */
    deviationM: 150,
    /** Periodic re-route while evacuation mode is on. */
    minIntervalMs: 15000,
    /** Floor between network routing calls. */
    networkFloorMs: 4000,
  },
  score: {
    perMinute: 1,
    perKm: 0.4,
    /** Penalty weight for proximity to the predicted envelope (0..500 m). */
    envelopeProximity: 6,
    /** Penalty per route sample that crosses a tendril buffer. */
    tendrilCross: 8,
    /** Penalty weight for driving toward the fire while near the envelope. */
    towardFire: 3,
    /** Penalty weight for riding canyon corridors near the envelope. */
    canyon: 1.5,
    /** Penalty per km spent escaping out of the risk area at the start. */
    escapePerKm: 10,
  },
};

/** Exact evacuation wording (decision-support honesty). */
export const EVAC_WORDING = {
  title: 'Suggested evacuation route',
  modelBased: 'Model-based route. Follow local authorities.',
  notOfficial: 'Not official emergency guidance.',
  emergency: 'If you are in immediate danger, call emergency services and follow official alerts.',
  statusClear: 'Clear of modeled 30-min fire zone',
  statusNear: 'Route is near modeled fire-risk area',
  statusNone: 'No modeled low-risk route found. Follow official evacuation instructions immediately.',
  lowAccuracy: 'Location accuracy is low.',
  locationExplainer:
    'Your location stays in your browser and is only used to suggest a route away from modeled fire-risk zones.',
  simulatedNote: 'Safe zones are simulated for this demo, not official shelters.',
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
