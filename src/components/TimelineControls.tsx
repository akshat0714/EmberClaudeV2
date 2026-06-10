import type { CSSProperties } from 'react';
import { DISCLAIMER_LONG } from '../data/kennethFacts';
import { formatPacific, formatUtc } from '../lib/timeUtils';

const SPEEDS = [1, 5, 20];

interface TimelineControlsProps {
  playing: boolean;
  speed: number;
  time: number;
  startTime: number;
  endTime: number;
  /** Distinct real detection timestamps, drawn as ticks on the scrubber. */
  overpassTimes: number[];
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeedChange: (multiplier: number) => void;
}

export default function TimelineControls({
  playing,
  speed,
  time,
  startTime,
  endTime,
  overpassTimes,
  onToggle,
  onSeek,
  onSpeedChange,
}: TimelineControlsProps) {
  const span = Math.max(endTime - startTime, 1);
  const progress = (time - startTime) / span;
  const pct = `${(progress * 100).toFixed(2)}%`;

  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, rgba(255, 140, 46, 0.95) ${pct}, rgba(255, 255, 255, 0.14) ${pct})`,
  };

  return (
    <div className="controls-wrap">
      <div className="controls glass">
        <button
          className="play-btn"
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>

        <div className="scrubber">
          <div className="ticks" aria-hidden="true">
            {overpassTimes.map((t) => (
              <span key={t} style={{ left: `${(((t - startTime) / span) * 100).toFixed(2)}%` }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            style={trackStyle}
            onChange={(e) => onSeek(startTime + (Number(e.target.value) / 1000) * span)}
            aria-label="Timeline scrubber"
          />
        </div>

        <div className="speed-group" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={s === speed ? 'speed-btn active' : 'speed-btn'}
              onClick={() => onSpeedChange(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="timestamp">
          <span className="timestamp-main">{formatPacific(time)}</span>
          <span className="timestamp-sub">{formatUtc(time)}</span>
        </div>
      </div>
      <p className="footer-disclaimer">{DISCLAIMER_LONG}</p>
    </div>
  );
}
