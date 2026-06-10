/**
 * Voice layer for the Help assistant: a calm spoken voice for every
 * assistant reply (Web Speech synthesis, best available natural voice) and
 * tap-to-talk speech input (Web Speech recognition). Both run entirely in
 * the browser — no audio leaves the device — and both degrade gracefully:
 * no support simply means text-only.
 */

// ---- speech output ----

/** Preference order for a calm, natural, Siri-like voice. */
const VOICE_PRIORITY: Array<(v: SpeechSynthesisVoice) => boolean> = [
  (v) => v.name === 'Samantha', // macOS / iOS classic assistant voice
  (v) => /siri/i.test(v.name),
  (v) => /(aria|jenny|michelle|emma|ava|sonia|libby).*(natural|online)/i.test(v.name),
  (v) => v.name === 'Google US English',
  (v) => /^en[-_]US/i.test(v.lang),
  (v) => /^en/i.test(v.lang),
];

export function isSpeechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickCalmVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  for (const matches of VOICE_PRIORITY) {
    const voice = voices.find(matches);
    if (voice) return voice;
  }
  return voices[0] ?? null;
}

// Voice lists load asynchronously in some browsers; warm the cache so the
// first reply already speaks with the preferred voice.
if (isSpeechOutputSupported()) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}

export function stopSpeaking(): void {
  if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
}

/**
 * Speak one assistant reply, calm and clear. `onStart` fires immediately,
 * `onEnd` fires exactly once (end, error, cancel, or no support). Returns a
 * cancel function.
 */
export function speakText(
  text: string,
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): () => void {
  handlers.onStart?.();
  let ended = false;
  let watchdog = 0;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(watchdog);
    handlers.onEnd?.();
  };
  if (!isSpeechOutputSupported()) {
    finish();
    return () => {};
  }
  window.speechSynthesis.cancel();
  const spoken = text.replace(/[↗→↓↙←↑✓]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(spoken);
  const voice = pickCalmVoice();
  if (voice) utterance.voice = voice;
  // Unhurried, steady delivery — slightly slower than normal speech.
  utterance.rate = 0.88;
  utterance.pitch = 1.0;
  utterance.volume = 1;
  utterance.onend = finish;
  utterance.onerror = finish;
  // Some browsers drop end events for cancelled/blocked utterances; the
  // watchdog guarantees onEnd (and the fire clock) can never get stuck.
  watchdog = window.setTimeout(finish, 3000 + spoken.length * 130);
  window.speechSynthesis.speak(utterance);
  return () => {
    window.speechSynthesis.cancel();
    finish();
  };
}

// ---- speech input ----

interface RecognitionAlternativeLike {
  transcript: string;
}

interface RecognitionResultLike {
  isFinal: boolean;
  0: RecognitionAlternativeLike;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechInputSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface SpeechInputHandlers {
  /** Live transcript while the person is still talking. */
  onInterim: (text: string) => void;
  /** Final transcript for one utterance. */
  onFinal: (text: string) => void;
  /** True when the mic opens, false exactly once when it closes. */
  onStateChange: (listening: boolean) => void;
}

/**
 * Open the mic for one spoken utterance. Returns a stop function; the
 * recognizer also stops itself after the person finishes speaking.
 */
export function startSpeechInput(handlers: SpeechInputHandlers): () => void {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    handlers.onStateChange(false);
    return () => {};
  }
  const recognition = new Ctor();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let closed = false;
  let finalText = '';
  const close = () => {
    if (closed) return;
    closed = true;
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onStateChange(false);
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    handlers.onInterim(interim || finalText);
  };
  recognition.onend = close;
  recognition.onerror = close;

  handlers.onStateChange(true);
  try {
    recognition.start();
  } catch {
    close();
  }
  return () => {
    try {
      recognition.stop();
    } catch {
      close();
    }
  };
}
