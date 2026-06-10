/**
 * User location handling: browser GPS via navigator.geolocation.watchPosition
 * (high-accuracy, continuous), with demo and manual fallbacks so the feature
 * works in a hackathon room. Location never leaves the browser.
 */
import { EVACUATION } from '../data/spreadModelConfig';
import type { LatLng } from './interpolatePolygon';

export type FixSource = 'gps' | 'demo' | 'manual';

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number;
  headingDeg: number | null;
  source: FixSource;
  timestamp: number;
}

export type GpsStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable';

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

export function isLowAccuracy(fix: LocationFix | null): boolean {
  return fix !== null && fix.source === 'gps' && fix.accuracyM > EVACUATION.lowAccuracyM;
}

/**
 * Start a continuous high-accuracy GPS watch. Returns a stop function.
 * Errors surface through onStatus ('denied' / 'unavailable').
 */
export function startGpsWatch(
  onFix: (fix: LocationFix) => void,
  onStatus: (status: GpsStatus) => void,
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onStatus('unavailable');
    return () => {};
  }
  onStatus('requesting');
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      onStatus('watching');
      onFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? 50,
        headingDeg: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        source: 'gps',
        timestamp: position.timestamp,
      });
    },
    (error) => {
      onStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
