/**
 * SIMULATED evacuation data for demo mode.
 *
 * These are NOT official shelters, evacuation centers, or evacuation orders —
 * every name carries "(simulated)" and the UI repeats that. A production
 * deployment must replace these with official data feeds (evacuation zones,
 * shelters, road closures, emergency alerts) before presenting destinations
 * as real.
 *
 * Destinations live east of the fire — upwind and behind the developed-area
 * barrier — which is exactly where good safe zones belong. If the predicted
 * spread ever reaches a destination (margin checks in safeDestinations.ts),
 * the controller relocates the safe zone and reroutes automatically; that
 * rule is unit-tested against late-stage envelope geometry.
 */
import type { LatLng } from '../lib/interpolatePolygon';

export interface SafeDestination {
  id: string;
  name: string;
  position: LatLng;
  kind: 'safe-zone' | 'pickup-point' | 'corridor';
}

export const DEMO_SAFE_DESTINATIONS: SafeDestination[] = [
  {
    id: 'pickup',
    name: 'Evacuation Pickup Point — Shoup & Vanowen (simulated)',
    position: { lat: 34.1937, lng: -118.6125 },
    kind: 'pickup-point',
  },
  {
    id: 'zone-a',
    name: 'Safe Zone A — Topanga staging area (simulated)',
    position: { lat: 34.1893, lng: -118.6053 },
    kind: 'safe-zone',
  },
  {
    id: 'zone-b',
    name: 'Safe Zone B — Woodland Hills south (simulated)',
    position: { lat: 34.1683, lng: -118.6057 },
    kind: 'safe-zone',
  },
  {
    id: 'corridor',
    name: 'Open evacuation corridor — Victory Blvd east (simulated)',
    position: { lat: 34.1898, lng: -118.6302 },
    kind: 'corridor',
  },
];

/**
 * The single simulated person at high risk: a West Hills street ~180 m from
 * the open-space boundary, right against the modeled fire edge.
 */
export const DEMO_USER_START: LatLng = { lat: 34.1842, lng: -118.6628 };
