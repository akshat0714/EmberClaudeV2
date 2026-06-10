/**
 * Evacuation guidance panel: setup (position source, travel mode, start),
 * then live Google-Maps-style turn-by-turn — big next-maneuver card with the
 * real street name, ETA, remaining distance, and the safety readout that
 * makes this fire-aware: how far ahead of the predicted fire the route stays.
 */
import { DEMO_START_POINTS, NAV, SAFE_ZONES } from '../data/navConfig';
import { WORDING } from '../data/spreadModelConfig';
import type { TravelMode } from '../lib/fireAwareRouter';
import type { NavActions, NavState } from '../lib/useNavigation';
import { safeZoneOf } from '../lib/useNavigation';
import { voiceSupported } from '../lib/speech';
import { formatDistanceImperial, type ManeuverType } from '../lib/turnByTurn';
import { formatPacificTime } from '../lib/timeUtils';

const ARROW_ROTATION: Partial<Record<ManeuverType, number>> = {
  continue: 0,
  'slight-left': -35,
  'slight-right': 35,
  left: -90,
  right: 90,
  'sharp-left': -140,
  'sharp-right': 140,
};

function ManeuverIcon({ type }: { type: ManeuverType }) {
  if (type === 'arrive') {
    return (
      <svg viewBox="0 0 24 24" className="maneuver-icon" aria-hidden="true">
        <path d="M6 21V4h2v1h9l-2.5 4L17 13H8v8z" fill="currentColor" />
      </svg>
    );
  }
  if (type === 'uturn') {
    return (
      <svg viewBox="0 0 24 24" className="maneuver-icon" aria-hidden="true">
        <path
          d="M9 20v-9a4 4 0 0 1 8 0v2h2.6L16 17.6 12.4 13H15v-2a2 2 0 0 0-4 0v9z"
          fill="currentColor"
        />
      </svg>
    );
  }
  const rotation = ARROW_ROTATION[type] ?? 0;
  return (
    <svg
      viewBox="0 0 24 24"
      className="maneuver-icon"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      <path d="M12 3l5.5 7h-3.5v11h-4V10H6.5z" fill="currentColor" />
    </svg>
  );
}

interface NavigationPanelProps {
  nav: NavState;
  actions: NavActions;
  simTime: number;
  follow: boolean;
  onFollowChange: (on: boolean) => void;
}

