import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import InfoPanel from './components/InfoPanel';
import MapView from './components/MapView';
import TimelineControls from './components/TimelineControls';
import { DISCLAIMER_LONG, DISCLAIMER_SHORT, KENNETH_FIRE } from './data/kennethFacts';
import {
  FILTER_RADIUS_KM,
  loadFirmsFromUrl,
  parseFirmsCsv,
  type FireDetection,
  type FirmsLoadResult,
} from './lib/loadFirmsCsv';
import { clamp, countAtOrBefore } from './lib/timeUtils';

/** At 1x the full detection timeline plays in about this long. */
const DEMO_DURATION_MS = 90_000;

/**
 * requestAnimationFrame clock over the real detection time range.
 * Every frame advances `time` (fire time, UTC ms) by the elapsed wall-clock
 * delta scaled so the whole timeline lasts ~90 s at 1x. Pauses at the end;
 * pressing play again restarts from the first detection.
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

  const seek = (t: number) => {
    const v = clamp(t, startTime, endTime);
    stateRef.current.time = v;
    setTime(v);
  };

  const changeSpeed = (multiplier: number) => {
    stateRef.current.speed = multiplier;
    setSpeed(multiplier);
  };

  return { time, playing, speed, toggle, seek, changeSpeed };
}

type DataState =
  | { status: 'loading' }
  | { status: 'missing'; note?: string }
  | { status: 'ready'; result: FirmsLoadResult };

export default function App() {
  const token = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
  const tokenValid = token !== '' && token !== 'your_token_here';

  const [dataState, setDataState] = useState<DataState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadFirmsFromUrl(`${import.meta.env.BASE_URL}data/kenneth_firms.csv`);
        if (cancelled) return;
        if (!result) {
          setDataState({ status: 'missing' });
        } else if (result.detections.length === 0) {
          setDataState({
            status: 'missing',
            note: `Found ${result.totalRows} rows in public/data/kenneth_firms.csv, but none within ${FILTER_RADIUS_KM} km of the Kenneth Fire ignition point. Check the area and date range of your FIRMS download.`,
          });
        } else {
          setDataState({ status: 'ready', result });
        }
      } catch (error) {
        if (!cancelled) {
          setDataState({
            status: 'missing',
            note: error instanceof Error ? error.message : 'The CSV file could not be parsed.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tokenValid) return <TokenScreen />;
  if (dataState.status === 'loading') return <LoadingScreen />;
  if (dataState.status === 'missing') {
    return (
      <DataScreen
        note={dataState.note}
        onLoaded={(result) => setDataState({ status: 'ready', result })}
      />
    );
  }
  return <TimelineApp token={token} detections={dataState.result.detections} />;
}

function TimelineApp({ token, detections }: { token: string; detections: FireDetection[] }) {
  const timestamps = useMemo(() => detections.map((d) => d.timestamp), [detections]);
  const startTime = timestamps[0];
  const endTime = timestamps[timestamps.length - 1];
  const clock = useAnimationClock(startTime, endTime);

  const overpassTimes = useMemo(() => Array.from(new Set(timestamps)), [timestamps]);
  const visibleCount = countAtOrBefore(timestamps, clock.time);
  const latest = visibleCount > 0 ? detections[visibleCount - 1] : null;

  return (
    <div className="app-root">
      <MapView token={token} detections={detections} currentTime={clock.time} />
      <div className="vignette" aria-hidden="true" />

      <header className="title-block">
        <h1>{KENNETH_FIRE.name}</h1>
        <p className="subtitle">3D satellite-detection timeline</p>
        <p className="title-disclaimer">{DISCLAIMER_SHORT}</p>
      </header>

      <InfoPanel
        time={clock.time}
        visibleCount={visibleCount}
        totalCount={detections.length}
        latestSatellite={latest?.satelliteLabel ?? null}
      />

      <TimelineControls
        playing={clock.playing}
        speed={clock.speed}
        time={clock.time}
        startTime={startTime}
        endTime={endTime}
        overpassTimes={overpassTimes}
        onToggle={clock.toggle}
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
        <p className="screen-kicker">Kenneth Fire · 3D Timeline</p>
        {children}
        <p className="screen-footnote">{DISCLAIMER_LONG}</p>
      </div>
    </div>
  );
}

function TokenScreen() {
  return (
    <FallbackShell>
      <h1>Mapbox token required</h1>
      <p>
        This visualization renders a 3D Mapbox map and needs an access token. Create a free token
        at{' '}
        <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer">
          account.mapbox.com
        </a>
        , then create a <code>.env</code> file in the project root:
      </p>
      <pre>{'VITE_MAPBOX_TOKEN=your_token_here'}</pre>
      <p>
        (See <code>.env.example</code>.) Restart <code>npm run dev</code> after saving.
      </p>
    </FallbackShell>
  );
}

function LoadingScreen() {
  return (
    <FallbackShell>
      <div className="spinner" aria-hidden="true" />
      <h1>Loading detection data…</h1>
    </FallbackShell>
  );
}

function DataScreen({
  note,
  onLoaded,
}: {
  note?: string;
  onLoaded: (result: FirmsLoadResult) => void;
}) {
  const [error, setError] = useState<string | null>(note ?? null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const result = parseFirmsCsv(await file.text());
      if (result.detections.length === 0) {
        setError(
          `Parsed ${result.totalRows} rows, but none within ${FILTER_RADIUS_KM} km of the Kenneth Fire ignition point — check the area and date range of the download.`,
        );
        return;
      }
      onLoaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be parsed as a FIRMS CSV.');
    }
  };

  return (
    <FallbackShell>
      <h1>Fire detection data needed</h1>
      <p>
        Download NASA FIRMS archive CSV for <strong>Jan 9–12, 2025</strong> around West Hills /
        Calabasas and place it at <code>public/data/kenneth_firms.csv</code>.
      </p>
      <ol>
        <li>
          Open the{' '}
          <a href="https://firms.modaps.eosdis.nasa.gov/download/" target="_blank" rel="noreferrer">
            NASA FIRMS archive download
          </a>{' '}
          page and request VIIRS data as CSV for Jan 9–13, 2025 (UTC) over the West Hills /
          Calabasas area.
        </li>
        <li>
          Save the extracted file as <code>public/data/kenneth_firms.csv</code>.
        </li>
        <li>Reload this page.</li>
      </ol>
      <div
        className={dragging ? 'dropzone dragging' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        …or drop / choose the FIRMS CSV here to view it right away
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      <p className="screen-hint">
        Files opened this way aren’t saved — for a permanent setup, place the CSV at{' '}
        <code>public/data/kenneth_firms.csv</code>.
      </p>
      {error && <p className="screen-error">{error}</p>}
    </FallbackShell>
  );
}
