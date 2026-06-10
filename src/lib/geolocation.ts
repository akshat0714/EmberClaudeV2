/**
 * User position sources for navigation.
 *
 *  - REAL mode wraps the W3C Geolocation API (`watchPosition` with
 *    enableHighAccuracy, per MDN best practice). Browsers only expose it in
 *    secure contexts (HTTPS or localhost), and smartphone GPS is typically
 *    accurate to ~5 m outdoors under open sky (see RESEARCH.md), so the
 *    accuracy radius is drawn rather than trusted as exact.
 *
 *  - SIM mode exists because nobody demos this app from inside a wildfire:
 *    the user is placed anywhere on the map and optionally driven along the
 *    current route at the route's own modeled speeds, with light GPS-like
 *    jitter so snapping/rerouting code paths run realistically.
 */
import type { LatLng } from './interpolatePolygon';
import { distMeters } from './streetGraph';
import type { RouteTrack } from './turnByTurn';

export interface UserFix {
  point: LatLng;
  /** 1-sigma accuracy radius in meters. */
  accuracyM: number;
  /** Course over ground, degrees clockwise from north; null when unknown. */
  headingDeg: number | null;
  /** Ground speed m/s; null when unknown. */
  speedMps: number | null;
  source: 'gps' | 'sim';
  timestamp: number;
}

export type FixListener = (fix: UserFix) => void;
export type GeoErrorListener = (message: string) => void;

export function watchRealPosition(
  onFix: FixListener,
  onError: GeoErrorListener,
): () => void {
  if (!('geolocation' in navigator)) {
    onError('This browser does not expose geolocation.');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      onFix({
        point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyM: pos.coords.accuracy ?? 30,
        headingDeg: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
        source: 'gps',
        timestamp: pos.timestamp,
      });
    },
    (err) => {
      const reasons: Record<number, string> = {
        1: 'Location permission was denied.',
        2: 'Position unavailable (no GPS/network fix).',
        3: 'Timed out waiting for a position fix.',
      };
      onError(reasons[err.code] ?? err.message);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Deterministic small PRNG (mulberry32) for repeatable sim jitter. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 92_100;

/**
 * Drive simulation along a route track. Call `tick(simMinutesElapsed)` as the
 * app clock advances; emits jittered fixes at ~1 Hz of simulated time.
 */
export class DriveSimulator {
  private alongM: number;
  private random = mulberry32(20250109);
  private lastEmit = -Infinity;

  constructor(
    private track: RouteTrack,
    startAlongM = 0,
    /** GPS-like horizontal jitter sigma, meters. */
    private jitterM = 3.5,
  ) {
    this.alongM = startAlongM;
  }

  /** Average pace from the route model itself (min per meter). */
  private paceMinPerM(): number {
    return this.track.totalMin / Math.max(this.track.totalM, 1);
  }

  get finished(): boolean {
    return this.alongM >= this.track.totalM - 1;
  }

  get distanceAlongM(): number {
    return this.alongM;
  }

  /** Re-target the sim after a reroute, keeping continuity of position. */
  retarget(track: RouteTrack, alongM: number): void {
    this.track = track;
    this.alongM = alongM;
  }

  /** Advance by simulated minutes; returns a fix when one is due. */
  tick(simMinutesDelta: number, simTimeMs: number): UserFix | null {
    if (this.finished) return null;
    this.alongM = Math.min(
      this.track.totalM,
      this.alongM + simMinutesDelta / this.paceMinPerM(),
    );
    if (simTimeMs - this.lastEmit < 900) return null;
    this.lastEmit = simTimeMs;

    const { path, cum } = this.track;
    let i = 0;
    while (i + 1 < cum.length && cum[i + 1] < this.alongM) i++;
    const segLen = cum[i + 1] - cum[i] || 1;
    const f = Math.max(0, Math.min(1, (this.alongM - cum[i]) / segLen));
    const base: LatLng = {
      lat: path[i].lat + (path[i + 1].lat - path[i].lat) * f,
      lng: path[i].lng + (path[i + 1].lng - path[i].lng) * f,
    };
    // Box-Muller jitter
    const u1 = Math.max(this.random(), 1e-9);
    const u2 = this.random();
    const r = this.jitterM * Math.sqrt(-2 * Math.log(u1));
    const point: LatLng = {
      lat: base.lat + (r * Math.cos(2 * Math.PI * u2)) / M_PER_DEG_LAT,
      lng: base.lng + (r * Math.sin(2 * Math.PI * u2)) / M_PER_DEG_LNG,
    };
    const ahead: LatLng = path[Math.min(i + 1, path.length - 1)];
    const speedMps = 1 / (this.paceMinPerM() * 60);
    return {
      point,
      accuracyM: 6,
      headingDeg: distMeters(base, ahead) > 1 ? bearing(base, ahead) : null,
      speedMps,
      source: 'sim',
      timestamp: simTimeMs,
    };
  }
}

function bearing(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * M_PER_DEG_LNG;
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}
