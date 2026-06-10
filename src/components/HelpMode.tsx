/**
 * The Help flow UI: one clear SOS-style button, then a single tidy card
 * that walks through the rescue — locating the GPS position, asking what
 * the person has with them (quick replies + free text + LLM-phrased
 * answers), then the qualitative directions: a big compass arrow, the road
 * to follow, the step list, ETA and a progress bar to the safe zone.
 * Honest by construction: simulated/model-based disclaimers in every state.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HELP_LOCATION_DETAIL, HELP_LOCATION_LABEL } from '../data/helpScenario';
import { HELP_WORDING } from '../data/spreadModelConfig';
import type { HelpActions, HelpState } from '../lib/helpController';

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

function modeLabel(state: HelpState): string {
  const base = state.mode === 'car' ? 'by car' : state.mode === 'bike' ? 'by bike' : 'on foot';
  return state.accessibilityNote ? `${base} · extra time planned` : base;
}

export default function HelpMode({
  state,
  actions,
}: {
  state: HelpState;
  actions: HelpActions;
}) {
  return (
    <div className="help-wrap">
      <button
        className={state.enabled ? 'help-toggle glass active' : 'help-toggle glass'}
        onClick={actions.toggle}
        title="Simulated rescue flow — model-based guidance, not official emergency guidance"
      >
        <span className="help-toggle-dot" />
        {state.enabled ? HELP_WORDING.buttonActive : HELP_WORDING.buttonIdle}
      </button>
      {state.enabled && <HelpCard state={state} actions={actions} />}
    </div>
  );
}

function HelpCard({ state, actions }: { state: HelpState; actions: HelpActions }) {
  const [draft, setDraft] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.chatBusy]);

  const { guidance } = state;
  const locating = state.status === 'locating';

  let statusClass = 'pending';
  let statusText = HELP_WORDING.statusAsk;
  if (state.status === 'routing') {
    statusText = HELP_WORDING.statusRouting;
  } else if (state.status === 'guiding' && guidance) {
    statusClass = guidance.riskStatus === 'safe' ? 'safe' : 'caution';
    statusText =
      guidance.riskStatus === 'safe' ? HELP_WORDING.statusSafe : HELP_WORDING.statusCaution;
  } else if (state.status === 'arrived') {
    statusClass = 'safe';
    statusText = HELP_WORDING.arrived;
  } else if (state.status === 'no-route') {
    statusClass = 'danger';
    statusText = HELP_WORDING.statusNone;
  }

  const userInDanger = state.userRisk === 'in-fire' || state.userRisk === 'near-front';
  const activeStep = guidance ? guidance.route.steps[state.activeStepIndex] : null;
  const progress =
    guidance && state.remainingM !== null && guidance.totalM > 0
      ? Math.min(Math.max(1 - state.remainingM / guidance.totalM, 0), 1)
      : 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    actions.sendChatMessage(text);
    setDraft('');
  };

  return (
    <div className="help-card glass">
      <h3>
        {HELP_WORDING.title}
        <span className="help-sim-tag">simulated</span>
      </h3>

      {locating ? (
        <div className="help-locating">
          <span className="spinner spinner-sm" aria-hidden="true" />
          {HELP_WORDING.locating}
        </div>
      ) : (
        state.fix && (
          <p className="help-location">
            <span className="help-location-pin" aria-hidden="true" />
            <span>
              <strong>{HELP_LOCATION_LABEL}</strong>
              <em>{HELP_LOCATION_DETAIL}</em>
            </span>
          </p>
        )
      )}

      {!locating && (
        <p className={`help-status ${statusClass}`}>
          <span className="help-status-dot" />
          {statusText}
        </p>
      )}
      {userInDanger && state.status !== 'arrived' && (
        <p className="help-danger-note">{HELP_WORDING.emergency}</p>
      )}

      {guidance && activeStep && state.status !== 'arrived' && (
        <div className="help-route">
          <div className="help-direction">
            <span className="help-direction-arrow" aria-hidden="true">
              {activeStep.arrow}
            </span>
            <span className="help-direction-text">
              <strong>Head {activeStep.direction}</strong>
              <em>{activeStep.road}</em>
            </span>
          </div>
          <p className="help-meta">
            <span>{formatEta(state.remainingS)}</span>
            <span>·</span>
            <span>{formatDistance(state.remainingM)}</span>
            {state.mode && <span className="help-mode">{modeLabel(state)}</span>}
          </p>
          <div className="help-progress" role="img" aria-label="Progress to the safe zone">
            <div className="help-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="help-dest">
            <span className="help-safe-chip">Safe zone</span>
            {guidance.route.destination.name}
          </p>
          <ol className="help-steps">
            {guidance.route.steps.map((step, i) => {
              const cls =
                i < state.activeStepIndex ? 'done' : i === state.activeStepIndex ? 'active' : 'todo';
              return (
                <li key={i} className={cls}>
                  <span className="help-step-arrow" aria-hidden="true">
                    {i < state.activeStepIndex ? '✓' : step.arrow}
                  </span>
                  <span className="help-step-body">
                    <strong>
                      {step.direction} · {step.road}
                    </strong>
                    {i === state.activeStepIndex && <em>{step.text}</em>}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {state.status === 'arrived' && guidance && (
        <div className="help-arrived">
          <span aria-hidden="true">✓</span>
          <span>
            Made it out — <strong>{guidance.route.destination.name}</strong>. Clear of the
            modeled fire area.
          </span>
        </div>
      )}

      <p className="help-clock-note">
        {state.clockRate === 1
          ? '⏱ World running in real time while you reply'
          : state.clockRate === null
            ? '▶ Normal playback'
            : '⏩ World fast-forwarding (1 min = 1 s) while you move'}
      </p>

      <div className="help-chat">
        <div className="help-msgs" ref={messagesRef}>
          {state.messages.map((m, i) => (
            <div key={i} className={`help-msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {state.chatBusy && <div className="help-msg assistant typing">…</div>}
        </div>
        {state.status === 'need-resource' && state.mode === null && !state.chatBusy && (
          <div className="help-quick">
            <button onClick={() => actions.chooseResource('car')}>🚗 Car</button>
            <button onClick={() => actions.chooseResource('bike')}>🚲 Bike</button>
            <button onClick={() => actions.chooseResource('foot')}>🚶 On foot</button>
            <button onClick={() => actions.chooseResource('limited')}>♿ Disabled</button>
          </div>
        )}
        <form className="help-input" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            placeholder={locating ? 'Locating…' : 'Type a reply…'}
            disabled={locating}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => actions.setChatFocus(true)}
            onBlur={() => actions.setChatFocus(false)}
          />
          <button type="submit" disabled={!draft.trim() || locating}>
            Send
          </button>
        </form>
      </div>

      <div className="help-foot">
        <p>{HELP_WORDING.simulatedNote}</p>
        <p>
          {HELP_WORDING.modelBased} {HELP_WORDING.notOfficial}
        </p>
        {!userInDanger && <p>{HELP_WORDING.emergency}</p>}
      </div>
    </div>
  );
}
