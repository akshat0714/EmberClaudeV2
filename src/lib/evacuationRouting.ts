/**
 * Evacuation routing controller.
 *
 * Road routes come from the Maps JavaScript API DirectionsService (with
 * alternatives) for every currently-viable simulated safe destination; the
 * pure risk scorer (routeRiskScoring) then rejects anything that touches the
 * modeled fire, its front buffer, or the predicted envelope, and ranks the
 * rest. The suggested route is a model-based recommendation only — the UI
 * always says so — and when every candidate is rejected the controller
 * reports "no modeled low-risk route" instead of faking one.
 *
 * Update cadence:
 *  - user fix: every watchPosition update (or demo/manual moves)
 *  - cheap re-scoring of the current route: every fix / model-snapshot change
 *  - network re-routing: when there is no valid route, when the user strays
 *    off the route, or periodically (~15 s) after meaningful movement —
 *    with a hard floor between Directions calls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_USER_START, type SafeDestination } from '../data/demoEvacuationData';
import { EVACUATION, EVAC_WORDING } from '../data/spreadModelConfig';
import {
  advanceAlongPath,
  bearingDeg,
  distMeters,
  distToPolylineM,
  nearestIndexOnPath,
  offsetByBearing,
  pathLengthM,
  type FireRiskSnapshot,
} from './fireRiskGeometry';
import type { LatLng } from './interpolatePolygon';
import {
  chooseBestRoute,
  classifyUserRisk,
  scoreRoute,
  type RouteCandidate,
  type ScoredRoute,
  type UserRiskClass,
} from './routeRiskScoring';
import { viableDestinations } from './safeDestinations';
import {
  isLowAccuracy,
  makeFix,
  startGpsWatch,
  type GpsStatus,
  type LocationFix,
} from './userLocation';

let directionsPromise: Promise<google.maps.DirectionsService> | null = null;

async function getDirectionsService(): Promise<google.maps.DirectionsService> {
  if (!directionsPromise) {
    directionsPromise = (async () => {
      if (typeof window === 'undefined' || typeof window.google?.maps?.importLibrary !== 'function') {
        throw new Error('Google Maps is not loaded yet.');
      }
      const lib = await google.maps.importLibrary('routes');
      return new lib.DirectionsService();
    })().catch((error: unknown) => {
      directionsPromise = null;
      throw error;
    });
  }
  return directionsPromise;
}

/** Real road candidates (with alternatives) to each viable destination. */
export async function computeRoadRoutes(
  origin: LatLng,
  destinations: SafeDestination[],
): Promise<RouteCandidate[]> {
  const service = await getDirectionsService();
  const settled = await Promise.allSettled(
    destinations.map(async (destination) => {
      const result = await service.route({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: destination.position,
        travelMode: 'DRIVING',
        provideRouteAlternatives: true,
      });
      return { destination, result };
    }),
  );
  const candidates: RouteCandidate[] = [];
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue;
    const { destination, result } = item.value;
    for (const route of result.routes ?? []) {
      const path = (route.overview_path ?? []).map((p) => ({ lat: p.lat(), lng: p.lng() }));
      if (path.length < 2) continue;
      let distanceM = 0;
      let durationS = 0;
      for (const leg of route.legs ?? []) {
        distanceM += leg.distance?.value ?? 0;
        durationS += leg.duration?.value ?? 0;
      }
      candidates.push({ destination, path, distanceM, durationS, source: 'google' });
    }
  }
  if (candidates.length === 0 && settled.every((s) => s.status === 'rejected')) {
    throw new Error('All routing requests failed.');
  }
  return candidates;
}

export type EvacStatus = 'off' | 'need-location' | 'routing' | 'routed' | 'no-route' | 'error';

export interface EvacuationState {
  enabled: boolean;
  status: EvacStatus;
  gpsStatus: GpsStatus;
  fix: LocationFix | null;
  lowAccuracy: boolean;
  picking: boolean;
  driving: boolean;
  arrived: boolean;
  best: ScoredRoute | null;
  userRisk: UserRiskClass | null;
  message: string | null;
  remainingM: number | null;
  remainingS: number | null;
}

