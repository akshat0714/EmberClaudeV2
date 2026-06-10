/**
 * SIMULATED evacuation data for demo mode.
 *
 * These are NOT official shelters, evacuation centers, or evacuation orders —
 * every name carries "(simulated)" and the UI repeats that. They are placed
 * in the developed San Fernando Valley east/northeast of the modeled fire
 * area (upwind of the WSW-driven Kenneth Fire spread), so a sound route
 * naturally leads away from the modeled risk zones.
 *
 * A production deployment must replace these with official data feeds
 * (evacuation zones, shelters, road closures, emergency alerts) before
 * presenting destinations as real.
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
    id: 'pickup',
    name: 'Evacuation Pickup Point — Shoup & Vanowen (simulated)',
    position: { lat: 34.1937, lng: -118.6125 },
    kind: 'pickup-point',
  },
  {
    id: 'corridor',
    name: 'Open evacuation corridor — Victory Blvd east (simulated)',
    position: { lat: 34.1898, lng: -118.6302 },
    kind: 'corridor',
  },
];

/**
 * Demo user start: a West Hills street a few hundred metres east of the
 * open-space boundary — threatened by the modeled fire, but with real roads
 * leading east away from it. Judges can move this dot without real GPS.
 */
export const DEMO_USER_START: LatLng = { lat: 34.1869, lng: -118.6553 };
