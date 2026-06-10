/**
 * Text-only rescue assistant for the Help flow.
 *
 * The assistant NEVER controls the app: what the person has with them (car /
 * bike / on foot, disability) is parsed locally with keywords, and the route
 * + safety decisions come from the risk model. The LLM (Gemini, when
 * VITE_GEMINI_API_KEY is set) only phrases short conversational replies
 * around the structured context we hand it — including the qualitative
 * directions ("head NORTH-EAST on E Las Virgenes Canyon Rd…") the model
 * chose. When the key is absent or the call fails, a deterministic local
 * template produces the reply, so the demo never blocks on the network.
 */
import { HELP_WORDING } from '../data/spreadModelConfig';

export type TransportMode = 'car' | 'bike' | 'foot';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type AssistantEvent =
  | 'ask-resource'
  | 'clarify-resource'
  | 'route-set'
  | 'reroute'
  | 'arrived'
  | 'no-route'
  | 'chat';

export interface AssistantContext {
  event: AssistantEvent;
  mode: TransportMode | null;
  accessibilityNote: string | null;
  userRisk: string | null;
  /** Road the simulated GPS fix landed on. */
  locationLabel: string;
  /** Qualitative directions for the chosen route (roads + compass words). */
  routeSummary: string | null;
  /** The instruction for the step the person is currently on. */
  currentStep: string | null;
  destinationName: string | null;
  etaMinutes: number | null;
  distanceKm: number | null;
  routeStatus: 'safe' | 'caution' | 'none' | null;
  horizonMinutes: number;
}

