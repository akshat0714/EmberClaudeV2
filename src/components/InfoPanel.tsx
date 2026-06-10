import { DISCLAIMER, KENNETH_FIRE, MODE_LABEL } from '../data/kennethFacts';
import { SPREAD_STAGES } from '../data/kennethReconstruction';
import { formatPacificDate, formatPacificTime, formatUtc } from '../lib/timeUtils';

export interface StructureStatus {
  name: string;
  active: boolean;
  sinceLabel: string;
}

interface InfoPanelProps {
  time: number;
  /** Index of the latest stage reached (0-based). */
  stageIndex: number;
  /** Approximate share of the final footprint area currently covered, 1..100. */
  percentOfFinal: number;
  structures: StructureStatus[];
}

export default function InfoPanel({
  time,
  stageIndex,
  percentOfFinal,
  structures,
}: InfoPanelProps) {
  const stage = SPREAD_STAGES[stageIndex];

  return (
    <aside className="info-panel glass">
      <section>
        <h3>Current time</h3>
        <p className="value-lg">{formatPacificTime(time)}</p>
        <p className="value-sub">
          {formatPacificDate(time)} · {formatUtc(time)}
        </p>
      </section>

      <section>
        <h3>Spread stage</h3>
        <p className="value-md stage-name">
          <span className="stage-dot" style={{ background: stage.strokeColor }} />
          Stage {stageIndex + 1} of {SPREAD_STAGES.length} — {stage.name}
        </p>
        <p className="stage-desc">{stage.description}</p>
        <div className="progress-track" role="img" aria-label={`About ${percentOfFinal}% of the final footprint area`}>
          <div className="progress-fill" style={{ width: `${percentOfFinal}%` }} />
        </div>
        <p className="value-sub">≈{percentOfFinal}% of final footprint area (reconstructed)</p>
      </section>

      <hr />

      <section>
        <h3>Official incident facts</h3>
        <dl className="facts">
          <div>
            <dt>Final size</dt>
            <dd>{KENNETH_FIRE.finalAcres.toLocaleString('en-US')} acres</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{KENNETH_FIRE.startLabel}</dd>
          </div>
          <div>
            <dt>Contained</dt>
            <dd>{KENNETH_FIRE.containedLabel}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{KENNETH_FIRE.location}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{MODE_LABEL}</dd>
          </div>
        </dl>
      </section>

      <hr />

      <section>
        <h3>Developed edges</h3>
        <ul className="structure-list">
          {structures.map((s) => (
            <li key={s.name}>
              <span className={s.active ? 'struct-dot active' : 'struct-dot'} />
              <span>
                {s.name}
                <em>{s.active ? `at spread boundary since ${s.sinceLabel}` : 'not yet reached'}</em>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <hr />

      <section>
        <h3>Legend</h3>
        <ul className="legend">
          {SPREAD_STAGES.map((s) => (
            <li key={s.id}>
              <span
                className="swatch swatch-zone"
                style={{ background: s.fillColor, borderColor: s.strokeColor }}
              />
              <span>
                {s.name} · {s.timeLabel}
              </span>
            </li>
          ))}
          <li>
            <span className="swatch swatch-front" />
            <span>Active spread front (current time)</span>
          </li>
          <li>
            <span className="swatch swatch-structure" />
            <span>Developed edge adjacent to spread zone</span>
          </li>
        </ul>
      </section>

      <p className="panel-disclaimer">{DISCLAIMER}</p>
    </aside>
  );
}
