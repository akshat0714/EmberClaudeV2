/**
 * Spread-model tunables and visualization styling.
 *
 * The model follows the FARSITE/Huygens family of fire-growth methods
 * (Finney RMRS-RP-4): the current front seeds a Finney-style Minimum Travel
 * Time (Dijkstra) propagation over a terrain grid; each step's speed comes
 * from the rear-focus elliptical kernel whose elongation is set by the
 * effective midflame wind–slope vector. EVERY behavioral number below is
 * research-derived — RESEARCH.md maps each one to its verified source.
 */

/**
 * Wind for the Kenneth Fire afternoon — verified observations (RESEARCH.md §3):
 * Van Nuys ASOS Jan 9 2025, 1–5 PM PT: wind FROM 010–030° (N–NNE), sustained
 * 15–22 mph, gusts 24–31 mph, RH 4.7–6.1%; NWS Red Flag Warning called for
 * N–NE winds with valley gusts 35–55 mph.
 */
export const WIND = {
  /** Direction the wind blows FROM, degrees true (VNY ASOS 010–030°). */
  windFromDeg: 20,
  /** Direction the wind pushes the fire TOWARD (reciprocal of windFromDeg). */
  spreadBearingDeg: 200,
  /** 10-m open wind speed, m/s (≈20 mph sustained, weighted toward gusts). */
  wind10mMps: 9,
  /**
   * Wind adjustment factor: midflame = WAF × 10-m wind for unsheltered
   * surface fuel (Rothermel; Andrews RMRS-GTR-266, Baughman & Albini 1980).
   */
  windAdjustmentFactor: 0.4,
};

/** Effective midflame wind from the 10-m wind (≈3.6 m/s here). */
export const MIDFLAME_WIND_MPS = WIND.wind10mMps * WIND.windAdjustmentFactor;

/**
 * Slope expressed as equivalent midflame wind (m/s), pointing upslope —
 * fit of Andrews RMRS-GTR-371 Table 24 (≈1.3 m/s at 50% slope, ≈3.4 m/s at
 * 100%), combined with the wind VECTOR per GTR-371 §5.4.3.
 *   U_slope = coef · tan(φ)^exponent, capped at capMps (100% slope).
 */
export const SLOPE_WIND = {
  coefMps: 3.4,
  exponent: 1.38,
  capMps: 3.4,
};

/**
 * FARSITE fire-shape relation (Finney RMRS-RP-4 Eq. 13, after Anderson 1983):
 *   LB = a·e^(b·U) + c·e^(−d·U) − offset,   U in m/s, truncated at lbMax = 8
 * Eccentricity ε = √(LB²−1)/LB; spread at angle θ off the head follows the
 * rear-focus ellipse R(θ) = R_head·(1−ε)/(1−ε·cosθ) (GTR-371 §6.2).
 */
export const FIRE_SHAPE = {
  a: 0.936,
  b: 0.2566,
  c: 0.461,
  d: 0.1548,
  offset: 0.397,
  lbMax: 8,
};

export const SPEEDS = {
  /**
   * No-wind, flat-ground rate of spread for the cured-grass/chaparral mosaic,
   * m/min, before the dryness factor.
   */
  baseRosMpm: 4.5,
  /**
   * January 2025 critical dryness (observed RH ~5%, months without rain).
   */
  drynessFactor: 1.15,
  /**
   * Wind response R_head = R0·fuel·dryness·(1 + k·U^1.5). The 1.5 exponent is
   * Rothermel's wind-factor exponent B = 0.15988·σ^0.514 ≈ 1.5 for fine fuels
   * (σ ≈ 3500 ft⁻¹, GTR-371 App. A); k is calibrated so the Kenneth Fire's
   * verified conditions (U_eff ≈ 3.6 m/s) give ≈19 m/min open-fuel head rate,
   * consistent with the reconstructed forward run and within the documented
   * Santa Ana envelope (Witch AAR ≈134 m/min at far higher winds). Known to
   * underpredict extreme plume/spotting-driven runs — see RESEARCH.md §1.5.
   */
  windK: 0.391,
  windExponent: 1.5,
  /** Chaparral carries fire slower than fully cured grass (GR2 vs SH5). */
  chaparralSpeedFactor: 0.75,
  /** Spread multiplier inside dense urban fabric (irrigation, pavement,
   *  structure defense — near-barrier). */
  developedFactor: 0.12,
  /** Single road crossing open fuel: partial fuel break only — surface fire
   *  slows but embers jump roads (NIST TN-1635). */
  roadBreakFactor: 0.55,
  /** Wildland fringe right against structures (WUI edge). */
  wuiFactor: 0.8,
  /** Terrain channeling multiplier strength along canyon/drainage axes. */
  canyonFactor: 0.5,
  minSpeed: 0.25,
  maxSpeed: 40,
};

