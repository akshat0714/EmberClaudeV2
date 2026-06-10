import type { CSSProperties } from 'react';
import { formatPacific } from '../lib/timeUtils';

const SPEEDS = [1, 5, 20];

export interface TimelineStage {
  name: string;
  timeLabel: string;
  timeMs: number;
}

interface TimelineControlsProps {
  playing: boolean;
  speed: number;
  time: number;
  startTime: number;
  endTime: number;
  stages: TimelineStage[];
  currentStageIndex: number;
  onToggle: () => void;
  onReplay: () => void;
  onSeek: (t: number) => void;
  onSpeedChange: (multiplier: number) => void;
}

export default function TimelineControls({
  playing,
  speed,
  time,
  startTime,
  endTime,
  stages,
  currentStageIndex,
  onToggle,
  onReplay,
  onSeek,
  onSpeedChange,
}: TimelineControlsProps) {
  const span = Math.max(endTime - startTime, 1);
  const progress = (time - startTime) / span;
  const pct = `${(progress * 100).toFixed(2)}%`;
  const stage = stages[currentStageIndex];

  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, rgba(255, 140, 46, 0.95) ${pct}, rgba(255, 255, 255, 0.22) ${pct})`,
  };

  const positionPct = (t: number) => `${(((t - startTime) / span) * 100).toFixed(2)}%`;

  return (
    <div className="controls-wrap">
      <div className="controls glass">
        <div className="transport">
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
          <button className="replay-btn" onClick={onReplay} aria-label="Replay" title="Replay from ignition">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5V2L7 6l5 4V7a5.5 5.5 0 1 1-5.42 6.6l-1.96.4A7.5 7.5 0 1 0 12 5z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div className="interval-chip">
          <span className="interval-stage">
            Stage {currentStageIndex + 1} of {stages.length} · {stage.name}
          </span>
          <span className="interval-time">{stage.timeLabel}</span>
        </div>

        <div className="scrubber">
          <div className="stage-markers" aria-hidden="true">
            {stages.map((s, i) => (
              <span
                key={s.name}
                className={i <= currentStageIndex ? 'stage-tick reached' : 'stage-tick'}
                style={{ left: positionPct(s.timeMs) }}
              />
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
          <div className="stage-labels">
            {stages.map((s, i) => (
              <button
                key={s.name}
                className={i === currentStageIndex ? 'stage-label current' : 'stage-label'}
                style={{ left: positionPct(s.timeMs) }}
                onClick={() => onSeek(s.timeMs)}
                title={`${s.name} — jump to ${s.timeLabel}`}
              >
                {s.timeLabel}
              </button>
            ))}
          </div>
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
        </div>
      </div>
    </div>
  );
}
