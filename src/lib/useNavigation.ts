/**
 * Navigation controller: owns the user's position (real GPS, click-placed,
 * or drive-simulated), keeps a fire-aware route alive against the latest
 * fire snapshot, projects live progress for the guidance card, fires voice
 * prompts, and reroutes when the user strays or the fire makes the current
 * route unsafe (re-validated on a fixed cadence — Cova-style trigger logic
 * applied continuously to the remaining route).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NAV, SAFE_ZONES, type SafeZone } from '../data/navConfig';
import {
  routeToSafety,
  type EvacRoute,
  type RouteTarget,
  type TravelMode,
} from './fireAwareRouter';
import { computeHazardField, hazardAt, type HazardField } from './fireHazard';
import { getFireSnapshot, subscribeFire, type FireSnapshot } from './fireState';
import { DriveSimulator, watchRealPosition, type UserFix } from './geolocation';
import type { LatLng } from './interpolatePolygon';
import { speak, setVoiceMuted, voiceMuted } from './speech';
import {
  buildTrack,
  formatDistanceImperial,
  remainingPath,
  trackProgress,
  type RouteProgress,
  type RouteTrack,
} from './turnByTurn';

export type NavPhase = 'idle' | 'ready' | 'navigating' | 'arrived';

export interface NavState {
  phase: NavPhase;
  travelMode: TravelMode;
  user: UserFix | null;
  route: EvacRoute | null;
  track: RouteTrack | null;
  progress: RouteProgress | null;
  /** Route only meets the survival floor, not the full safety margin. */
  degraded: boolean;
  /** Routing ran and found nothing at all. */
  noRoute: boolean;
  gpsError: string | null;
  gpsActive: boolean;
  voiceOn: boolean;
  driveSimOn: boolean;
  /** Why the last reroute happened (shown briefly in the panel). */
  rerouteReason: string | null;
  /** Live clearance (min) between the user and the predicted fire, at the user. */
  userClearanceMin: number | null;
}

export interface NavActions {
  placeUser(point: LatLng): void;
  enableGps(): void;
  disableGps(): void;
  setTravelMode(mode: TravelMode): void;
  start(): void;
  stop(): void;
  toggleVoice(): void;
  setDriveSim(on: boolean): void;
}

const targets: RouteTarget[] = SAFE_ZONES.map((z) => ({ id: z.id, name: z.name, point: z.point }));

export function safeZoneOf(route: EvacRoute | null): SafeZone | null {
  if (!route) return null;
  return SAFE_ZONES.find((z) => z.id === route.target.id) ?? null;
}

