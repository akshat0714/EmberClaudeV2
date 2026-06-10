/**
 * Evacuation-routing parameters. Every value here is research-derived —
 * see RESEARCH.md §2 for the full citations.
 */

export const NAV = {
  /**
   * Hard safety margin (minutes): a road is unusable unless the predicted
   * fire arrival trails the evacuee by at least this long at every point.
   * Follows the WUIVAC trigger-buffer rule of evacuation time + uncertainty
   * cushion (Dennison, Cova & Moritz 2007 used +50%; typical drive here is
   * ≤ ~20 min ⇒ 10 min cushion). Cova et al. 2005 used 15/30/45-min buffers
   * at household scale in the same Calabasas area.
   */
  hardMarginMin: 10,
  /** Prefer routes that stay ≥ this far ahead of the fire (soft penalty below). */
  softMarginMin: 20,
  /**
   * Last-resort floor used only for the flagged "degraded" route when no
   * fully-safe route exists (always rendered as a warning, never as safe).
   */
  survivalMarginMin: 2,
  /** Cost multiplier for edges whose clearance falls in [hard, soft). */
  softPenaltyFactor: 6,
  /** Clearance sampling interval along road geometry, meters. */
  clearanceSampleM: 60,

  /**
   * Evacuation speed = signed/class speed limit × this factor. Nominal
   * limits follow WUI evacuation modeling practice (Li, Cova & Dennison
   * 2019: 25 mph residential / 40 mph highway); real evacuations can
   * collapse to 2–10 mi/h (NIST TN 2252, Camp Fire). 0.6 models a moderate,
   * early, orderly evacuation — ETAs run conservative on purpose.
   */
  evacSpeedFactor: 0.6,
  /**
   * Class-default speed limits (km/h) where OSM has no signed maxspeed,
   * anchored to California prima facie limits (CVC §22352: 25 mph residence
   * districts) and Li et al. 2019 coding (40 mph highways).
   */
  defaultSpeedKmh: {
    motorway: 105,
    motorway_link: 64,
    trunk: 88,
    trunk_link: 56,
    primary: 64,
    primary_link: 48,
    secondary: 64,
    secondary_link: 48,
    tertiary: 56,
    tertiary_link: 48,
    unclassified: 40,
    residential: 40, // 25 mph
    living_street: 16,
  } as Record<string, number>,
  /** Average added delay per junction (stop signs/signals), minutes (~5 s). */
  intersectionPenaltyMin: 0.083,

  /** Pedestrian speed: HCM/FHWA-RD-98-107 default 1.2 m/s. */
  walkSpeedMps: 1.2,
  /** Pedestrians are prohibited on freeways. */
  noPedestrianClasses: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']),

  /** Max GPS-to-street snapping distance, meters. */
  maxSnapM: 250,
  /** Off-route distance that triggers a reroute, meters. */
  offRouteM: 35,
  /** Re-validate the active route against the fire at most this often, ms (real time). */
  revalidateMs: 2500,

  /** Routing fire-arrival field horizon (covers ETA + margins + prediction). */
  routingCapMinutes: 90,
} as const;

export interface SafeZone {
  id: string;
  name: string;
  address: string;
  point: { lat: number; lng: number };
  /** Why this is a legitimate destination (see RESEARCH.md §3). */
  basis: string;
}

/**
 * REAL evacuation destinations that served this area during the January 2025
 * Los Angeles fires — verified against Cal OES / LAFD / City of Calabasas
 * records; coordinates from OpenStreetMap. Westfield Topanga is deliberately
 * absent: it could not be verified as a designated shelter.
 */
export const SAFE_ZONES: SafeZone[] = [
  {
    id: 'el-camino-real',
    name: 'El Camino Real Charter High School',
    address: '5440 Valley Circle Blvd, Woodland Hills',
    point: { lat: 34.17069, lng: -118.643 },
    basis: 'City of LA / Cal OES designated evacuation center, January 2025 fires',
  },
  {
    id: 'calvary-community',
    name: 'Calvary Community Church',
    address: '5495 Via Rocas, Westlake Village',
    point: { lat: 34.1503, lng: -118.8069 },
    basis: 'Shelter the City of Calabasas directed Kenneth Fire evacuees to',
  },
  {
    id: 'pierce-college',
    name: 'Pierce College',
    address: '6201 Winnetka Ave, Woodland Hills',
    point: { lat: 34.18376, lng: -118.5798 },
    basis: 'Evacuation site (large-animal center), January 2025 fires',
  },
];

/**
 * Demo placement spots for the click-free path through the demo (real
 * intersections inside/near the January 2025 evacuation-order area).
 */
export const DEMO_START_POINTS: Array<{ name: string; point: { lat: number; lng: number } }> = [
  { name: 'Vanowen St & Valley Circle Blvd (West Hills)', point: { lat: 34.19383, lng: -118.65961 } },
  { name: 'Victory Blvd trailhead edge (closest to fire)', point: { lat: 34.18667, lng: -118.66306 } },
  { name: 'Hidden Hills — Long Valley Rd gate', point: { lat: 34.16726, lng: -118.65951 } },
  { name: 'Calabasas — Parkway Calabasas N of US-101', point: { lat: 34.15425, lng: -118.66395 } },
];