/** Local keyword parsing — deterministic, never delegated to the LLM. */
export function parseTransportMode(text: string): TransportMode | null {
  const t = text.toLowerCase();
  if (/\b(car|truck|suv|van|jeep|vehicle|drive|driving|motorcycle|motorbike)\b/.test(t)) {
    return 'car';
  }
  if (/\b(bike|bicycle|cycle|cycling|e-?bike|scooter)\b/.test(t)) return 'bike';
  if (
    /\b(foot|walk|walking|run|running|hike|hiking|nothing|none|no car|don'?t have)\b/.test(t)
  ) {
    return 'foot';
  }
  return null;
}

export function parseAccessibilityNote(text: string): string | null {
  const t = text.toLowerCase();
  if (
    /\b(wheelchair|disabled|disability|handicap|elderly|injured|injury|hurt|crutch|crutches|cane|stroller|limited mobility|mobility|can'?t walk|cannot walk|slow)\b/.test(
      t,
    )
  ) {
    return 'limited mobility';
  }
  return null;
}

function modeVerb(mode: TransportMode | null): string {
  if (mode === 'car') return 'Drive';
  if (mode === 'bike') return 'Ride';
  return 'Move';
}

function etaPhrase(ctx: AssistantContext): string {
  if (ctx.etaMinutes === null) return '';
  const minutes = Math.max(1, Math.round(ctx.etaMinutes));
  const dist = ctx.distanceKm !== null ? ` (${ctx.distanceKm.toFixed(1)} km)` : '';
  return ` About ${minutes} min${dist} to the safe zone.`;
}

/** Deterministic fallback replies (also the offline/demo-safe path). */
export function localAssistantReply(ctx: AssistantContext, userMessage?: string | null): string {
  void userMessage;
  switch (ctx.event) {
    case 'ask-resource':
      return (
        `I found you on ${ctx.locationLabel}, inside the modeled fire-risk area — we need to get you moving. ` +
        'What do you have with you: a car, a bike, or are you on foot? And tell me if a disability or injury slows you down.'
      );
    case 'clarify-resource':
      return 'Sorry — to pick the right way out I need to know: do you have a car, a bike, or are you on foot? If you have a disability, say so and I will plan for extra time.';
    case 'route-set': {
      const pace = ctx.accessibilityNote ? ' at your own steady pace' : '';
      return (
        `${modeVerb(ctx.mode)}${pace} ${ctx.routeSummary ?? 'along the highlighted road'}.` +
        `${etaPhrase(ctx)} Follow the blue path on the map — I am watching the modeled spread and will redirect you if it changes.`
      );
    }
    case 'reroute':
      return `Change of plan — the modeled spread now threatens your previous route. New way out: ${ctx.routeSummary ?? 'follow the updated blue path'}.${etaPhrase(ctx)}`;
    case 'arrived':
      return 'You made it — you are at the safe zone, clear of the modeled fire area. Stay there and follow official instructions. (Simulated demo.)';
    case 'no-route':
      return `${HELP_WORDING.statusNone} ${HELP_WORDING.emergency}`;
    case 'chat':
    default: {
      if (ctx.currentStep) {
        return `${ctx.currentStep}${etaPhrase(ctx)} Keep following the blue path.`;
      }
      return 'I am watching the modeled fire around you. Tell me if you have a car, a bike, or are on foot, and I will pick the safest way out.';
    }
  }
}

const SYSTEM_PROMPT = `You are a calm wildfire evacuation assistant inside a SIMULATED demo (the "Kenneth Fire" reconstruction). Rules:
- Reply with plain text only, 1–3 short sentences. No lists, no markdown, no emojis.
- You only describe and explain; the app computes the route and safety. Use ONLY the context facts given — never invent road names, closures, shelters, or fire positions.
- Always give directions qualitatively: the compass direction plus the road name from the context, e.g. "head NORTH-EAST on E Las Virgenes Canyon Rd".
- When asking what the person has, ask about: a car, a bike, on foot, and whether a disability or injury slows them down.
- This is model-based decision support, not official emergency guidance; tell anyone in immediate danger to call 911 and follow official alerts.
- Never promise an "exact" or "guaranteed safe" route — say "suggested route" / "avoids the modeled fire-risk zones".`;

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_TIMEOUT_MS = 6000;

function contextBlock(ctx: AssistantContext): string {
  return [
    `EVENT: ${ctx.event}`,
    `person located on: ${ctx.locationLabel}`,
    `has: ${ctx.mode ?? 'unknown yet'}`,
    ctx.accessibilityNote ? `accessibility: ${ctx.accessibilityNote}` : null,
    `person risk: ${ctx.userRisk ?? 'unknown'}`,
    ctx.routeSummary ? `route directions: ${ctx.routeSummary}` : 'route directions: none yet',
    ctx.currentStep ? `current step: ${ctx.currentStep}` : null,
    `destination: ${ctx.destinationName ?? 'none yet'}`,
    ctx.etaMinutes !== null ? `eta minutes: ${Math.round(ctx.etaMinutes)}` : null,
    ctx.distanceKm !== null ? `distance km: ${ctx.distanceKm.toFixed(1)}` : null,
    `route status: ${ctx.routeStatus ?? 'none'}`,
    `fire prediction horizon: ${ctx.horizonMinutes} minutes`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function geminiReply(
  apiKey: string,
  ctx: AssistantContext,
  history: ChatMessage[],
  userMessage: string | null,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const contents = [
      ...history.slice(-8).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
      {
        role: 'user',
        parts: [
          {
            text: `${contextBlock(ctx)}\n\n${
              userMessage ? `USER SAYS: ${userMessage}` : 'Write the assistant message for this event.'
            }`,
          },
        ],
      },
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 140, temperature: 0.4 },
        }),
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Produce the assistant's next text reply: Gemini when a key is configured,
 * otherwise (or on any failure) the deterministic local template.
 */
export async function generateAssistantReply(
  ctx: AssistantContext,
  history: ChatMessage[],
  userMessage: string | null,
): Promise<string> {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  if (apiKey) {
    const llm = await geminiReply(apiKey, ctx, history, userMessage);
    if (llm) return llm;
  }
  return localAssistantReply(ctx, userMessage);
}
