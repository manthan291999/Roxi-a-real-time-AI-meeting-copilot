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
  tags?: string[];
}

export interface ResponseBulletWire {
  text: string;
  isBest: boolean;
}

/**
 * Payload of `audio_level`. Emitted ~31 times a second while capture runs, so
 * this crosses the boundary more often than every other event combined.
 * Rust source: `AudioLevelPayload` in src-tauri/src/sidecar/events.rs.
 */
export interface AudioLevelWire {
  rms?: number;
  low?: number;
  mid?: number;
  high?: number;
}

/** Payload of `transcript_partial` / `transcript_final`. */
export interface TranscriptWire {
  text?: string;
  speaker?: string;
  sttLabel?: string;
}

export interface SuggestAnswerWire {
  text: string;
  speaker: string;
  type?: string;
  context_items?: ContextItemWire[];
  bullets?: ResponseBulletWire[];
}

/**
 * Argument object for `invoke('start_capture', ...)`.
 * Extends Record so it satisfies Tauri's `InvokeArgs` without a cast.
 */
export interface StartCapturePayload extends Record<string, unknown> {
  name?: string;
  context?: string;
  role?: string;
  project_id?: number;
  new_project_name?: string;
  doc_ids?: string[];
}
