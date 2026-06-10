/**
 * SIMULATED rescue scenario for the Help flow.
 *
 * When someone presses "Help", the demo "locates" them on
 * E Las Virgenes Canyon Rd — the dirt road through Upper Las Virgenes Canyon
 * Open Space — about 1 km downwind (west-south-west) of the Kenneth Fire
 * ignition point, directly in the modeled spread path. That position, the
 * road geometry, and the safe destinations here are all SIMULATED demo data
 * (every name carries "(simulated)" and the UI repeats it); the fire-risk
 * checks against them use the live reconstruction model.
 *
 * Escape routes are hand-authored along real road alignments so the blue
 * path is always a physically possible way out:
 *
 *  - EAST (primary): up out of the canyon along E Las Virgenes Canyon Rd to
 *    the Valley Circle Blvd gate, then east on Vanowen St into West Hills —
 *    into the city, away from the WSW wind-driven spread.
 *  - SOUTH-WEST (backup): along E Las Virgenes Canyon Rd to the canyon
 *    junction, then south on Las Virgenes Canyon Rd to the trailhead gate
 *    toward Las Virgenes Rd, Calabasas.
 *
 * Both candidates are risk-scored against the live model every refresh; the
 * surviving lower-risk one is shown. A production deployment must replace
 * all of this with official evacuation zones, shelters, and road status.
 */
import type { LatLng } from '../lib/interpolatePolygon';

export interface SafeDestination {
  id: string;
  name: string;
  position: LatLng;
  kind: 'safe-zone' | 'pickup-point';
}

export interface RouteStep {
  /** Road the step follows (must exist in the authored geometry). */
  road: string;
  /** Compass word shown big in the card and spoken by the assistant. */
  direction: string;
  /** Compass arrow glyph for the step list. */
  arrow: string;
  /** One short instruction sentence. */
  text: string;
  /** Index into `path` where this step begins. */
  fromIndex: number;
}

export interface EscapeRoute {
  id: string;
  destination: SafeDestination;
  /** Full road polyline from the simulated GPS position to the destination. */
  path: LatLng[];
  steps: RouteStep[];
  /** One-line qualitative summary the assistant reads out. */
  summary: string;
}

/** Where the simulated GPS fix drops: on E Las Virgenes Canyon Rd. */
export const HELP_GPS_POSITION: LatLng = { lat: 34.1828, lng: -118.68 };

export const HELP_LOCATION_LABEL = 'E Las Virgenes Canyon Rd';
export const HELP_LOCATION_DETAIL =
  'Upper Las Virgenes Canyon Open Space — downwind of the modeled fire';

const WEST_HILLS_PICKUP: SafeDestination = {
  id: 'west-hills-pickup',
  name: 'Pickup point — Vanowen St, West Hills (simulated)',
  position: { lat: 34.1937, lng: -118.645 },
  kind: 'pickup-point',
};

const CALABASAS_STAGING: SafeDestination = {
  id: 'calabasas-staging',
  name: 'Staging area — Las Virgenes Rd, Calabasas (simulated)',
  position: { lat: 34.161, lng: -118.7038 },
  kind: 'safe-zone',
};

/**
 * EAST: E Las Virgenes Canyon Rd climbs north-east out of the drainage,
 * swings east along the high ground north of the burn area, exits at the
 * Valley Circle Blvd gate, then Vanowen St runs east into West Hills.
 */
const EAST_PATH: LatLng[] = [
  HELP_GPS_POSITION,
  { lat: 34.1848, lng: -118.6786 },
  { lat: 34.1868, lng: -118.677 },
  { lat: 34.1888, lng: -118.6752 },
  { lat: 34.1906, lng: -118.673 },
  { lat: 34.1918, lng: -118.6706 },
  { lat: 34.1926, lng: -118.668 },
  { lat: 34.1932, lng: -118.6654 },
  { lat: 34.1936, lng: -118.663 },
  { lat: 34.1937, lng: -118.6604 }, // gate at Valley Circle Blvd
  { lat: 34.1937, lng: -118.656 },
  { lat: 34.1937, lng: -118.6515 },
  { lat: 34.1937, lng: -118.648 },
  { lat: 34.1937, lng: -118.645 },
];

