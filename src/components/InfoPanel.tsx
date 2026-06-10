import { ENVELOPE_LABEL, KENNETH_FIRE } from '../data/kennethFacts';
import { formatPacificDate, formatPacificTime, formatUtc } from '../lib/timeUtils';

interface InfoPanelProps {
  time: number;
  visibleCount: number;
  totalCount: number;
  latestSatellite: string | null;
}

export default function InfoPanel({
  time,
  visibleCount,
  totalCount,
  latestSatellite,
}: InfoPanelProps) {
  return (
    <aside className="info-panel glass">
      <section>
        <h3>Animation time</h3>
        <p className="value-lg">{formatPacificTime(time)}</p>
        <p className="value-sub">
          {formatPacificDate(time)} · {formatUtc(time)}
        </p>
      </section>

      <div className="panel-grid">
        <section>
          <h3>Visible detections</h3>
          <p className="value-lg">
            {visibleCount}
            <span className="value-dim"> / {totalCount}</span>
          </p>
        </section>
        <section>
          <h3>Latest satellite</h3>
          <p className="value-md">{latestSatellite ?? '—'}</p>
        </section>
      </div>

      <hr />

      <section>
        <h3>Official incident facts</h3>
        <dl className="facts">
          <div>
            <dt>Final official size</dt>
            <dd>{KENNETH_FIRE.finalAcres.toLocaleString('en-US')} acres</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Contained · {KENNETH_FIRE.containedLabel}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{KENNETH_FIRE.startLabel}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{KENNETH_FIRE.location}</dd>
          </div>
        </dl>
      </section>

      <hr />

      <section>
        <h3>Legend</h3>
        <ul className="legend">
          <li>
            <span className="swatch swatch-dot" />
            <span>Satellite fire detection — size = FRP, opacity = confidence</span>
          </li>
          <li>
            <span className="swatch swatch-envelope" />
            <span>{ENVELOPE_LABEL}</span>
          </li>
          <li>
            <span className="swatch swatch-ring" />
            <span>Reported start area</span>
          </li>
        </ul>
      </section>
    </aside>
  );
}
