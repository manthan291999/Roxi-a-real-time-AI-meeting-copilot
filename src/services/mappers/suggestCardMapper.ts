import { ContextItem, SuggestCardType, SuggestTag } from '../../shared/types';
import { ContextItemWire, SuggestAnswerWire } from '../wire';

const KNOWN_TAGS: readonly SuggestTag[] = ['technical', 'decision', 'risk', 'clarification'];

/**
 * The LLM emits free-form tag strings, so keep only the ones the UI can style
 * and preserve KNOWN_TAGS order for a stable pill sequence across renders.
 */
function toSuggestTags(raw: string[] | undefined): SuggestTag[] {
  if (!raw?.length) return [];
  const seen = new Set(raw.map((tag) => tag.trim().toLowerCase()));
  return KNOWN_TAGS.filter((tag) => seen.has(tag));
}

function toContextItem(wire: ContextItemWire): ContextItem {
  return {
    text: wire.text ?? '',
    confidence: wire.match_confidence ?? 0,
    isVerbatim: wire.is_verbatim ?? false,
    isTechnical: wire.is_technical ?? false,
    tags: toSuggestTags(wire.tags),
  };
}

/**
 * Stable id derived from content.
 *
 * The Rust router emits the same payload on both `suggested_response` and
 * `suggest_answer` (event_router.rs:55-57) and TauriEventBus subscribes to both,
 * so every suggestion arrives twice. Hashing the content makes those two
 * deliveries collapse into one card via deduplicateCards.
 */
function toCardId(text: string, speaker: string): string {
  const source = `${speaker}:${text}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (Math.imul(hash, 31) + source.charCodeAt(i)) | 0;
  }
  return `sg_${(hash >>> 0).toString(36)}`;
}

/** Wire payload -> domain card. Pure, so it is unit-testable without Tauri. */
export function toSuggestCard(wire: SuggestAnswerWire, receivedAt: number = Date.now()): SuggestCardType {
  const text = wire.text ?? '';
  const speaker = wire.speaker ?? 'Unknown';

  return {
    id: toCardId(text, speaker),
    text,
    speaker,
    timestamp: receivedAt,
    replyType: wire.type ?? undefined,
    contextItems: (wire.context_items ?? []).map(toContextItem),
  };
}
