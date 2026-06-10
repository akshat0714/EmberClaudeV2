import { DISCLAIMER, KENNETH_FIRE, MODE_LABEL } from '../data/kennethFacts';
import { SPREAD_STAGES } from '../data/kennethReconstruction';
import { WORDING } from '../data/spreadModelConfig';
import type { DriverLevel, ModelSummary } from '../lib/spreadDrivers';
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
  model: ModelSummary;
}

function DriverRow({ label, level }: { label: string; level: DriverLevel }) {
  const filled = level === 'High' ? 3 : level === 'Medium' ? 2 : 1;
  return (
    <li className="driver-row">
      <span className="driver-label">{label}</span>
      <span className={`driver-meter level-${level.toLowerCase()}`} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < filled ? 'seg on' : 'seg'} />
        ))}
      </span>
      <span className="driver-level">{level}</span>
    </li>
  );
}

export default function InfoPanel({
  time,
  stageIndex,
  percentOfFinal,
  structures,
  model,
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
        <div
          className="progress-track"
          role="img"
          aria-label={`About ${percentOfFinal}% of the final footprint area`}
        >
          <div className="progress-fill" style={{ width: `${percentOfFinal}%` }} />
        </div>
        <p className="value-sub">≈{percentOfFinal}% of final footprint area (reconstructed)</p>
      </section>

      {model.drivers && (
        <section>
          <h3>Spread drivers</h3>
          <ul className="driver-list">
            <DriverRow label="Wind" level={model.drivers.windAlignment} />
            <DriverRow label="Slope" level={model.drivers.slopeEffect} />
            <DriverRow label="Fuel" level={model.drivers.fuelVegetation} />
            <DriverRow label="Canyon channeling" level={model.drivers.canyonChanneling} />
            <DriverRow label="Structure-edge resistance" level={model.drivers.structureAdjacency} />
          </ul>
          <p className="section-caption">{WORDING.model}</p>
          {!model.predictionActive && <p className="paused-note">{WORDING.modelPaused}</p>}
        </section>
      )}

      <hr />

      <section>
        <h3>Legend</h3>
        <ul className="legend">
          <li>
            <span className="swatch swatch-burned" />
            <span>Burned — already covered by fire (darker = older)</span>
          </li>
          <li>
            <span className="swatch swatch-history" />
            <span>Past spread contours</span>
          </li>
          <li>
            <span className="swatch swatch-front" />
            <span>Current active front</span>
          </li>
          <li>
            <span className="swatch swatch-zone-pred" />
            <span>{WORDING.zoneLabel(model.horizonMinutes)}</span>
          </li>
          <li>
            <span className="swatch swatch-pathway" />
            <span>Likely advancing pathways (wind · slope · canyon)</span>
          </li>
          <li>
            <span className="swatch swatch-wind" aria-hidden="true">
              →
            </span>
            <span>Wind direction</span>
          </li>
          <li>
            <span className="swatch swatch-structure" />
            <span>Structure-edge resistance — no building damage implied</span>
          </li>
        </ul>
        <p className="section-caption">{WORDING.zoneBasis(model.horizonMinutes)}</p>
        <p className="section-caption">{WORDING.potential}</p>
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

      <p className="panel-disclaimer">{DISCLAIMER}</p>
    </aside>
  );
}
