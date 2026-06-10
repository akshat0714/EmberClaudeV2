import { DISCLAIMER, KENNETH_FIRE, KENNETH_WEATHER, MODE_LABEL } from '../data/kennethFacts';
import { SPREAD_STAGES } from '../data/kennethReconstruction';
import { INTENSITY_STYLE, WORDING } from '../data/spreadModelConfig';
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

function formatIntensity(kwm: number): string {
  return kwm >= 1000 ? `${(kwm / 1000).toFixed(1)} MW/m` : `${Math.round(kwm)} kW/m`;
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

      {model.predictionActive && model.byram && (
        <section>
          <h3>Fire behavior (modeled)</h3>
          <dl className="facts">
            <div>
              <dt>Head rate of spread</dt>
              <dd>{model.headRateMpm.toFixed(0)} m/min</dd>
            </div>
            <div>
              <dt>Fireline intensity</dt>
              <dd>{formatIntensity(model.byram.intensityKwm)}</dd>
            </div>
            <div>
              <dt>Flame length</dt>
              <dd>≈{model.byram.flameLengthM.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>Active sub-fires</dt>
              <dd>
                {model.hotspotCount} heads{model.spotCount > 0 ? ` + ${model.spotCount} ember spots` : ''}
              </dd>
            </div>
          </dl>
          <p className="section-caption">
            Byram (1959): I = H·w·R; flame length 0.0775·I^0.46. Above ~
            {formatIntensity(INTENSITY_STYLE.legendKwm[0])} control efforts generally fail
            (crowning/spotting class).
          </p>
        </section>
      )}

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
            <span className="swatch swatch-intensity" />
            <span>
              Fire intensity — darkest red = peak combustion just behind the front, fading as
              fuels burn out
            </span>
          </li>
          <li>
            <span className="swatch swatch-front" />
            <span>Current active front</span>
          </li>
          <li>
            <span className="swatch swatch-hotspot" />
            <span>Active sub-fires (10–20 heads) · ember spot fires downwind</span>
          </li>
          <li>
            <span className="swatch swatch-zone-pred" />
            <span>{WORDING.zoneLabel(model.horizonMinutes)} — merged envelope</span>
          </li>
          <li>
            <span className="swatch swatch-tree" />
            <span>Per-sub-fire prediction trees (likely spread routes, branching)</span>
          </li>
          <li>
            <span className="swatch swatch-wind" aria-hidden="true">
              →
            </span>
            <span>Wind direction ({KENNETH_WEATHER.summary})</span>
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
            <dt>Weather</dt>
            <dd>{KENNETH_WEATHER.summary}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{MODE_LABEL}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>Data</h3>
        <p className="section-caption">
          Elevation: {model.realDem ? 'USGS 3DEP (real DEM)' : 'analytic fallback'} · Streets &
          development: {model.realStreets ? 'OpenStreetMap (real)' : 'analytic fallback'}
        </p>
        <p className="section-caption">
          © OpenStreetMap contributors (ODbL) · 3DEP data courtesy of the U.S. Geological Survey
        </p>
      </section>

      <p className="panel-disclaimer">{DISCLAIMER}</p>
    </aside>
  );
}
