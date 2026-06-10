/**
 * The Help flow UI: one clear SOS-style button, then a single tidy card —
 * locating the GPS position, the resource question, then the directions:
 * a big compass arrow, the road to follow, the step list, ETA and progress.
 *
 * The assistant is voice-first: every reply is spoken aloud in a calm
 * voice, and the mic button lets the person answer by talking (free text
 * and quick replies remain as fallbacks). Whenever the person is speaking,
 * typing, or hearing a reply, the fire holds still so the exchange can be
 * followed; it resumes once they are moving.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HELP_LOCATION_DETAIL, HELP_LOCATION_LABEL } from '../data/helpScenario';
import { HELP_WORDING } from '../data/spreadModelConfig';
import type { HelpActions, HelpState } from '../lib/helpController';
import {
  isSpeechInputSupported,
  isSpeechOutputSupported,
  speakText,
  startSpeechInput,
  stopSpeaking,
} from '../lib/voice';

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
  const [voiceOn, setVoiceOn] = useState(isSpeechOutputSupported());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const cancelSpeechRef = useRef<(() => void) | null>(null);
  const lastSpokenRef = useRef(-1);
  const micSupported = isSpeechInputSupported();

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.chatBusy, interim]);

  // Speak each new assistant reply in the calm voice; the fire holds still
  // while the voice is playing.
  useEffect(() => {
    const messages = state.messages;
    const last = messages.length - 1;
    if (last < 0 || messages[last].role !== 'assistant') return;
    if (last <= lastSpokenRef.current) return;
    lastSpokenRef.current = last;
    if (!voiceOn) return;
    cancelSpeechRef.current?.(); // settle any reply still playing
    cancelSpeechRef.current = speakText(messages[last].text, {
      onStart: () => actions.setInteracting(true),
      onEnd: () => actions.setInteracting(false),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages, voiceOn]);

  // Stop audio cleanly when the card closes.
  useEffect(
    () => () => {
      stopListeningRef.current?.();
      cancelSpeechRef.current?.();
      stopSpeaking();
    },
    [],
  );

  const toggleMic = () => {
    if (listening) {
      stopListeningRef.current?.();
      return;
    }
    cancelSpeechRef.current?.(); // never transcribe our own voice
    stopListeningRef.current = startSpeechInput({
      onInterim: setInterim,
      onFinal: (text) => actions.sendChatMessage(text),
      onStateChange: (on) => {
        setListening(on);
        actions.setInteracting(on);
        if (!on) {
          setInterim('');
          stopListeningRef.current = null;
        }
      },
    });
  };

  const toggleVoice = () => {
    if (voiceOn) {
      cancelSpeechRef.current?.();
      stopSpeaking();
    }
    setVoiceOn(!voiceOn);
  };

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
        <button
          className={voiceOn ? 'help-voice-toggle on' : 'help-voice-toggle'}
          onClick={toggleVoice}
          title={voiceOn ? 'Mute the assistant voice' : 'Unmute the assistant voice'}
          aria-label={voiceOn ? 'Mute voice' : 'Unmute voice'}
        >
          {voiceOn ? '🔊' : '🔇'}
        </button>
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
            Made it out — <strong>{guidance.route.destination.name}</strong>. Clear of the fire
            area.
          </span>
        </div>
      )}

      {state.clockRate !== null && (
        <p className="help-clock-note">
          {state.clockRate === 0
            ? '⏸ Fire holds while you talk'
            : '⏩ Simulating the escape — 1 fire-minute per second'}
        </p>
      )}

      <div className="help-chat">
        <div className="help-msgs" ref={messagesRef}>
          {state.messages.map((m, i) => (
            <div key={i} className={`help-msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {listening && interim && <div className="help-msg user interim">{interim}</div>}
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
          {micSupported && (
            <button
              type="button"
              className={listening ? 'help-mic listening' : 'help-mic'}
              onClick={toggleMic}
              disabled={locating}
              title={listening ? 'Stop listening' : 'Hold a moment, then speak'}
              aria-label={listening ? 'Stop listening' : 'Speak to the assistant'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5.3-3a5.3 5.3 0 0 1-10.6 0H4.8a7.2 7.2 0 0 0 6.2 7.1V21h2v-2.9a7.2 7.2 0 0 0 6.2-7.1z"
                />
              </svg>
            </button>
          )}
          <input
            type="text"
            value={listening ? interim : draft}
            placeholder={
              locating ? 'Locating…' : listening ? 'Listening…' : 'Speak or type a reply…'
            }
            readOnly={listening}
            disabled={locating}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => actions.setInteracting(true)}
            onBlur={() => actions.setInteracting(false)}
          />
          <button type="submit" disabled={!draft.trim() || locating || listening}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
