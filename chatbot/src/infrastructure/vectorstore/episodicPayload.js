/**
 * Pure mapping: a ChunkRecord -> (embedded text, Qdrant payload).
 *
 * Kept pure and dependency-free like rrf.js/evidence.js — no DB, no network,
 * so its behavior can be asserted directly. See the Meeting Semantic Memory
 * plan §05 for the field-by-field rationale.
 */

'use strict';

/** Payload shape version — bump when a field is added/renamed (§05). */
const SCHEMA_VERSION = 1;

/** significance -> importance, the numeric form compositeScore() uses (§05). */
const SIGNIFICANCE_TO_IMPORTANCE = { low: 0.3, medium: 0.6, high: 1.0 };

/** Absent/malformed significance defaults to 'medium' — same convention the
 * Rust ChunkState already uses for a missing complexity field. */
const DEFAULT_SIGNIFICANCE = 'medium';

/** The user's meeting briefing is capped before it reaches the embedding or
 * the payload, so one verbose brief cannot dominate every chunk's vector. */
const MEETING_CONTEXT_MAX_CHARS = 300;

function normalizedSignificance(raw) {
  const value = String(raw || '').toLowerCase();
  return SIGNIFICANCE_TO_IMPORTANCE[value] !== undefined ? value : DEFAULT_SIGNIFICANCE;
}

function truncatedContext(meetingContext) {
  const trimmed = String(meetingContext || '').trim();
  return trimmed ? trimmed.slice(0, MEETING_CONTEXT_MAX_CHARS) : null;
}

/**
 * The string actually sent to the embedding API. Prepending the meeting
 * context gives the embedding a scrap of situating context beyond the bare
 * line (§05) — without it, "yes, let's do that" embeds identically across
 * every meeting that ever said it.
 * @param {import('../../domain/ports/ChunkStore').ChunkRecord} chunk
 * @returns {string}
 */
function textToEmbed(chunk) {
  const context = truncatedContext(chunk.meetingContext);
  return context ? `${context}\n\n${chunk.text}` : chunk.text;
}

/**
 * @param {import('../../domain/ports/ChunkStore').ChunkRecord} chunk
 * @param {string} embeddedText the exact string that was embedded (for char_count)
 * @param {{embedModel: string, embedDims: number}} provenance
 * @returns {Object} Qdrant payload, per plan §05
 */
function toEpisodicPayload(chunk, embeddedText, { embedModel, embedDims }) {
  const significance = normalizedSignificance(chunk.significance);
  return {
    schema_version: SCHEMA_VERSION,
    embed_model: embedModel,
    embed_dims: embedDims,
    source_table: 'chunks',
    meeting_id: chunk.meetingId,
    project_id: chunk.projectId ?? null,
    display_id: chunk.displayId ?? null,
    chunk_seq: chunk.chunkSeq,
    speaker: chunk.speaker || '',
    topic: chunk.topic || null,
    significance,
    importance: SIGNIFICANCE_TO_IMPORTANCE[significance],
    linked_decision_ids: chunk.linkedDecisionIds || [],
    linked_risk_ids: chunk.linkedRiskIds || [],
    linked_action_item_ids: chunk.linkedActionItemIds || [],
    meeting_context: truncatedContext(chunk.meetingContext),
    meeting_start_time: chunk.meetingStartTime,
    // The clock the recency term (§05) uses is "since spoken", i.e. when the
    // chunk itself was created — NOT when this sync ran. Using sync time
    // would make every backfilled chunk read as spoken "just now".
    created_at: chunk.createdAt,
    char_count: embeddedText.length,
  };
}

module.exports = {
  textToEmbed,
  toEpisodicPayload,
  SCHEMA_VERSION,
  SIGNIFICANCE_TO_IMPORTANCE,
  MEETING_CONTEXT_MAX_CHARS,
};
