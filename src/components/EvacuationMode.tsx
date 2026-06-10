/**
 * Evacuation Mode entry point: a single toggle pill plus the route card.
 * Kept deliberately small so the screen stays clean.
 */
import type { EvacuationActions, EvacuationState } from '../lib/evacuationRouting';
import RouteInstructionCard from './RouteInstructionCard';

export default function EvacuationMode({
  state,
  actions,
}: {
  state: EvacuationState;
  actions: EvacuationActions;
}) {
  return (
    <div className="evac-wrap">
      <button
        className={state.enabled ? 'evac-toggle glass active' : 'evac-toggle glass'}
        onClick={actions.toggle}
        title="Model-based evacuation suggestions — not official emergency guidance"
      >
        <span className="evac-toggle-dot" />
        Evacuation Mode
      </button>
      {state.enabled && <RouteInstructionCard state={state} actions={actions} />}
    </div>
  );
}
