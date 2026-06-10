/**
 * Tiny pub/sub for the latest fire situation, decoupling the 3D scene
 * (which advances the fire with the clock) from the navigation controller
 * (which routes against it at its own cadence).
 */
import type { SeedPoint } from './arrivalTimeModel';
import type { Hotspot, SpotFire } from './hotspots';
import type { LatLng } from './interpolatePolygon';

export interface FireSnapshot {
  /** Current front ring (warped multi-point frontier). */
  front: LatLng[];
  /** Active ember spot fires (also seeded into prediction fields). */
  spots: SpotFire[];
  hotspots: Hotspot[];
  /** Simulation clock time of this snapshot, UTC ms. */
  simTimeMs: number;
  /** True once the reconstruction reached its final footprint. */
  atEnd: boolean;
}

export function spotSeedsOf(snapshot: FireSnapshot): SeedPoint[] {
  return snapshot.spots.map((s) => ({ lat: s.point.lat, lng: s.point.lng, delayMin: s.delayMin }));
}

type Listener = (snapshot: FireSnapshot) => void;

let latest: FireSnapshot | null = null;
const listeners = new Set<Listener>();

export function publishFireSnapshot(snapshot: FireSnapshot): void {
  latest = snapshot;
  for (const listener of listeners) listener(snapshot);
}

export function getFireSnapshot(): FireSnapshot | null {
  return latest;
}

export function subscribeFire(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