export default function NavigationPanel({
  nav,
  actions,
  simTime,
  follow,
  onFollowChange,
}: NavigationPanelProps) {
  const { phase, track, progress } = nav;
  const navigating = phase === 'navigating' && track && progress;

  return (
    <aside className="info-panel nav-panel glass">
      {phase !== 'navigating' && phase !== 'arrived' && (
        <>
          <section>
            <h3>1 · Your position</h3>
            <p className="nav-hint">
              Click anywhere on the map to place yourself, pick a demo location, or use your real
              GPS (HTTPS/localhost only).
            </p>
            <select
              className="nav-select"
              value=""
              onChange={(e) => {
                const spot = DEMO_START_POINTS[Number(e.target.value)];
                if (spot) actions.placeUser(spot.point);
              }}
            >
              <option value="" disabled>
                Demo locations (Jan 2025 evacuation area)…
              </option>
              {DEMO_START_POINTS.map((spot, i) => (
                <option key={spot.name} value={i}>
                  {spot.name}
                </option>
              ))}
            </select>
            <div className="nav-row">
              <button
                className={nav.gpsActive ? 'nav-btn active' : 'nav-btn'}
                onClick={nav.gpsActive ? actions.disableGps : actions.enableGps}
              >
                {nav.gpsActive ? 'GPS on — stop' : 'Use my GPS'}
              </button>
              {nav.user && (
                <span className="nav-ok">
                  ✓ positioned ({nav.user.source === 'gps' ? 'GPS' : 'placed'})
                </span>
              )}
            </div>
            {nav.gpsError && <p className="nav-error">{nav.gpsError}</p>}
          </section>

          <section>
            <h3>2 · Travel mode</h3>
            <div className="nav-row">
              {(['drive', 'walk'] as TravelMode[]).map((mode) => (
                <button
                  key={mode}
                  className={nav.travelMode === mode ? 'nav-btn active' : 'nav-btn'}
                  onClick={() => actions.setTravelMode(mode)}
                >
                  {mode === 'drive' ? 'Driving' : 'On foot'}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>3 · Evacuate</h3>
            <button className="nav-start" disabled={!nav.user} onClick={actions.start}>
              Find my safest route
            </button>
            {nav.noRoute && (
              <p className="nav-error">
                No evacuation point is reachable with a safe margin from this position — in a real
                event this is a shelter-in-place situation. Follow official alerts.
              </p>
            )}
            <p className="nav-hint">
              Routes use the real street network and are checked point-by-point against the fire
              prediction: a road the fire is forecast to cut off before you would clear it (+
              {NAV.hardMarginMin} min margin) is rejected.
            </p>
          </section>

          <section>
            <h3>Real evacuation centers (Jan 2025)</h3>
            <ul className="zone-list">
              {SAFE_ZONES.map((zone) => (
                <li key={zone.id}>
                  <span className="zone-dot" />
                  <span>
                    <strong>{zone.name}</strong>
                    <em>{zone.address}</em>
                    <em className="zone-basis">{zone.basis}</em>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {navigating && (
        <>
          <div
            className={
              nav.degraded ? 'route-status degraded' : 'route-status safe'
            }
          >
            {nav.degraded
              ? `⚠ No fully safe route — best available (margin < ${NAV.hardMarginMin} min)`
              : `Route stays ≥ ${Math.max(Math.floor(nav.route?.minClearanceMin ?? 0), NAV.hardMarginMin)} min ahead of the predicted fire`}
          </div>

          {(() => {
            const steps = track.steps;
            const current = steps[progress.stepIndex];
            const upcoming = steps[Math.min(progress.stepIndex + 1, steps.length - 1)];
            return (
              <section className="maneuver-card">
                <div className="maneuver-main">
                  <ManeuverIcon type={upcoming.type} />
                  <div>
                    <p className="maneuver-distance">
                      {progress.toManeuverM < 15
                        ? 'Now'
                        : `In ${formatDistanceImperial(progress.toManeuverM)}`}
                    </p>
                    <p className="maneuver-text">{upcoming.instruction}</p>
                  </div>
                </div>
                <p className="maneuver-then">
                  {current.type !== 'arrive' && current.roadName
                    ? `on ${current.roadName}`
                    : ''}
                </p>
              </section>
            );
          })()}

          <section className="nav-stats">
            <div>
              <span className="stat-value">{Math.max(1, Math.round(progress.remainingMin))} min</span>
              <span className="stat-label">to safety</span>
            </div>
            <div>
              <span className="stat-value">{formatDistanceImperial(progress.remainingM)}</span>
              <span className="stat-label">remaining</span>
            </div>
            <div>
              <span className="stat-value">
                {formatPacificTime(simTime + progress.remainingMin * 60_000)}
              </span>
              <span className="stat-label">arrival</span>
            </div>
          </section>

          <section>
            <p className="nav-destination">
              → {nav.route?.target.name}
              {safeZoneOf(nav.route) && <em>{safeZoneOf(nav.route)!.address}</em>}
            </p>
            {nav.userClearanceMin !== null && nav.userClearanceMin < 45 && (
              <p className={nav.userClearanceMin < NAV.hardMarginMin ? 'nav-error' : 'nav-hint'}>
                Predicted fire arrival at your position: {Math.max(0, Math.round(nav.userClearanceMin))} min
              </p>
            )}
            {nav.rerouteReason && <p className="nav-reroute">{nav.rerouteReason}</p>}
          </section>

          <section className="nav-row nav-controls">
            <button
              className={nav.driveSimOn ? 'nav-btn active' : 'nav-btn'}
              onClick={() => actions.setDriveSim(!nav.driveSimOn)}
              disabled={nav.gpsActive}
              title="Move the blue dot along the route at the modeled evacuation speed"
            >
              {nav.driveSimOn ? '⏸ Pause sim drive' : '▶ Simulate driving'}
            </button>
            <button
              className={follow ? 'nav-btn active' : 'nav-btn'}
              onClick={() => onFollowChange(!follow)}
            >
              {follow ? 'Following' : 'Follow me'}
            </button>
            {voiceSupported() && (
              <button
                className={nav.voiceOn ? 'nav-btn active' : 'nav-btn'}
                onClick={actions.toggleVoice}
              >
                {nav.voiceOn ? '🔊 Voice on' : '🔇 Voice off'}
              </button>
            )}
            <button className="nav-btn danger" onClick={actions.stop}>
              End
            </button>
          </section>
        </>
      )}

      {phase === 'arrived' && (
        <section className="arrival-card">
          <h3>You have arrived</h3>
          <p className="nav-destination">
            {nav.route?.target.name}
            {safeZoneOf(nav.route) && <em>{safeZoneOf(nav.route)!.address}</em>}
          </p>
          <p className="nav-hint">Check in with shelter staff and stay clear of the fire area.</p>
          <button className="nav-btn" onClick={actions.stop}>
            Done
          </button>
        </section>
      )}

      <p className="panel-disclaimer">{WORDING.notGuidance}</p>
    </aside>
  );
}
