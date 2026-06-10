/**
 * SIMULATED rescue scenario for the Help flow — urban edition.
 *
 * When someone presses "Help", the demo "locates" them on a residential
 * street in West Hills, two blocks downwind (west-south-west) of the
 * burning homes — directly in the modeled spread path. The position, the
 * street geometry, and the safe destinations here are all SIMULATED demo
 * data (names carry "(simulated)"); the fire-risk checks against them use
 * the live spread model.
 *
 * Escape routes follow the real street grid, and WHICH one is offered
 * depends on what the person has:
 *
 *  - CAR: get far away fast on the boulevards — west to Valley Circle Blvd,
 *    south to Victory Blvd, then EAST on Victory Blvd ~4.5 km to an
 *    evacuation center at Shoup Ave. Upwind, away from the spread.
 *  - ON FOOT: use the streets to your advantage — a pedestrian walkway
 *    between the houses (a shortcut cars can't take) drops straight SOUTH
 *    to Victory Blvd, then EAST a few blocks to a pocket-park safe zone.
 *    Short, crosswind, never toward the fire. A NORTH route to a Vanowen St
 *    staging point is the on-foot backup.
 *
 * Candidates allowed for the person's mode are risk-scored against the live
 * model every refresh; the surviving lower-risk one is shown. A production
 * deployment must replace all of this with official evacuation data.
 */
import type { LatLng } from '../lib/interpolatePolygon';
import type { TransportMode } from '../lib/rescueAssistant';

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
  /** Which transport modes can physically use this route (walkways exclude cars). */
  allowedModes: TransportMode[];
  /** Full street polyline from the simulated GPS position to the destination. */
  path: LatLng[];
  steps: RouteStep[];
  /** One-line qualitative summary (roads + compass words). */
  summary: string;
}

/** Where the simulated GPS fix drops: a street two blocks downwind. */
export const HELP_GPS_POSITION: LatLng = { lat: 34.1895, lng: -118.6588 };

export const HELP_LOCATION_LABEL = 'Residential street — West Hills';
export const HELP_LOCATION_DETAIL = 'two blocks downwind of the burning homes';

const VICTORY_EVAC_CENTER: SafeDestination = {
  id: 'victory-shoup-center',
  name: 'Evacuation center — Victory Blvd × Shoup Ave (simulated)',
  position: { lat: 34.1862, lng: -118.6125 },
  kind: 'safe-zone',
};

const VICTORY_POCKET_PARK: SafeDestination = {
  id: 'victory-pocket-park',
  name: 'Safe zone — pocket park on Victory Blvd (simulated)',
  position: { lat: 34.186, lng: -118.644 },
  kind: 'safe-zone',
};

const VANOWEN_STAGING: SafeDestination = {
  id: 'vanowen-staging',
  name: 'Pickup point — Vanowen St staging (simulated)',
  position: { lat: 34.1937, lng: -118.631 },
  kind: 'pickup-point',
};

/** CAR: around the block to the boulevards, then far east, upwind. */
const CAR_PATH: LatLng[] = [
  HELP_GPS_POSITION,
  { lat: 34.1895, lng: -118.6605 }, // west to Valley Circle Blvd
  { lat: 34.1878, lng: -118.6606 },
  { lat: 34.1862, lng: -118.6607 }, // south to Victory Blvd
  { lat: 34.1862, lng: -118.656 },
  { lat: 34.1862, lng: -118.6505 },
  { lat: 34.1862, lng: -118.645 },
  { lat: 34.1862, lng: -118.639 },
  { lat: 34.1862, lng: -118.633 },
  { lat: 34.1862, lng: -118.627 },
  { lat: 34.1862, lng: -118.621 },
  { lat: 34.1862, lng: -118.616 },
  { lat: 34.1862, lng: -118.6125 }, // evacuation center at Shoup Ave
];

