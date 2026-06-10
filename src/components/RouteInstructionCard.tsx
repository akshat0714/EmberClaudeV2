/**
 * Rescue card: route summary + the text-only assistant chat. While the
 * person is replying the shared world clock runs in real time; otherwise the
 * simulation fast-forwards — the card shows which is active. Honest by
 * construction: exact model-based disclaimers in every state.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const [draft, setDraft] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.chatBusy]);

  const { best } = state;
  let statusClass = 'pending';
  let statusText = 'Waiting for your reply…';
  if (state.status === 'routing') {
    statusText = 'Calculating suggested route…';
  } else if (state.status === 'routed' && best) {
    statusClass = best.status === 'safe' ? 'safe' : 'caution';
    statusText = best.status === 'safe' ? EVAC_WORDING.statusClear : EVAC_WORDING.statusNear;
  } else if (state.status === 'no-route') {
    statusClass = 'danger';
    statusText = EVAC_WORDING.statusNone;
  } else if (state.status === 'error') {
    statusClass = 'danger';
    statusText = state.message ?? 'Routing unavailable.';
  }

  const userInDanger = state.userRisk === 'in-fire' || state.userRisk === 'near-front';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    actions.sendChatMessage(text);
    setDraft('');
  };

  return (
    <div className="evac-card glass">
      <h3>{EVAC_WORDING.title}</h3>

      <p className={`evac-status ${statusClass}`}>
        <span className="evac-status-dot" />
        {statusText}
      </p>
      {best && (
        <>
          <p className="evac-dest">
            <span className="evac-safe-chip">Safe zone</span>
            {best.candidate.destination.name}
          </p>
          <p className="evac-meta">
            <span>{formatEta(state.remainingS)}</span>
            <span>·</span>
            <span>{formatDistance(state.remainingM)}</span>
            {state.mode && <span className="evac-mode">{state.mode === 'driving' ? 'driving' : 'on foot'}</span>}
            {state.arrived && <span className="evac-arrived">Arrived (simulated)</span>}
          </p>
        </>
      )}
      <p className="evac-clock-note">
        {state.clockRate === 1
          ? '⏱ World running in real time while you reply'
          : '⏩ World fast-forwarding (1 min = 1 s)'}
      </p>
      {userInDanger && <p className="evac-danger-note">{EVAC_WORDING.emergency}</p>}

      <div className="evac-chat">
        <div className="evac-msgs" ref={messagesRef}>
          {state.messages.map((m, i) => (
            <div key={i} className={`evac-msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {state.chatBusy && <div className="evac-msg assistant typing">…</div>}
        </div>
        {state.mode === null && !state.chatBusy && (
          <div className="evac-quick">
            <button onClick={() => actions.chooseMode('driving')}>I have a car</button>
            <button onClick={() => actions.chooseMode('walking')}>I'm on foot</button>
          </div>
        )}
        <form className="evac-input" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            placeholder="Type a reply…"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => actions.setChatFocus(true)}
            onBlur={() => actions.setChatFocus(false)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </div>

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