/**
 * Byram (1959) fireline intensity I = H·w·R (kW/m; H kJ/kg, w kg/m², R m/s)
 * and flame length L = 0.0775·I^0.46 m (metric form, GTR-371 Table A.3).
 * Loads from the standard fuel models (Anderson 1982 FM4; Scott & Burgan
 * 2005 GR2/SH5) — see RESEARCH.md §1.6–1.7.
 */
export const FUELS = {
  heatYieldKjKg: 18_000,
  /** Fuel consumed in the flaming front, kg/m². */
  flamingLoadKgM2: { grass: 0.25, chaparral: 2.0, developed: 0.35 },
  /**
   * Post-frontal burning time constants, minutes (exponential decay of
   * combustion behind the front). Flaming residence itself is seconds
   * (Anderson 1969 t_r = 8d ⇒ grass ≈7 s, chaparral fine fuel ≈13 s); the
   * longer tail is woody post-frontal combustion (1-inch stems ≈8 min,
   * 3-inch ≈24 min by the same 8d rule). RESEARCH.md §1.8.
   */
  decayTauMin: { grass: 4, chaparral: 22, developed: 12 },
};

/**
 * Fire-intensity visualization: nested bands by time-since-burned, mapped
 * through the per-fuel decay above — darkest, most saturated red where
 * combustion is at peak (just behind the advancing front), cooling to pale
 * washed red in the long-burned interior.
 */
export const INTENSITY_STYLE = {
  /** Band inner edges as minutes-since-burned (band 0 touches the front). */
  ageEdgesMin: [3.5, 10, 22, 45],
  fills: [
    'rgba(136, 8, 8, 0.60)', // peak combustion — darkest red
    'rgba(164, 28, 16, 0.46)',
    'rgba(186, 62, 40, 0.33)',
    'rgba(200, 100, 78, 0.21)', // cooling / smoldering
  ],
  /** Long-burned interior beyond the last edge. */
  emberFill: 'rgba(120, 58, 48, 0.16)',
  /** Faint past-front contour lines. */
  historyStroke: 'rgba(150, 55, 40, 0.35)',
  historyStrokeWidth: 1,
  /** Legend thresholds (kW/m): standard hauling-chart interpretation. */
  legendKwm: [3500, 1700, 350],
};

/** Modeled area around the fire (covers the preserve and bordering streets). */
export const GRID = {
  latMin: 34.16,
  latMax: 34.212,
  lngMin: -118.722,
  lngMax: -118.652,
  cellMeters: 70,
};

/** Visualization propagation horizon (keeps the per-refresh model fast). */
export const MODEL_CAP_MINUTES = 45;

/** Inner boundary level (minutes) for the innermost prediction shell hole. */
export const INNER_LEVEL_MINUTES = 2;

/**
 * THE primary prediction: "Predicted fire spread — next 30 minutes", drawn
 * as a BOLD YELLOW gradient envelope (strong at the front, fading outward)
 * with one crisp boundary. Under extreme head rates the model narrows to a
 * 20-minute critical interval (hysteresis so it never flaps). The 30-minute
 * horizon matches the Cova et al. 2005 trigger-buffer ladder (15/30/45 min).
 */
export const PREDICTION_ZONE = {
  primaryMinutes: 30,
  criticalMinutes: 20,
  criticalHeadSpeedMpm: 26,
  relaxHeadSpeedMpm: 22,
  shellFractions: [1 / 3, 2 / 3, 1],
  /** Yellow gradient: strong near the front, soft at the outer boundary. */
  shellFills: [
    'rgba(255, 238, 110, 0.40)',
    'rgba(255, 212, 48, 0.28)',
    'rgba(255, 182, 0, 0.17)',
  ],
  boundaryStroke: 'rgba(255, 226, 80, 0.95)',
  boundaryWidth: 2.5,
  morphMs: 480,
};

/**
 * Hotspot detection: the 10–20 most active sub-fires (heads) along the
 * frontier, found as local maxima of the modeled outward spread rate.
 */