export function useNavigation(simTimeMs: number, enabled: boolean) {
  const [state, setState] = useState<NavState>({
    phase: 'idle',
    travelMode: 'drive',
    user: null,
    route: null,
    track: null,
    progress: null,
    degraded: false,
    noRoute: false,
    gpsError: null,
    gpsActive: false,
    voiceOn: !voiceMuted(),
    driveSimOn: false,
    rerouteReason: null,
    userClearanceMin: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const snapshotRef = useRef<FireSnapshot | null>(getFireSnapshot());
  const hazardRef = useRef<HazardField | null>(null);
  const driveSimRef = useRef<DriveSimulator | null>(null);
  const gpsStopRef = useRef<(() => void) | null>(null);
  const lastSimTimeRef = useRef(simTimeMs);
  const lastRevalidateRef = useRef(0);
  const announcedRef = useRef<{ step: number; tier: number }>({ step: -1, tier: -1 });

  useEffect(() => subscribeFire((s) => (snapshotRef.current = s)), []);

  /** Fresh routing field when none exists or sim time drifted > 3 min. */
  const freshHazard = useCallback((): HazardField | null => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return null;
    const existing = hazardRef.current;
    if (
      !existing ||
      Math.abs(snapshot.simTimeMs - existing.fieldSimTimeMs) > 3 * 60_000 ||
      existing.atEnd !== snapshot.atEnd
    ) {
      hazardRef.current = computeHazardField(snapshot);
    }
    return hazardRef.current;
  }, []);

  // simTime in a ref so callbacks never go stale
  const simTimeMsRef = useRef(simTimeMs);
  simTimeMsRef.current = simTimeMs;

  const computeRoute = useCallback(
    (origin: LatLng, mode: TravelMode): { route: EvacRoute | null; degraded: boolean } => {
      const hazardField = freshHazard();
      if (!hazardField) return { route: null, degraded: false };
      const hazard = hazardAt(hazardField, simTimeMsRef.current);
      return routeToSafety(origin, targets, hazard, mode);
    },
    [freshHazard],
  );

  const adoptRoute = useCallback(
    (route: EvacRoute | null, degraded: boolean, reason: string | null) => {
      if (!route) {
        setState((s) => ({ ...s, route: null, track: null, progress: null, noRoute: true, rerouteReason: reason }));
        return;
      }
      const track = buildTrack(route);
      announcedRef.current = { step: -1, tier: -1 };
      if (driveSimRef.current) {
        driveSimRef.current.retarget(track, 0);
      }
      setState((s) => ({
        ...s,
        route,
        track,
        progress: s.user ? trackProgress(track, s.user.point) : null,
        degraded,
        noRoute: false,
        rerouteReason: reason,
      }));
      if (reason) speak(reason);
      const first = track.steps[0];
      if (first) speak(`${first.instruction}. Then ${track.steps[1]?.instruction ?? 'continue'}.`);
    },
    [],
  );

  const placeUser = useCallback((point: LatLng) => {
    gpsStopRef.current?.();
    gpsStopRef.current = null;
    driveSimRef.current = null;
    const fix: UserFix = {
      point,
      accuracyM: 5, // GPS.gov: ~4.9 m typical open-sky smartphone accuracy
      headingDeg: null,
      speedMps: null,
      source: 'sim',
      timestamp: simTimeMsRef.current,
    };
    setState((s) => ({
      ...s,
      user: fix,
      gpsActive: false,
      gpsError: null,
      driveSimOn: false,
      phase: 'ready',
      route: null,
      track: null,
      progress: null,
      rerouteReason: null,
    }));
  }, []);

  const enableGps = useCallback(() => {
    gpsStopRef.current?.();
    driveSimRef.current = null;
    setState((s) => ({ ...s, gpsActive: true, gpsError: null, driveSimOn: false }));
    gpsStopRef.current = watchRealPosition(
      (fix) => {
        setState((s) => ({
          ...s,
          user: fix,
          phase: s.phase === 'idle' ? 'ready' : s.phase,
        }));
      },
      (message) => setState((s) => ({ ...s, gpsError: message, gpsActive: false })),
    );
  }, []);

  const disableGps = useCallback(() => {
    gpsStopRef.current?.();
    gpsStopRef.current = null;
    setState((s) => ({ ...s, gpsActive: false }));
  }, []);

  const start = useCallback(() => {
    const user = stateRef.current.user;
    if (!user) return;
    const { route, degraded } = computeRoute(user.point, stateRef.current.travelMode);
    adoptRoute(route, degraded, null);
    setState((s) => ({ ...s, phase: route ? 'navigating' : s.phase }));
  }, [adoptRoute, computeRoute]);

  const stop = useCallback(() => {
    driveSimRef.current = null;
    setState((s) => ({
      ...s,
      phase: 'ready',
      route: null,
      track: null,
      progress: null,
      driveSimOn: false,
      degraded: false,
      noRoute: false,
      rerouteReason: null,
    }));
  }, []);

  const setTravelMode = useCallback(
    (mode: TravelMode) => {
      setState((s) => ({ ...s, travelMode: mode }));
      const s = stateRef.current;
      if (s.phase === 'navigating' && s.user) {
        const { route, degraded } = computeRoute(s.user.point, mode);
        adoptRoute(route, degraded, null);
      }
    },
    [adoptRoute, computeRoute],
  );

  const toggleVoice = useCallback(() => {
    const turningOn = voiceMuted();
    setVoiceMuted(!turningOn);
    setState((s) => ({ ...s, voiceOn: turningOn }));
    if (turningOn) speak('Voice guidance on.');
  }, []);

  const setDriveSim = useCallback((on: boolean) => {
    const s = stateRef.current;
    if (on && s.track) {
      driveSimRef.current = new DriveSimulator(s.track, s.progress?.alongM ?? 0);
      lastSimTimeRef.current = simTimeMsRef.current;
    } else {
      driveSimRef.current = null;
    }
    setState((prev) => ({ ...prev, driveSimOn: on }));
  }, []);

  // ---- the live loop: runs as the simulation clock advances
  useEffect(() => {
    if (!enabled) return;
    const s = stateRef.current;
    const deltaMin = Math.max(0, (simTimeMs - lastSimTimeRef.current) / 60_000);
    lastSimTimeRef.current = simTimeMs;
    if (s.phase !== 'navigating' || !s.track) return;

    // 1. drive simulation produces fixes as sim time advances
    let user = s.user;
    const sim = driveSimRef.current;
    if (sim && deltaMin > 0) {
      const fix = sim.tick(deltaMin, simTimeMs);
      if (fix) {
        user = fix;
        setState((prev) => ({ ...prev, user: fix }));
      }
    }
    if (!user) return;

    // 2. live progress along the route
    const progress = trackProgress(s.track, user.point);
    const hazardField = hazardRef.current;
    const clearance =
      hazardField !== null
        ? hazardAt(hazardField, simTimeMs).arrivalMinutes(user.point)
        : null;
    setState((prev) => ({
      ...prev,
      progress,
      userClearanceMin: clearance === null ? null : Math.min(clearance, 999),
    }));

    // 3. arrival
    if (progress.remainingM < 30) {
      speak(`You have arrived at ${s.route?.target.name}.`);
      driveSimRef.current = null;
      setState((prev) => ({ ...prev, phase: 'arrived', driveSimOn: false }));
      return;
    }

    // 4. voice prompts (two tiers per maneuver)
    const steps = s.track.steps;
    const nextStep = steps[progress.stepIndex + 1];
    if (nextStep && nextStep.type !== 'arrive') {
      const tiers: Array<[number, number]> = [
        [s.travelMode === 'drive' ? 360 : 90, 0],
        [s.travelMode === 'drive' ? 85 : 25, 1],
      ];
      for (const [distM, tier] of tiers) {
        if (progress.toManeuverM <= distM) {
          const a = announcedRef.current;
          if (a.step !== progress.stepIndex || a.tier < tier) {
            announcedRef.current = { step: progress.stepIndex, tier };
            const spokenDist = formatDistanceImperial(progress.toManeuverM)
              .replace(' ft', ' feet')
              .replace(' mi', ' miles');
            speak(
              tier === 0 ? `In ${spokenDist}, ${nextStep.instruction}` : nextStep.instruction,
            );
          }
        }
      }
    }

    // 5. off-route → reroute from where the user actually is
    if (progress.offRouteM > NAV.offRouteM) {
      const { route, degraded } = computeRoute(user.point, s.travelMode);
      if (route) adoptRoute(route, degraded, 'Rerouting.');
      return;
    }

    // 6. periodic fire re-validation of the remaining route
    const now = performance.now();
    if (now - lastRevalidateRef.current >= NAV.revalidateMs) {
      lastRevalidateRef.current = now;
      const snapshot = snapshotRef.current;
      if (snapshot) {
        hazardRef.current = computeHazardField(snapshot);
        const hazard = hazardAt(hazardRef.current, simTimeMs);
        const remaining = remainingPath(s.track, progress.alongM);
        const paceMinPerM = s.track.totalMin / Math.max(s.track.totalM, 1);
        let minClear = Infinity;
        let traveled = 0;
        for (let i = 0; i < remaining.length; i++) {
          if (i > 0) {
            traveled += Math.hypot(
              (remaining[i].lat - remaining[i - 1].lat) * 111_320,
              (remaining[i].lng - remaining[i - 1].lng) * 92_100,
            );
          }
          const c = hazard.arrivalMinutes(remaining[i]) - traveled * paceMinPerM;
          if (c < minClear) minClear = c;
        }
        const floor = s.degraded ? NAV.survivalMarginMin : NAV.hardMarginMin;
        if (minClear < floor) {
          const { route, degraded } = computeRoute(user.point, s.travelMode);
          if (route) {
            adoptRoute(route, degraded, 'Rerouting — the road ahead is predicted to be cut off by the fire.');
          } else {
            setState((prev) => ({ ...prev, degraded: true, noRoute: true }));
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simTimeMs, enabled]);

  // teardown on unmount
  useEffect(
    () => () => {
      gpsStopRef.current?.();
      driveSimRef.current = null;
    },
    [],
  );

  const actions: NavActions = {
    placeUser,
    enableGps,
    disableGps,
    setTravelMode,
    start,
    stop,
    toggleVoice,
    setDriveSim,
  };
  return { state, actions };
}
