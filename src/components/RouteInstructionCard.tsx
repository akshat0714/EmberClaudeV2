/**
 * Compact evacuation card: suggested route summary, safety status, location
 * fallbacks and demo controls. Honest by construction — every state carries
 * the model-based disclaimers, and "no route" is shown rather than faked.
 */
import { EVAC_WORDING } from '../data/spreadModelConfig';
import type { EvacuationActions, EvacuationState } from '../lib/evacuationRouting';

function formatEta(remainingS: number | null): string {
  if (remainingS === null) return '—';
  const minutes = Math.max(1, Math.round(remainingS / 60));
  return `${minutes} min`;
}

function formatDistance(remainingM: number | null): string {
  if (remainingM === null) return '—';
  if (remainingM < 950) return `${Math.round(remainingM / 10) * 10} m`;
  return `${(remainingM / 1000).toFixed(1)} km`;
}

export default function RouteInstructionCard({
  state,
  actions,
}: {
  state: EvacuationState;
  actions: EvacuationActions;
}) {
  const { best } = state;
  const needsLocation = !state.fix;
  const showDemoControls = state.fix !== null && state.fix.source !== 'gps';

  let statusClass = 'pending';
  let statusText = 'Calculating suggested route…';
  if (state.status === 'routed' && best) {
    statusClass = best.status === 'safe' ? 'safe' : 'caution';
    statusText = best.status === 'safe' ? EVAC_WORDING.statusClear : EVAC_WORDING.statusNear;
  } else if (state.status === 'no-route') {
    statusClass = 'danger';
    statusText = EVAC_WORDING.statusNone;
  } else if (state.status === 'error') {
    statusClass = 'danger';
    statusText = state.message ?? 'Routing unavailable.';
  } else if (state.status === 'need-location') {
    statusClass = 'pending';
    statusText = 'Waiting for a location…';
  }

  const userInDanger = state.userRisk === 'in-fire' || state.userRisk === 'near-front';

  return (
    <div className="evac-card glass">
      <h3>{EVAC_WORDING.title}</h3>

      {needsLocation ? (
        <>
          <p className="evac-explainer">{EVAC_WORDING.locationExplainer}</p>
          {state.gpsStatus === 'denied' && (
            <p className="evac-note">Location permission denied — use a fallback below.</p>
          )}
          {state.gpsStatus === 'unavailable' && (
            <p className="evac-note">GPS unavailable on this device — use a fallback below.</p>
          )}
          <div className="evac-buttons">
            {state.gpsStatus !== 'denied' && state.gpsStatus !== 'unavailable' && (
              <button onClick={actions.shareLocation}>
                {state.gpsStatus === 'requesting' ? 'Requesting…' : 'Share my location'}
              </button>
            )}
            <button onClick={actions.useDemoLocation}>Use demo location</button>
            <button onClick={state.picking ? actions.cancelPicking : actions.startPicking}>
              {state.picking ? 'Cancel pick' : 'Drop my location'}
            </button>
          </div>
          {state.picking && <p className="evac-note">Click the map to set your location.</p>}
        </>
      ) : (
        <>
          <p className={`evac-status ${statusClass}`}>
            <span className="evac-status-dot" />
            {statusText}
          </p>
          {best && (
            <>
              <p className="evac-dest">{best.candidate.destination.name}</p>
              <p className="evac-meta">
                <span>{formatEta(state.remainingS)}</span>
                <span>·</span>
                <span>{formatDistance(state.remainingM)}</span>
                {state.arrived && <span className="evac-arrived">Arrived (simulated)</span>}
              </p>
            </>
          )}
          {state.lowAccuracy && <p className="evac-note">{EVAC_WORDING.lowAccuracy}</p>}
          {userInDanger && <p className="evac-danger-note">{EVAC_WORDING.emergency}</p>}
          {showDemoControls && (
            <div className="evac-buttons">
              <button onClick={actions.toggleDrive} disabled={!best}>
                {state.driving ? 'Pause demo drive' : 'Drive route (demo)'}
              </button>
              <button onClick={actions.moveTowardFire}>Move toward fire</button>
              <button onClick={actions.useDemoLocation}>Reset demo dot</button>
            </div>
          )}
        </>
      )}

      <div className="evac-foot">
        <p>{EVAC_WORDING.simulatedNote}</p>
        <p>
          {EVAC_WORDING.modelBased} {EVAC_WORDING.notOfficial}
        </p>
        {!userInDanger && <p>{EVAC_WORDING.emergency}</p>}
      </div>
    </div>
  );
}
