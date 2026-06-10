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
   *  slope acts like added wind pointing uphill). Raised so the fire visibly
   *  stretches UPHILL on the ridges and peaks — mountain terrain grows its
   *  own differently-oriented lobes, independent of the wind direction. */
  slopeWindEquivalent: 1.25,
  /** Ellipse length-to-breadth = 1 + lbPerU·U (simplified after Anderson
   *  1983), clamped for heterogeneous terrain. */
  lbPerU: 0.8,
  lbMin: 1.15,
  lbMax: 2.6,
  /** Channeling multiplier strength along canyon/drainage axes — long thin
   *  runs down the canyons, a different shape than the broad wind head. */
  canyonFactor: 0.8,
  /** Multiplier inside developed blocks: roads, irrigation, structure defense
   *  still dominate, but slow creep along the city edge stays visible. */
  developedFactor: 0.18,
  /** Multiplier in the wildland fringe right against structures (WUI edge):
   *  near-normal speed, so the footprint flattens and widens along the city
   *  rather than stopping in a clean line. */
  wuiFactor: 0.92,
  minSpeed: 0.25,
  maxSpeed: 30,
  /**
   * Deterministic fuel/terrain patchiness (value noise, fixed seed): real
   * fuel beds are a patchwork of grass openings, brush pockets and rock, so
   * local speed varies by POSITION — the front and the predicted zone grow
   * distinct, differently-shaped lobes in different places instead of one
   * uniform oval. amp 0.5 → local multiplier ranges ~0.5×..1.5×.
   */
  patchAmp: 0.5,
  patchScaleM: 420,
  patchFineScaleM: 150,
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

/** Burned-history styling: everything the fire has already covered paints
 *  as unmistakable DARK RED, deepening as the burn ages, while terrain and
 *  roads stay readable underneath. */
export const BURNED_STYLE = {
  /** Region currently being overrun (just behind the advancing front). */
  activeFill: 'rgba(168, 24, 12, 0.34)',
  /** Age ramp: [just burned, one stage back, old burn] — darker with age. */
  ageRamp: ['rgba(140, 16, 10, 0.46)', 'rgba(106, 11, 7, 0.52)', 'rgba(74, 8, 5, 0.56)'],
  /** Faint historical arrival contours (past stage boundaries). */
  historyStroke: 'rgba(185, 48, 30, 0.42)',
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
  /** Exponent for the fastest frontier points (advance earliest). Widened
   *  range = tongues surge much earlier and resisted edges stall much
   *  longer, so the front takes on strongly different shapes by position. */
  gammaFast: 0.36,
  /** Exponent for the slowest frontier points (advance last). */
  gammaSlow: 3.2,
  /** Ring-neighbor smoothing passes — one pass keeps the front coherent
   *  while letting the model's local differences stay visibly ragged. */
  smoothPasses: 1,
  /** Deterministic per-vertex shape noise (position-hashed, stable between
   *  refreshes): adds fuel-patch raggedness on top of the model ranking. */
  shapeJitter: 0.45,
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

/** Help rescue flow: buffers, scoring weights, movement speeds and the
 *  shared world clock. All outputs are model-based suggestions, never
 *  official guidance. */
export const HELP_CONFIG = {
  /** Route samples closer than this to the active front are hard-rejected. */
  frontBufferM: 250,
  /** Route samples closer than this to a fire tendril are penalized hard. */
  tendrilBufferM: 140,
  /** Accepted routes nearer than this to the envelope show a caution state. */
  envelopeCautionM: 400,
  /** Sampling step along candidate routes. */
  sampleStepM: 60,
  /** Initial stretch of a route that may weave along/through the predicted
   *  envelope while getting clear of an at-risk start; beyond it, touching
   *  the envelope hard-rejects the route. */
  escapeWindowM: 900,
  /** Simulated GPS lock-on time after pressing Help. */
  locatingMs: 2600,
  score: {
    perMinute: 1,
    perKm: 0.4,
    /** Penalty weight for proximity to the predicted envelope (0..500 m). */
    envelopeProximity: 6,
    /** Penalty per route sample that crosses a tendril buffer. */
    tendrilCross: 8,
    /** Penalty weight for moving toward the fire while near the envelope. */
    towardFire: 3,
    /** Penalty weight for fleeing DOWNWIND (where the wind is carrying the
     *  fire) while near the risk area — the head outruns people. */
    downwind: 6,
    /** Penalty weight for riding canyon corridors near the envelope. */
    canyon: 1.5,
    /** Penalty per km spent escaping out of the risk area at the start. */
    escapePerKm: 10,
  },
  /** A destination must keep these margins from the modeled risk. */
  destination: {
    frontMarginM: 600,
    envelopeMarginM: 300,
  },
  /** World-time movement speeds for the simulated person (m per fire-second). */
  movement: {
    carMps: 10, // ~36 km/h on the dirt road / evacuation traffic
    bikeMps: 4.2, // ~15 km/h
    footMps: 1.4, // ~5 km/h brisk walk
    limitedMps: 0.9, // disability / reduced mobility
  },
  /**
   * Shared world clock: the fire and the person run on one clock. While the
   * person is replying in chat the world runs in real time (1 fire-minute =
   * 1 real minute); once they are moving it fast-forwards (1 fire-minute =
   * 1 real second). After arrival the app's normal demo speed resumes.
   */
  clock: {
    fastRate: 60,
    realRate: 1,
    chatGraceMs: 6000,
  },
};

/** Exact Help-flow wording (decision-support honesty). */
export const HELP_WORDING = {
  title: 'Evacuation help',
  buttonIdle: 'Help — I need to evacuate',
  buttonActive: 'End help session',
  locating: 'Locating your GPS position…',
  located: 'GPS position found',
  statusAsk: 'Waiting for your reply…',
  statusRouting: 'Choosing the safest way out…',
  statusSafe: 'Route is clear of the modeled fire zones',
  statusCaution: 'Route passes near the modeled fire-risk area — keep moving',
  statusNone:
    'No modeled low-risk route found. Follow official evacuation instructions immediately.',
  arrived: 'Reached the safe zone (simulated) — clear of the modeled fire area.',
  modelBased: 'Model-based guidance. Follow local authorities.',
  notOfficial: 'Not official emergency guidance.',
  emergency: 'If you are in immediate danger, call 911 and follow official alerts.',
  simulatedNote:
    'Demo: the GPS fix, the person and the safe zones are simulated; the fire is the live model.',
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