export interface EvacuationActions {
  toggle: () => void;
  shareLocation: () => void;
  useDemoLocation: () => void;
  startPicking: () => void;
  cancelPicking: () => void;
  setManualFix: (point: LatLng) => void;
  toggleDrive: () => void;
  moveTowardFire: () => void;
}

const INITIAL_STATE: EvacuationState = {
  enabled: false,
  status: 'off',
  gpsStatus: 'idle',
  fix: null,
  lowAccuracy: false,
  picking: false,
  driving: false,
  arrived: false,
  best: null,
  userRisk: null,
  message: null,
  remainingM: null,
  remainingS: null,
};

interface ControllerRefs {
  enabled: boolean;
  fix: LocationFix | null;
  snapshot: FireRiskSnapshot | null;
  best: ScoredRoute | null;
  routeOrigin: LatLng | null;
  lastNetworkAt: number;
  busy: boolean;
  stopGps: (() => void) | null;
}

export function useEvacuationController(snapshot: FireRiskSnapshot | null): {
  state: EvacuationState;
  actions: EvacuationActions;
} {
  const [state, setState] = useState<EvacuationState>(INITIAL_STATE);
  const refs = useRef<ControllerRefs>({
    enabled: false,
    fix: null,
    snapshot: null,
    best: null,
    routeOrigin: null,
    lastNetworkAt: 0,
    busy: false,
    stopGps: null,
  });
  refs.current.snapshot = snapshot;

  const patch = useCallback((partial: Partial<EvacuationState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const remainingFor = (fix: LocationFix, best: ScoredRoute | null) => {
    if (!best) return { remainingM: null, remainingS: null };
    const idx = nearestIndexOnPath(best.candidate.path, fix);
    const remainingM = pathLengthM(best.candidate.path.slice(idx));
    const remainingS =
      best.candidate.durationS > 0 && best.candidate.distanceM > 0
        ? (best.candidate.durationS * remainingM) / best.candidate.distanceM
        : null;
    return { remainingM, remainingS };
  };

  const evaluate = useCallback(
    async (forceNetwork: boolean) => {
      const r = refs.current;
      if (!r.enabled || !r.fix || !r.snapshot) return;
      const fix = r.fix;
      const snap = r.snapshot;
      const userRisk = classifyUserRisk(fix, snap);

      // Cheap pass: re-score the current route against the latest model.
      let current = r.best;
      if (current) {
        const rescored = scoreRoute(current.candidate, snap);
        current = rescored.status === 'rejected' ? null : rescored;
        r.best = current;
      }

      const now = Date.now();
      const deviation = current ? distToPolylineM(fix, current.candidate.path) : Infinity;
      const moved = r.routeOrigin ? distMeters(fix, r.routeOrigin) : Infinity;
      const periodicDue =
        now - r.lastNetworkAt > EVACUATION.reroute.minIntervalMs &&
        moved > EVACUATION.reroute.moveThresholdM;
      const needNetwork =
        forceNetwork || !current || deviation > EVACUATION.reroute.deviationM || periodicDue;

      if (!needNetwork) {
        patch({ best: current, userRisk, status: 'routed', ...remainingFor(fix, current) });
        return;
      }
      if (r.busy || now - r.lastNetworkAt < EVACUATION.reroute.networkFloorMs) {
        if (current) patch({ best: current, userRisk, ...remainingFor(fix, current) });
        return;
      }

      r.busy = true;
      if (!current) patch({ status: 'routing', userRisk, message: null });
      try {
        const destinations = viableDestinations(snap);
        if (destinations.length === 0) {
          r.best = null;
          patch({
            best: null,
            status: 'no-route',
            userRisk,
            message: EVAC_WORDING.statusNone,
            remainingM: null,
            remainingS: null,
          });
          return;
        }
        const candidates = await computeRoadRoutes({ lat: fix.lat, lng: fix.lng }, destinations);
        r.lastNetworkAt = Date.now();
        r.routeOrigin = { lat: fix.lat, lng: fix.lng };
        const latestSnap = refs.current.snapshot ?? snap;
        const { best } = chooseBestRoute(candidates, latestSnap);
        r.best = best;
        const latestFix = refs.current.fix ?? fix;
        if (!best) {
          patch({
            best: null,
            status: 'no-route',
            userRisk,
            message: EVAC_WORDING.statusNone,
            remainingM: null,
            remainingS: null,
            arrived: false,
          });
        } else {
          patch({
            best,
            status: 'routed',
            userRisk,
            message: null,
            arrived: false,
            ...remainingFor(latestFix, best),
          });
        }
      } catch {
        if (!refs.current.best) {
          patch({
            status: 'error',
            userRisk,
            message:
              'Road routing is unavailable. Check that the Directions API is enabled for this key.',
          });
        }
      } finally {
        r.busy = false;
      }
    },
    [patch],
  );

  const setFix = useCallback(
    (fix: LocationFix) => {
      refs.current.fix = fix;
      patch({ fix, lowAccuracy: isLowAccuracy(fix), picking: false });
      void evaluate(false);
    },
    [evaluate, patch],
  );

  const actions: EvacuationActions = {
    toggle: () => {
      const r = refs.current;
      if (r.enabled) {
        r.enabled = false;
        r.stopGps?.();
        r.stopGps = null;
        r.best = null;
        r.routeOrigin = null;
        patch({
          enabled: false,
          status: 'off',
          best: null,
          driving: false,
          arrived: false,
          picking: false,
          message: null,
          remainingM: null,
          remainingS: null,
        });
      } else {
        r.enabled = true;
        patch({ enabled: true, status: r.fix ? 'routing' : 'need-location', arrived: false });
        if (r.fix) void evaluate(true);
      }
    },
    shareLocation: () => {
      refs.current.stopGps?.();
      patch({ gpsStatus: 'requesting' });
      refs.current.stopGps = startGpsWatch(
        (fix) => setFix(fix),
        (gpsStatus) => patch({ gpsStatus }),
      );
    },
    useDemoLocation: () => setFix(makeFix(DEMO_USER_START, 'demo')),
    startPicking: () => patch({ picking: true }),
    cancelPicking: () => patch({ picking: false }),
    setManualFix: (point) => setFix(makeFix(point, 'manual', 20)),
    toggleDrive: () => {
      patch({ driving: !state.driving, arrived: false });
    },
    moveTowardFire: () => {
      const r = refs.current;
      if (!r.fix || !r.snapshot) return;
      const bearing = bearingDeg(r.fix, r.snapshot.fireCentroid);
      const moved = offsetByBearing(r.fix, bearing, EVACUATION.demoNudgeM);
      const source = r.fix.source === 'gps' ? 'demo' : r.fix.source;
      setFix(makeFix(moved, source, 20, bearing));
    },
  };

  // Re-evaluate whenever the fire model publishes a new snapshot.
  useEffect(() => {
    if (refs.current.enabled && refs.current.fix && snapshot) void evaluate(false);
  }, [snapshot, evaluate]);

  // Periodic safety net (timers for reroute cadence).
  useEffect(() => {
    if (!state.enabled) return;
    const id = window.setInterval(() => void evaluate(false), 5000);
    return () => window.clearInterval(id);
  }, [state.enabled, evaluate]);

  // Demo drive: advance the demo user along the suggested route.
  useEffect(() => {
    if (!state.driving) return;
    const id = window.setInterval(() => {
      const r = refs.current;
      const best = r.best;
      const fix = r.fix;
      if (!best || !fix) {
        patch({ driving: false });
        return;
      }
      const idx = nearestIndexOnPath(best.candidate.path, fix);
      const step = advanceAlongPath(best.candidate.path, idx, EVACUATION.demoDriveStepM);
      const source = fix.source === 'gps' ? 'demo' : fix.source;
      setFix(makeFix(step.point, source, 15, step.headingDeg));
      if (step.atEnd) patch({ driving: false, arrived: true });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.driving, setFix, patch]);

  // Stop the GPS watch on unmount.
  useEffect(() => () => refs.current.stopGps?.(), []);

  return { state, actions };
}
