import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import FireScene, { type NavOverlay } from './components/FireScene';
import InfoPanel, { type StructureStatus } from './components/InfoPanel';
import NavigationPanel from './components/NavigationPanel';
import TimelineControls, {
  type SpeedPreset,
  type TimelineStage,
} from './components/TimelineControls';
import type { ModelSummary } from './lib/spreadDrivers';
import { APP_SUBTITLE, APP_TAGLINE, APP_TITLE, DISCLAIMER } from './data/kennethFacts';
import { SPREAD_STAGES, STRUCTURE_EDGES } from './data/kennethReconstruction';
import { PREDICTION_ZONE } from './data/spreadModelConfig';
import { initTerrain } from './lib/arrivalTimeModel';
import {
  interpolateRings,
  prepareTransition,
  ringAreaAcres,
} from './lib/interpolatePolygon';
import { clamp, countAtOrBefore, smoothstep01 } from './lib/timeUtils';
import { remainingPath } from './lib/turnByTurn';
import { useNavigation } from './lib/useNavigation';

/** At 1x the full reconstruction timeline plays in about this long. */
const DEMO_DURATION_MS = 60_000;

type AppMode = 'timeline' | 'evacuate';

/**
 * requestAnimationFrame clock over the reconstruction time range. Pauses at
 * the end; Play at the end (or Replay) restarts from ignition.
 */
