/**
 * Voice guidance via the Web Speech API (speechSynthesis) — supported by all
 * current Chrome/Edge/Safari/Firefox releases (MDN), no network service or
 * key required. Kept deliberately tiny: one utterance at a time, mute switch.
 */

let muted = true; // voice is opt-in
let lastSpoken = '';
let lastSpokenAt = 0;

export function setVoiceMuted(value: boolean): void {
  muted = value;
  if (muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function voiceMuted(): boolean {
  return muted;
}

export function voiceSupported(): boolean {
  return 'speechSynthesis' in window;
}

/** Speak a guidance prompt; duplicate prompts within 20 s are dropped. */
export function speak(text: string): void {
  if (muted || !voiceSupported()) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpokenAt < 20_000) return;
  lastSpoken = text;
  lastSpokenAt = now;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}
