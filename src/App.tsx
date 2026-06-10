import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import EvacuationMode from './components/EvacuationMode';
import FireScene, { type EvacuationView } from './components/FireScene';
import InfoPanel, { type StructureStatus } from './components/InfoPanel';
import TimelineControls, { type TimelineStage } from './components/TimelineControls';
import { useEvacuationController } from './lib/evacuationRouting';
import type { FireRiskSnapshot } from './lib/fireRiskGeometry';
import type { ModelSummary } from './lib/spreadDrivers';
import {
  APP_SUBTITLE,
  APP_TAGLINE,
  APP_TITLE,
  DISCLAIMER,
} from './data/kennethFacts';
import { SPREAD_STAGES, STRUCTURE_EDGES } from './data/kennethReconstruction';
import { PREDICTION_ZONE } from './data/spreadModelConfig';
import {
  interpolateRings,
  prepareTransition,
  ringAreaAcres,
} from './lib/interpolatePolygon';
import { clamp, countAtOrBefore, smoothstep01 } from './lib/timeUtils';

/** At 1x the full reconstruction timeline plays in about this long. */
const DEMO_DURATION_MS = 60_000;

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

  return { time, playing, speed, toggle, replay, seek, changeSpeed };
}

export default function App() {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
  const keyValid = apiKey !== '' && apiKey !== 'your_google_maps_key_here';

  if (!keyValid) return <KeyScreen />;
  return <ReconstructionApp apiKey={apiKey} />;
}

function ReconstructionApp({ apiKey }: { apiKey: string }) {
  const stageTimes = useMemo(() => SPREAD_STAGES.map((s) => Date.parse(s.timeIso)), []);
  const startTime = stageTimes[0];
  const endTime = stageTimes[stageTimes.length - 1];
  const clock = useAnimationClock(startTime, endTime);
  const [model, setModel] = useState<ModelSummary>({
    drivers: null,
    predictionActive: true,
    horizonMinutes: PREDICTION_ZONE.primaryMinutes,
  });
  const [risk, setRisk] = useState<FireRiskSnapshot | null>(null);
  const evacuation = useEvacuationController(risk);

  const evacuationView: EvacuationView = {
    active: evacuation.state.enabled,
    fix: evacuation.state.fix,
    picking: evacuation.state.picking,
    routePath: evacuation.state.best?.candidate.path ?? null,
    destination: evacuation.state.best?.candidate.destination ?? null,
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

  return (
    <div className="app-root">
      <FireScene
        apiKey={apiKey}
        time={clock.time}
        onModelUpdate={setModel}
        onRiskSnapshot={setRisk}
        evacuation={evacuationView}
        onMapPick={evacuation.actions.setManualFix}
      />
      <div className="edge-fade" aria-hidden="true" />

      <header className="title-block">
        <h1>{APP_TITLE}</h1>
        <p className="subtitle">{APP_SUBTITLE}</p>
        <p className="tagline">{APP_TAGLINE}</p>
      </header>

      <EvacuationMode state={evacuation.state} actions={evacuation.actions} />

      <InfoPanel
        time={clock.time}
        stageIndex={stageIndex}
        percentOfFinal={percentOfFinal}
        structures={structures}
        model={model}
      />

      <TimelineControls
        playing={clock.playing}
        speed={clock.speed}
        time={clock.time}
        startTime={startTime}
        endTime={endTime}
        stages={timelineStages}
        currentStageIndex={stageIndex}
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
        This reconstruction renders Google photorealistic 3D terrain and buildings, which needs an
        API key:
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