export const HOTSPOTS = {
  minCount: 10,
  maxCount: 20,
  /** Minimum great-circle separation between hotspot centers, m. */
  separationM: 230,
  /** Probe distance outside the front when scoring local head rate, m. */
  probeOffsetM: 110,
  /** Drawn radius range (scaled by relative strength), m. */
  radiusM: [46, 110] as [number, number],
  coreFill: 'rgba(255, 84, 30, 0.55)',
  glowFill: 'rgba(255, 140, 40, 0.22)',
  /** Pulse period for the hotspot glow, ms. */
  pulseMs: 2200,
};

/**
 * Ember spot fires: 0–3 active ignitions downwind of the strongest heads.
 * Distances follow the observed record for moderate Santa Ana gusts (Witch
 * AAR: "long range spotting over half a mile"; typical hundreds of meters)
 * with an exponential distribution; placement is seeded-deterministic per
 * timeline interval. No accepted deterministic density law exists
 * (RESEARCH.md §1.9) — this layer is stochastic-illustrative.
 */
export const SPOT_FIRES = {
  maxActive: 3,
  meanDistM: 300,
  maxDistM: 800,
  /** Brand transport + incipient growth before the spot shows, minutes. */
  ignitionDelayMin: 3,
  /** Spots only ignite when the local head rate exceeds this, m/min. */
  minHeadRateMpm: 10,
  radiusM: 42,
  fill: 'rgba(255, 70, 26, 0.6)',
  ringStroke: 'rgba(255, 160, 60, 0.85)',
};

/**
 * Per-hotspot prediction trees ("where could each sub-fire go"): the
 * minimum-travel-time predecessor tree out of each hotspot, drawn as
 * branching worm-like paths in bold yellow.
 */
export const TREE_STYLE = {
  trunkStroke: 'rgba(255, 234, 96, 0.95)',
  trunkGlow: 'rgba(255, 196, 0, 0.28)',
  branchStroke: 'rgba(255, 222, 70, 0.78)',
  trunkWidth: 3.2,
  trunkGlowWidth: 7.5,
  branchWidth: 1.9,
  /** Max branch endpoints kept per hotspot (incl. the trunk). */
  branchesPerHotspot: 3,
  /** Endpoint selection: arrival window (fraction of horizon) and spacing. */
  windowFraction: 0.45,
  separationMeters: 200,
  minRunMeters: 260,
  /** Progressive grow-out animation per model refresh. */
  growMs: 650,
  staggerMs: 35,
  smoothIterations: 2,
  /** Total tree polyline budget (pool size). */
  maxPolylines: 64,
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
  vertices: 224,
  gammaFast: 0.5,
  gammaSlow: 2.2,
  smoothPasses: 2,
  capMinutes: 160,
};

export const STRUCTURE_EDGE_STYLE = {
  fill: 'rgba(255, 250, 235, 0.10)',
  dashColor: 'rgba(255, 255, 250, 0.92)',
  dashWidth: 2.2,
  dashMeters: 85,
  gapMeters: 55,
};

/** Navigation visuals (Google-Maps-style blue dot and route). */
export const NAV_STYLE = {
  routeCore: 'rgba(66, 133, 244, 0.96)',
  routeCoreWidth: 5,
  routeGlow: 'rgba(66, 133, 244, 0.30)',
  routeGlowWidth: 11,
  routeCasing: 'rgba(255, 255, 255, 0.9)',
  /** Degraded (below hard margin) route rendering. */
  routeDegraded: 'rgba(255, 120, 40, 0.95)',
  dotFill: 'rgba(66, 133, 244, 1)',
  dotRing: 'rgba(255, 255, 255, 0.95)',
  dotRadiusM: 9,
  dotRingWidth: 3,
  accuracyFill: 'rgba(66, 133, 244, 0.16)',
  accuracyStroke: 'rgba(66, 133, 244, 0.35)',
  headingFill: 'rgba(66, 133, 244, 0.42)',
  headingLengthM: 26,
  headingHalfAngleDeg: 28,
  safeZoneFill: 'rgba(52, 168, 83, 0.95)',
  destinationFill: 'rgba(52, 168, 83, 1)',
};

/** Exact display wording. */
export const WORDING = {
  potential: 'Model-based prediction, not an official perimeter',
  model:
    'Prediction uses observed wind, real terrain (USGS 3DEP), fuels, canyon alignment, and structure-edge resistance.',
  modelPaused: 'Forward progress stopped — spread-prediction model paused.',
  zoneLabel: (minutes: number) => `Predicted fire spread — next ${minutes} min`,
  zoneBasis: (minutes: number) =>
    `Predicted spread within ${minutes} minutes from observed wind, terrain, and fuels`,
  notGuidance: 'Simulation for demonstration. Not emergency guidance — follow official alerts.',
};