/**
 * SOUTH-WEST: E Las Virgenes Canyon Rd follows the canyon south-west (south
 * of the drainage axis the model channels fire along), then Las Virgenes
 * Canyon Rd runs south through the trailhead gate toward Calabasas.
 */
const SOUTHWEST_PATH: LatLng[] = [
  HELP_GPS_POSITION,
  { lat: 34.1812, lng: -118.6826 },
  { lat: 34.1794, lng: -118.6852 },
  { lat: 34.1774, lng: -118.6876 },
  { lat: 34.1752, lng: -118.6898 },
  { lat: 34.173, lng: -118.692 },
  { lat: 34.1712, lng: -118.6946 },
  { lat: 34.17, lng: -118.6976 },
  { lat: 34.1696, lng: -118.7006 }, // junction with Las Virgenes Canyon Rd
  { lat: 34.168, lng: -118.7018 },
  { lat: 34.1662, lng: -118.7026 },
  { lat: 34.1644, lng: -118.7032 }, // trailhead gate
  { lat: 34.1626, lng: -118.7036 },
  { lat: 34.161, lng: -118.7038 },
];

export const ESCAPE_ROUTES: EscapeRoute[] = [
  {
    id: 'east-west-hills',
    destination: WEST_HILLS_PICKUP,
    path: EAST_PATH,
    summary:
      'NORTH-EAST up E Las Virgenes Canyon Rd, then EAST to the Valley Circle Blvd gate and EAST on Vanowen St into West Hills',
    steps: [
      {
        road: 'E Las Virgenes Canyon Rd',
        direction: 'NORTH-EAST',
        arrow: '↗',
        text: 'Head NORTH-EAST up E Las Virgenes Canyon Rd, climbing out of the canyon — the wind is pushing the fire the other way, to the west.',
        fromIndex: 0,
      },
      {
        road: 'E Las Virgenes Canyon Rd',
        direction: 'EAST',
        arrow: '→',
        text: 'Keep EAST along the road over the high ground toward the Valley Circle Blvd gate. Do not turn back west.',
        fromIndex: 4,
      },
      {
        road: 'Vanowen St',
        direction: 'EAST',
        arrow: '→',
        text: 'Through the gate, continue EAST on Vanowen St into West Hills, putting the neighborhood between you and the fire.',
        fromIndex: 9,
      },
      {
        road: 'Vanowen St',
        direction: 'EAST',
        arrow: '→',
        text: 'The pickup point is just ahead on Vanowen St — stay EAST until you reach it.',
        fromIndex: 12,
      },
    ],
  },
  {
    id: 'southwest-calabasas',
    destination: CALABASAS_STAGING,
    path: SOUTHWEST_PATH,
    summary:
      'SOUTH-WEST along E Las Virgenes Canyon Rd to the canyon junction, then SOUTH on Las Virgenes Canyon Rd toward Calabasas',
    steps: [
      {
        road: 'E Las Virgenes Canyon Rd',
        direction: 'SOUTH-WEST',
        arrow: '↙',
        text: 'Head SOUTH-WEST along E Las Virgenes Canyon Rd, staying south of the drainage — keep moving, do not stop in the canyon bottom.',
        fromIndex: 0,
      },
      {
        road: 'Las Virgenes Canyon Rd',
        direction: 'SOUTH',
        arrow: '↓',
        text: 'At the canyon junction turn LEFT and go SOUTH on Las Virgenes Canyon Rd.',
        fromIndex: 8,
      },
      {
        road: 'Las Virgenes Rd',
        direction: 'SOUTH',
        arrow: '↓',
        text: 'Through the trailhead gate, continue SOUTH toward Las Virgenes Rd, Calabasas — the staging area is just ahead.',
        fromIndex: 11,
      },
    ],
  },
];