function useAnimationClock(startTime: number, endTime: number) {
  const [time, setTime] = useState(startTime);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const stateRef = useRef({ time: startTime, playing: true, speed: 1 });

  useEffect(() => {
    const span = Math.max(endTime - startTime, 1);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = stateRef.current;
      const dt = now - last;
      last = now;
      if (s.playing) {
        s.time = Math.min(endTime, s.time + dt * (span / DEMO_DURATION_MS) * s.speed);
        if (s.time >= endTime) {
          s.playing = false;
          setPlaying(false);
        }
        setTime(s.time);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startTime, endTime]);

  const toggle = () => {
    const s = stateRef.current;
    if (!s.playing && s.time >= endTime) {
      s.time = startTime;
      setTime(startTime);
    }
    s.playing = !s.playing;
    setPlaying(s.playing);
  };

  const replay = () => {
    const s = stateRef.current;
    s.time = startTime;
    s.playing = true;
    setTime(startTime);
    setPlaying(true);
  };

  const seek = (t: number) => {
    const v = clamp(t, startTime, endTime);
    stateRef.current.time = v;
    setTime(v);
  };

  const changeSpeed = (multiplier: number) => {
    stateRef.current.speed = multiplier;
    setSpeed(multiplier);
  };

  const play = () => {
    stateRef.current.playing = true;
    setPlaying(true);
  };

  return { time, playing, speed, toggle, replay, seek, changeSpeed, play };
}

export default function App() {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
  const keyValid = apiKey !== '' && apiKey !== 'your_google_maps_key_here';
  const [terrain, setTerrain] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Real data first: USGS DEM + OSM street graph load before the model runs,
  // so the terrain grid is built from them (analytic fallback otherwise).
  useEffect(() => {
    if (!keyValid) return;
    let cancelled = false;
    initTerrain()
      .then(() => !cancelled && setTerrain('ready'))
      .catch(() => !cancelled && setTerrain('ready')); // fallbacks still work
    return () => {
      cancelled = true;
    };
  }, [keyValid]);

  if (!keyValid) return <KeyScreen />;
  if (terrain === 'loading') {
    return (
      <FallbackShell>
        <div className="spinner" aria-hidden="true" />
        <p>Loading real terrain (USGS 3DEP) and street network (OpenStreetMap)…</p>
      </FallbackShell>
    );
  }
  return <EmberApp apiKey={apiKey} />;
}

function EmberApp({ apiKey }: { apiKey: string }) {
  const stageTimes = useMemo(() => SPREAD_STAGES.map((s) => Date.parse(s.timeIso)), []);
  const startTime = stageTimes[0];
  const endTime = stageTimes[stageTimes.length - 1];
  const clock = useAnimationClock(startTime, endTime);
  const [mode, setMode] = useState<AppMode>('timeline');
  const [follow, setFollow] = useState(false);
  const [model, setModel] = useState<ModelSummary>({
    drivers: null,
    predictionActive: true,
    horizonMinutes: PREDICTION_ZONE.primaryMinutes,
    headRateMpm: 0,
    byram: null,
    hotspotCount: 0,
    spotCount: 0,
    realDem: false,
    realStreets: false,
  });

  const { state: nav, actions: navActions } = useNavigation(clock.time, mode === 'evacuate');

  /** Demo-multiplier that advances the sim clock at ×R real time. */
  const realtimeMultiplier = (r: number) =>
    (r * DEMO_DURATION_MS) / Math.max(endTime - startTime, 1);

  const speedPresets: SpeedPreset[] = useMemo(
    () =>
      mode === 'timeline'
        ? [
            { label: '1x', multiplier: 1 },
            { label: '5x', multiplier: 5 },
            { label: '20x', multiplier: 20 },
          ]
        : [
            { label: '×1 real', multiplier: realtimeMultiplier(1) },
            { label: '×20', multiplier: realtimeMultiplier(20) },
            { label: '×60', multiplier: realtimeMultiplier(60) },
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, startTime, endTime],
  );

  const enterMode = (next: AppMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === 'evacuate') {
      // live simulation pacing: fire advances at ×20 real time by default
      clock.changeSpeed(realtimeMultiplier(20));
      clock.play();
      setFollow(false);
    } else {
      navActions.stop();
      clock.changeSpeed(1);
    }
  };

  const timelineStages = useMemo<TimelineStage[]>(
    () =>
      SPREAD_STAGES.map((s, i) => ({
        name: s.name,
        timeLabel: s.timeLabel,
        timeMs: stageTimes[i],
      })),
    [stageTimes],
  );

  // Same interpolation as the scene, used to derive the "% of final
  // footprint" readout (coarser ring is plenty for an area estimate).
  const transitions = useMemo(
    () =>
      SPREAD_STAGES.slice(0, -1).map((stage, j) =>
        prepareTransition(stage.ring, SPREAD_STAGES[j + 1].ring, 64),
      ),
    [],
  );
  const finalAcres = useMemo(() => ringAreaAcres(SPREAD_STAGES[SPREAD_STAGES.length - 1].ring), []);

  const stageIndex = Math.max(0, countAtOrBefore(stageTimes, clock.time) - 1);
  const interval = Math.min(stageIndex, SPREAD_STAGES.length - 2);
  const span = Math.max(stageTimes[interval + 1] - stageTimes[interval], 1);
  const p =
    clock.time >= endTime
      ? 1
      : clamp(smoothstep01((clock.time - stageTimes[interval]) / span), 0, 1);
  const currentAcres = ringAreaAcres(interpolateRings(transitions[interval], p));
  const percentOfFinal = clamp(Math.round((currentAcres / finalAcres) * 100), 1, 100);

  const structures: StructureStatus[] = STRUCTURE_EDGES.map((edge) => ({
    name: edge.name,
    active: stageIndex >= edge.activeFromStage,
    sinceLabel: SPREAD_STAGES[edge.activeFromStage].timeLabel,
  }));

  const navOverlay: NavOverlay = useMemo(() => {
    const routePath =
      nav.track && nav.progress
        ? remainingPath(nav.track, nav.progress.alongM)
        : (nav.track?.path ?? null);
    return {
      active: mode === 'evacuate',
      user: nav.user,
      routePath: nav.phase === 'navigating' ? routePath : null,
      routeDegraded: nav.degraded,
      destinationId: nav.route?.target.id ?? null,
      placing: mode === 'evacuate' && nav.phase !== 'navigating' && nav.phase !== 'arrived',
      follow: follow && nav.phase === 'navigating',
    };
  }, [mode, nav, follow]);

  return (
    <div className="app-root">
      <FireScene
        apiKey={apiKey}
        time={clock.time}
        onModelUpdate={setModel}
        nav={navOverlay}
        onMapClick={(point) => {
          if (mode === 'evacuate' && nav.phase !== 'navigating' && nav.phase !== 'arrived') {
            navActions.placeUser(point);
          }
        }}
      />
      <div className="edge-fade" aria-hidden="true" />

      <header className="title-block">
        <h1>{APP_TITLE}</h1>
        <p className="subtitle">{APP_SUBTITLE}</p>
        <p className="tagline">{APP_TAGLINE}</p>
        <div className="mode-switch" role="group" aria-label="App mode">
          <button
            className={mode === 'timeline' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => enterMode('timeline')}
          >
            Fire timeline
          </button>
          <button
            className={mode === 'evacuate' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => enterMode('evacuate')}
          >
            Evacuation demo
          </button>
        </div>
      </header>

      {mode === 'timeline' ? (
        <InfoPanel
          time={clock.time}
          stageIndex={stageIndex}
          percentOfFinal={percentOfFinal}
          structures={structures}
          model={model}
        />
      ) : (
        <NavigationPanel
          nav={nav}
          actions={navActions}
          simTime={clock.time}
          follow={follow}
          onFollowChange={setFollow}
        />
      )}

      <TimelineControls
        playing={clock.playing}
        speed={clock.speed}
        time={clock.time}
        startTime={startTime}
        endTime={endTime}
        stages={timelineStages}
        currentStageIndex={stageIndex}
        speedPresets={speedPresets}
        onToggle={clock.toggle}
        onReplay={clock.replay}
        onSeek={clock.seek}
        onSpeedChange={clock.changeSpeed}
      />
    </div>
  );
}

function FallbackShell({ children }: { children: ReactNode }) {
  return (
    <div className="screen">
      <div className="screen-card glass">
        <p className="screen-kicker">
          {APP_TITLE} · {APP_SUBTITLE}
        </p>
        {children}
        <p className="screen-footnote">{DISCLAIMER}</p>
      </div>
    </div>
  );
}

function KeyScreen() {
  return (
    <FallbackShell>
      <h1>Google Maps API key required</h1>
      <p>
        This app renders Google photorealistic 3D terrain and buildings, which needs an API key:
      </p>
      <ol>
        <li>
          In the{' '}
          <a href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noreferrer">
            Google Cloud console
          </a>
          , create an API key (billing must be enabled on the project).
        </li>
        <li>
          Enable the <strong>Maps JavaScript API</strong> and the <strong>Map Tiles API</strong>{' '}
          for that project.
        </li>
        <li>
          Create a <code>.env</code> file in the project root (see <code>.env.example</code>):
        </li>
      </ol>
      <pre>{'VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here'}</pre>
      <p>
        Restart <code>npm run dev</code> after saving.
      </p>
    </FallbackShell>
  );
}
