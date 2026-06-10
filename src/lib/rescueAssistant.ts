/**
 * Text-only rescue assistant for the simulated evacuation.
 *
 * The assistant NEVER controls the app: transport mode and accessibility are
 * parsed locally with keywords, routing/safety decisions come from the risk
 * model, and the LLM only phrases short conversational replies around the
 * structured context we hand it. When VITE_GEMINI_API_KEY is absent (or the
 * call fails/times out), a deterministic local template produces the reply,
 * so the demo never blocks on the network.
 */
import { EVAC_WORDING } from '../data/spreadModelConfig';

export type TransportMode = 'driving' | 'walking';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type AssistantEvent =
  | 'intro'
  | 'mode-set'
  | 'clarify-mode'
  | 'reroute'
  | 'dest-moved'
  | 'arrived'
  | 'no-route'
  | 'chat';

export interface AssistantContext {
  event: AssistantEvent;
  mode: TransportMode | null;
  accessibilityNote: string | null;
  userRisk: string | null;
  destinationName: string | null;
  previousDestinationName?: string | null;
  etaMinutes: number | null;
  distanceKm: number | null;
  routeStatus: 'safe' | 'caution' | 'none' | null;
  horizonMinutes: number;
}

/** Local keyword parsing — deterministic, never delegated to the LLM. */
export function parseTransportMode(text: string): TransportMode | null {
  const t = text.toLowerCase();
  if (/\b(car|drive|driving|truck|suv|van|vehicle|motorcycle)\b/.test(t)) return 'driving';
  if (/\b(walk|walking|foot|on foot|bike|biking|run|running)\b/.test(t)) return 'walking';
  return null;
}

export function parseAccessibilityNote(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(wheelchair|disabled|disability|elderly|injured|injury|crutch|cane|stroller|limited mobility|mobility)\b/.test(t)) {
    return 'limited mobility';
  }
  return null;
}

function describeRoute(ctx: AssistantContext): string {
  if (!ctx.destinationName || ctx.etaMinutes === null) return '';
  const verb = ctx.mode === 'walking' ? 'on foot' : 'by car';
  const dist = ctx.distanceKm !== null ? `, ${ctx.distanceKm.toFixed(1)} km` : '';
  return `Head to ${ctx.destinationName} ${verb} — about ${Math.max(1, Math.round(ctx.etaMinutes))} min${dist}.`;
}

/** Deterministic fallback replies (also the offline/demo-safe path). */
export function localAssistantReply(ctx: AssistantContext, userMessage?: string | null): string {
  void userMessage;
  switch (ctx.event) {
    case 'intro':
      return (
        'Simulated rescue assistant here — this is a model-based demo, not official emergency guidance. ' +
        'You are near the modeled fire. Do you have a car, or are you on foot? Any mobility needs?'
      );
    case 'clarify-mode':
      return 'Sorry — to suggest a route I need to know: do you have a car, or are you on foot?';
    case 'mode-set':
      return `${describeRoute(ctx)} Start moving now — I will keep watching the modeled spread and update your route. ${EVAC_WORDING.modelBased}`;
    case 'reroute':
      return `Your previous route is no longer low-risk in the model. New route: ${describeRoute(ctx)}`;
    case 'dest-moved':
      return `The modeled spread now threatens ${ctx.previousDestinationName ?? 'your safe zone'}. Safe zone moved: ${describeRoute(ctx)}`;
    case 'arrived':
      return 'You have reached the simulated safe zone. Stay alert and follow local authorities and emergency alerts.';
    case 'no-route':
      return EVAC_WORDING.statusNone;
    case 'chat':
    default: {
      const route = describeRoute(ctx);
      return route
        ? `${route} Keep moving away from the fire. ${EVAC_WORDING.modelBased}`
        : 'I am watching the modeled fire around you. Tell me if you have a car or are on foot, and I will suggest a route.';
    }
  }
}

const SYSTEM_PROMPT = `You are a calm wildfire evacuation assistant inside a SIMULATED demo (the "Kenneth Fire" reconstruction). Rules:
- Reply with plain text only, 1–3 short sentences. No lists, no markdown, no emojis.
- You only describe and explain; the app computes routes and safety. Use ONLY the context facts given — never invent road names, closures, shelters, or fire positions.
- This is model-based decision support, not official emergency guidance; say so when reassuring the user, and tell anyone in immediate danger to call emergency services and follow official alerts.
- Never promise an "exact" or "guaranteed safe" route — say "suggested route" / "avoids modeled fire-risk zones".`;

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_TIMEOUT_MS = 6000;

function contextBlock(ctx: AssistantContext): string {
  return [
    `EVENT: ${ctx.event}`,
    `transport: ${ctx.mode ?? 'unknown'}`,
    ctx.accessibilityNote ? `accessibility: ${ctx.accessibilityNote}` : null,
    `user risk: ${ctx.userRisk ?? 'unknown'}`,
    `destination: ${ctx.destinationName ?? 'none yet'}`,
    ctx.previousDestinationName ? `previous destination: ${ctx.previousDestinationName}` : null,
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
