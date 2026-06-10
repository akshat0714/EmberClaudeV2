/**
 * Rescue-sim evacuation controller.
 *
 * One simulated person at high risk near the modeled fire. A text-only
 * assistant (LLM-phrased when a Gemini key is configured, deterministic
 * otherwise) asks how they are travelling (car / on foot, accessibility);
 * the answer picks the Directions travel mode. Road routes to the simulated
 * safe destinations are risk-scored against the live fire model; the chosen
 * one draws as a blue Google-Maps-style path to a green safe zone.
 *
 * World-time coupling: the fire and the person share the reconstruction
 * clock. While the person is replying in real time the world runs at
 * 1 fire-minute = 1 real minute; otherwise it fast-forwards at
 * 1 fire-minute = 1 real second. The person moves along the route in WORLD
 * time (driving ~40 km/h, walking ~5 km/h), so chatting literally costs
 * world time — and the route, destination and safe zone are re-validated as
 * the prediction advances: if the predicted spread threatens the safe zone,
 * it is relocated and the route is rebuilt for the person's travel mode.
 *
 * Honesty: model-based suggestions only; "no modeled low-risk route" is
 * reported rather than faked; all wording mirrors EVAC_WORDING.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_USER_START, type SafeDestination } from '../data/demoEvacuationData';
import { EVACUATION, EVAC_WORDING } from '../data/spreadModelConfig';
import {
  advanceAlongPath,
  distMeters,
  distToPolylineM,
  nearestIndexOnPath,
  pathLengthM,
  type FireRiskSnapshot,
} from './fireRiskGeometry';
import type { LatLng } from './interpolatePolygon';
import {
  generateAssistantReply,
  parseAccessibilityNote,
  parseTransportMode,
  type AssistantContext,
  type AssistantEvent,
  type ChatMessage,
  type TransportMode,
} from './rescueAssistant';
import {
  chooseBestRoute,
  classifyUserRisk,
  scoreRoute,
  type RouteCandidate,
  type ScoredRoute,
  type UserRiskClass,
} from './routeRiskScoring';
import { isDestinationViable, viableDestinations } from './safeDestinations';
import { isLowAccuracy, makeFix, type LocationFix } from './userLocation';

let directionsPromise: Promise<google.maps.DirectionsService> | null = null;

async function getDirectionsService(): Promise<google.maps.DirectionsService> {
  if (!directionsPromise) {
    directionsPromise = (async () => {
      if (
        typeof window === 'undefined' ||
        typeof window.google?.maps?.importLibrary !== 'function'
      ) {
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
  travelMode: 'DRIVING' | 'WALKING',
): Promise<RouteCandidate[]> {
  const service = await getDirectionsService();
  const settled = await Promise.allSettled(
    destinations.map(async (destination) => {
      const result = await service.route({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: destination.position,
        travelMode,
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

export type EvacStatus = 'off' | 'need-mode' | 'routing' | 'routed' | 'no-route' | 'error';

export interface EvacuationState {
  enabled: boolean;
  status: EvacStatus;
  fix: LocationFix | null;
  lowAccuracy: boolean;
  /** Kept for the scene layer API; map-picking is not used in the rescue sim. */
  picking: boolean;
  mode: TransportMode | null;
  accessibilityNote: string | null;
  messages: ChatMessage[];
  chatBusy: boolean;
  moving: boolean;
  arrived: boolean;
  best: ScoredRoute | null;
  userRisk: UserRiskClass | null;
  message: string | null;
  remainingM: number | null;
  remainingS: number | null;
  /** Fire-ms per real-ms for the shared world clock (null = app default). */
  clockRate: number | null;
}

export interface EvacuationActions {
  toggle: () => void;
  sendChatMessage: (text: string) => void;
  chooseMode: (mode: TransportMode) => void;
  setChatFocus: (focused: boolean) => void;
}

const INITIAL_STATE: EvacuationState = {
  enabled: false,
  status: 'off',
  fix: null,
  lowAccuracy: false,
  picking: false,
  mode: null,
  accessibilityNote: null,
  messages: [],
  chatBusy: false,
  moving: false,
  arrived: false,
  best: null,
  userRisk: null,
  message: null,
  remainingM: null,
  remainingS: null,
  clockRate: null,
};

interface ControllerRefs {
  enabled: boolean;
  fix: LocationFix | null;
  snapshot: FireRiskSnapshot | null;
  best: ScoredRoute | null;
  mode: TransportMode | null;
  accessibilityNote: string | null;
  messages: ChatMessage[];
  routeOrigin: LatLng | null;
  lastNetworkAt: number;
  busy: boolean;
  moving: boolean;
  arrived: boolean;
  lastDest: SafeDestination | null;
  swapFromName: string | null;
  announcedNoRoute: boolean;
  lastChatAt: number;
  chatFocused: boolean;
  chatBusy: boolean;
  moveCarryM: number;
  lastWorldMs: number | null;
}

function movementMps(mode: TransportMode | null, accessibilityNote: string | null): number {
  if (mode === 'driving') return EVACUATION.movement.drivingMps;
  if (accessibilityNote) return EVACUATION.movement.limitedMps;
  return EVACUATION.movement.walkingMps;
}

