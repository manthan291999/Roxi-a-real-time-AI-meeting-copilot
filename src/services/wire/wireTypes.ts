/**
 * Wire contracts: the exact JSON shapes crossing the Tauri boundary.
 *
 * These mirror the Rust structs (serde's snake_case default) and must only be
 * referenced by service adapters and their mappers — never by UI code. That
 * keeps a Rust field rename from rippling into components.
 *
 * Rust sources of truth:
 *   ResponsePayload -> src-tauri/src/sidecar/events.rs
 *   ContextItem     -> src-tauri/src/agents/domain/context_item.rs
 *   start_capture   -> src-tauri/src/commands/capture.rs
 *
 * Every field is optional: the Rust side uses `Option<T>` and `#[serde(default)]`
 * so schema drift degrades gracefully instead of throwing here.
 */

export interface ContextItemWire {
  text?: string;
  match_confidence?: number;
  is_verbatim?: boolean;
  is_technical?: boolean;
  /** Free-form LLM output; narrowed to SuggestTag by the mapper. */
  tags?: string[];
}

/** Payload of `transcript_partial` / `transcript_final`. */
export interface TranscriptWire {
  text?: string;
  speaker?: string;
  sttLabel?: string;
}

export interface SuggestAnswerWire {
  text?: string;
  speaker?: string;
  /** serde-renamed from `reply_type`. */
  type?: string | null;
  context_items?: ContextItemWire[];
}

/**
 * Argument object for `invoke('start_capture', ...)`.
 * Extends Record so it satisfies Tauri's `InvokeArgs` without a cast.
 */
export interface StartCapturePayload extends Record<string, unknown> {
  context?: string;
  role?: string;
}