/** FOOT: the mid-block walkway shortcut south, then east on Victory Blvd. */
const FOOT_PATH: LatLng[] = [
  HELP_GPS_POSITION,
  { lat: 34.1884, lng: -118.6587 },
  { lat: 34.1873, lng: -118.6586 }, // pedestrian walkway between the houses
  { lat: 34.1862, lng: -118.6585 }, // Victory Blvd
  { lat: 34.1862, lng: -118.654 },
  { lat: 34.1862, lng: -118.65 },
  { lat: 34.1861, lng: -118.647 },
  { lat: 34.186, lng: -118.644 }, // pocket park
];

/** FOOT backup: north to Vanowen St, then east to the staging point. */
const NORTH_PATH: LatLng[] = [
  HELP_GPS_POSITION,
  { lat: 34.1916, lng: -118.6589 },
  { lat: 34.1937, lng: -118.659 }, // Vanowen St
  { lat: 34.1937, lng: -118.654 },
  { lat: 34.1937, lng: -118.648 },
  { lat: 34.1937, lng: -118.642 },
  { lat: 34.1937, lng: -118.636 },
  { lat: 34.1937, lng: -118.631 }, // staging point
];

export const ESCAPE_ROUTES: EscapeRoute[] = [
  {
    id: 'car-victory-east',
    destination: VICTORY_EVAC_CENTER,
    allowedModes: ['car'],
    path: CAR_PATH,
    summary:
      'WEST to Valley Circle Blvd, SOUTH to Victory Blvd, then EAST on Victory Blvd to the evacuation center at Shoup Ave',
    steps: [
      {
        road: 'Your street',
        direction: 'WEST',
        arrow: '←',
        text: 'Drive WEST, away from the burning homes, to Valley Circle Blvd.',
        fromIndex: 0,
      },
      {
        road: 'Valley Circle Blvd',
        direction: 'SOUTH',
        arrow: '↓',
        text: 'Turn LEFT. Go SOUTH to Victory Blvd.',
        fromIndex: 1,
      },
      {
        road: 'Victory Blvd',
        direction: 'EAST',
        arrow: '→',
        text: 'Turn LEFT. Go EAST on Victory Blvd, straight away from the fire.',
        fromIndex: 3,
      },
      {
        road: 'Victory Blvd',
        direction: 'EAST',
        arrow: '→',
        text: 'The evacuation center is ahead at Shoup Ave.',
        fromIndex: 10,
      },
    ],
  },
  {
    id: 'foot-victory-park',
    destination: VICTORY_POCKET_PARK,
    allowedModes: ['foot'],
    path: FOOT_PATH,
    summary: 'SOUTH through the walkway to Victory Blvd, then EAST to the pocket park',
    steps: [
      {
        road: 'Walkway between the houses',
        direction: 'SOUTH',
        arrow: '↓',
        text: 'Take the walkway SOUTH between the houses — a shortcut cars can’t use.',
        fromIndex: 0,
      },
      {
        road: 'Victory Blvd',
        direction: 'EAST',
        arrow: '→',
        text: 'Turn LEFT. Walk EAST on Victory Blvd, keeping the fire behind you.',
        fromIndex: 3,
      },
      {
        road: 'Victory Blvd',
        direction: 'EAST',
        arrow: '→',
        text: 'The park safe zone is just ahead.',
        fromIndex: 6,
      },
    ],
  },
  {
    id: 'foot-vanowen-north',
    destination: VANOWEN_STAGING,
    allowedModes: ['foot'],
    path: NORTH_PATH,
    summary: 'NORTH to Vanowen St, then EAST to the staging point',
    steps: [
      {
        road: 'Your street',
        direction: 'NORTH',
        arrow: '↑',
        text: 'Head NORTH to Vanowen St.',
        fromIndex: 0,
      },
      {
        road: 'Vanowen St',
        direction: 'EAST',
        arrow: '→',
        text: 'Go EAST on Vanowen St, away from the fire.',
        fromIndex: 2,
      },
      {
        road: 'Vanowen St',
        direction: 'EAST',
        arrow: '→',
        text: 'The staging point is just ahead.',
        fromIndex: 6,
      },
    ],
  },
];