export function useEvacuationController(
  snapshot: FireRiskSnapshot | null,
  worldTimeMs: number,
): { state: EvacuationState; actions: EvacuationActions } {
  const [state, setState] = useState<EvacuationState>(INITIAL_STATE);
  const refs = useRef<ControllerRefs>({
    enabled: false,
    fix: null,
    snapshot: null,
    best: null,
    mode: null,
    accessibilityNote: null,
    messages: [],
    routeOrigin: null,
    lastNetworkAt: 0,
    busy: false,
    moving: false,
    arrived: false,
    lastDest: null,
    swapFromName: null,
    announcedNoRoute: false,
    lastChatAt: 0,
    chatFocused: false,
    chatBusy: false,
    moveCarryM: 0,
    lastWorldMs: null,
  });
  refs.current.snapshot = snapshot;

  const patch = useCallback((partial: Partial<EvacuationState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const remainingFor = (fix: LocationFix | null, best: ScoredRoute | null) => {
    if (!best || !fix) return { remainingM: null, remainingS: null };
    const idx = nearestIndexOnPath(best.candidate.path, fix);
    const remainingM = pathLengthM(best.candidate.path.slice(idx));
    const remainingS = remainingM / movementMps(refs.current.mode, refs.current.accessibilityNote);
    return { remainingM, remainingS };
  };

  const pushMessage = useCallback(
    (message: ChatMessage) => {
      const r = refs.current;
      r.messages = [...r.messages.slice(-11), message];
      r.lastChatAt = Date.now();
      patch({ messages: r.messages });
    },
    [patch],
  );

  /** Compose context and let the assistant phrase a text-only reply. */
  const announce = useCallback(
    async (event: AssistantEvent, userMessage: string | null = null, previousDest?: string) => {
      const r = refs.current;
      const best = r.best;
      const remaining = remainingFor(r.fix, best);
      const ctx: AssistantContext = {
        event,
        mode: r.mode,
        accessibilityNote: r.accessibilityNote,
        userRisk: r.fix && r.snapshot ? classifyUserRisk(r.fix, r.snapshot) : null,
        destinationName: best?.candidate.destination.name ?? null,
        previousDestinationName: previousDest ?? null,
        etaMinutes: remaining.remainingS !== null ? remaining.remainingS / 60 : null,
        distanceKm: remaining.remainingM !== null ? remaining.remainingM / 1000 : null,
        routeStatus: best ? (best.status === 'safe' ? 'safe' : 'caution') : 'none',
        horizonMinutes: r.snapshot?.horizonMinutes ?? 30,
      };
      r.chatBusy = true;
      patch({ chatBusy: true });
      try {
        const text = await generateAssistantReply(ctx, r.messages, userMessage);
        pushMessage({ role: 'assistant', text });
      } finally {
        r.chatBusy = false;
        r.lastChatAt = Date.now();
        patch({ chatBusy: false });
      }
    },
    [patch, pushMessage],
  );

  const evaluate = useCallback(
    async (forceNetwork: boolean) => {
      const r = refs.current;
      if (!r.enabled || !r.fix || !r.snapshot || !r.mode) return;
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
      if (r.busy || (!forceNetwork && now - r.lastNetworkAt < EVACUATION.reroute.networkFloorMs)) {
        if (current) patch({ best: current, userRisk, ...remainingFor(fix, current) });
        return;
      }

      r.busy = true;
      if (!current) patch({ status: 'routing', userRisk, message: null });
      try {
        const destinations = viableDestinations(snap);
        const travelMode = r.mode === 'walking' ? 'WALKING' : 'DRIVING';
        const candidates =
          destinations.length > 0
            ? await computeRoadRoutes({ lat: fix.lat, lng: fix.lng }, destinations, travelMode)
            : [];
        r.lastNetworkAt = Date.now();
        r.routeOrigin = { lat: fix.lat, lng: fix.lng };
        const latestSnap = refs.current.snapshot ?? snap;
        const { best } = chooseBestRoute(candidates, latestSnap);
        const previousDest = r.lastDest;
        r.best = best;

        if (!best) {
          patch({
            best: null,
            status: 'no-route',
            userRisk,
            message: EVAC_WORDING.statusNone,
            moving: false,
            remainingM: null,
            remainingS: null,
          });
          r.moving = false;
          if (!r.announcedNoRoute) {
            r.announcedNoRoute = true;
            void announce('no-route');
          }
          return;
        }

        r.announcedNoRoute = false;
        const dest = best.candidate.destination;
        const destChanged = previousDest !== null && previousDest.id !== dest.id;
        r.lastDest = dest;
        if (!r.arrived) r.moving = true;
        patch({
          best,
          status: 'routed',
          userRisk,
          message: null,
          moving: r.moving,
          ...remainingFor(refs.current.fix ?? fix, best),
        });
        if (destChanged) {
          const fromName = r.swapFromName ?? previousDest?.name ?? null;
          r.swapFromName = null;
          void announce('dest-moved', null, fromName ?? undefined);
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
    [announce, patch],
  );

  /** Movement-only fix update (no network evaluation). */
  const moveFix = useCallback(
    (fix: LocationFix) => {
      const r = refs.current;
      r.fix = fix;
      patch({ fix, ...remainingFor(fix, r.best) });
    },
    [patch],
  );

  const handleUserText = useCallback(
    (text: string) => {
      const r = refs.current;
      const trimmed = text.trim();
      if (!trimmed || !r.enabled) return;
      pushMessage({ role: 'user', text: trimmed });

      const accessibility = parseAccessibilityNote(trimmed);
      if (accessibility && !r.accessibilityNote) {
        r.accessibilityNote = accessibility;
        patch({ accessibilityNote: accessibility });
      }

      if (!r.mode) {
        const mode = parseTransportMode(trimmed);
        if (!mode) {
          void announce('clarify-mode', trimmed);
          return;
        }
        r.mode = mode;
        patch({ mode, status: 'routing' });
        void (async () => {
          await evaluate(true);
          await announce('mode-set', trimmed);
        })();
        return;
      }
      void announce('chat', trimmed);
    },
    [announce, evaluate, patch, pushMessage],
  );

  const actions: EvacuationActions = {
    toggle: () => {
      const r = refs.current;
      if (r.enabled) {
        r.enabled = false;
        r.best = null;
        r.mode = null;
        r.accessibilityNote = null;
        r.messages = [];
        r.routeOrigin = null;
        r.moving = false;
        r.arrived = false;
        r.lastDest = null;
        r.swapFromName = null;
        r.announcedNoRoute = false;
        r.fix = null;
        r.moveCarryM = 0;
        setState({ ...INITIAL_STATE });
        return;
      }
      r.enabled = true;
      r.arrived = false;
      // One simulated person at high risk near the modeled fire edge.
      const fix = makeFix(DEMO_USER_START, 'demo', 20);
      r.fix = fix;
      patch({
        enabled: true,
        status: 'need-mode',
        fix,
        lowAccuracy: isLowAccuracy(fix),
        clockRate: EVACUATION.clock.realRate,
      });
      void announce('intro');
    },
    sendChatMessage: handleUserText,
    chooseMode: (mode) => {
      handleUserText(mode === 'driving' ? 'I have a car.' : "I'm on foot.");
    },
    setChatFocus: (focused) => {
      refs.current.chatFocused = focused;
      if (focused) refs.current.lastChatAt = Date.now();
    },
  };

  // Re-validate on every model refresh: rescore the route, and relocate the
  // safe zone when the predicted spread threatens the current destination.
  useEffect(() => {
    const r = refs.current;
    if (!r.enabled || !r.fix || !snapshot || !r.mode) return;
    if (r.best && !isDestinationViable(r.best.candidate.destination, snapshot)) {
      r.swapFromName = r.best.candidate.destination.name;
      r.best = null;
      void evaluate(true);
      return;
    }
    void evaluate(false);
  }, [snapshot, evaluate]);

  // Periodic safety net for reroute cadence.
  useEffect(() => {
    if (!state.enabled) return;
    const id = window.setInterval(() => void evaluate(false), 5000);
    return () => window.clearInterval(id);
  }, [state.enabled, evaluate]);

  // World-time movement: the person advances along the route by fire-time,
  // so chatting in real time (slow world) literally costs progress.
  useEffect(() => {
    const r = refs.current;
    const prev = r.lastWorldMs;
    r.lastWorldMs = worldTimeMs;
    if (!r.enabled || !r.moving || r.arrived || !r.best || !r.fix || prev === null) return;
    const dtFireS = (worldTimeMs - prev) / 1000;
    if (dtFireS <= 0) return;
    r.moveCarryM += Math.min(dtFireS, 120) * movementMps(r.mode, r.accessibilityNote);
    if (r.moveCarryM < 25) return;
    const stepM = Math.min(r.moveCarryM, 1500);
    r.moveCarryM = 0;
    const path = r.best.candidate.path;
    const idx = nearestIndexOnPath(path, r.fix);
    const step = advanceAlongPath(path, idx, stepM);
    moveFix(makeFix(step.point, 'demo', 12, step.headingDeg));
    if (step.atEnd) {
      r.moving = false;
      r.arrived = true;
      patch({ moving: false, arrived: true });
      void announce('arrived');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTimeMs]);

  // Shared world-clock rate: real time while the person is replying,
  // fast-forward (1 fire-minute per real second) otherwise.
  useEffect(() => {
    if (!state.enabled) return;
    const compute = () => {
      const r = refs.current;
      const chatting =
        r.mode === null ||
        r.chatFocused ||
        r.chatBusy ||
        Date.now() - r.lastChatAt < EVACUATION.clock.chatGraceMs;
      const rate = chatting ? EVACUATION.clock.realRate : EVACUATION.clock.fastRate;
      setState((s) => (s.clockRate === rate ? s : { ...s, clockRate: rate }));
    };
    compute();
    const id = window.setInterval(compute, 1000);
    return () => window.clearInterval(id);
  }, [state.enabled]);

  return { state, actions };
}
