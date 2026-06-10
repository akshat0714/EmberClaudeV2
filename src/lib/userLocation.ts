/**
 * Location-fix model for the Help rescue flow. The demo "locates" a
 * simulated person (source 'demo'); the same shape would carry a real
 * browser GPS fix in a production build, and it never leaves the browser.
 */
import type { LatLng } from './interpolatePolygon';

export type FixSource = 'gps' | 'demo';

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number;
  headingDeg: number | null;
  source: FixSource;
  timestamp: number;
}

export function makeFix(
  point: LatLng,
  source: FixSource,
  accuracyM = 25,
  headingDeg: number | null = null,
): LocationFix {
  return {
    lat: point.lat,
    lng: point.lng,
    accuracyM,
    headingDeg,
    source,
    timestamp: Date.now(),
  };
}
