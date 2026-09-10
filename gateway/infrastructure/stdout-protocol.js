/**
 * AI Meeting Interpreter — Stdout Wire Protocol
 *
 * The single definition of every message the gateway sends to the Rust host.
 * Stdout is the protocol channel; logs go to stderr (see logger.js).
 *
 * Why this module exists: these messages used to be built as inline
 * `console.log(JSON.stringify({ type: '…' }))` calls scattered across the
 * sidecar. Nothing tied them to the arms of the match in
 * `src-tauri/src/sidecar/event_router.rs`, so drift was silent — the gateway
 * emitted a `Connected` message for which Rust had no arm, and it was quietly
 * dropped by the `_ => {}` fallback for an unknown length of time.
 *
 * Every type below is asserted against that match statement by
 * test/protocol.test.js. Changing this file is one third of the three-file
 * lockstep described in CLAUDE.md (events.rs → event_router.rs → here).
 */

'use strict';

/**
 * Message types, each of which MUST have a corresponding arm in
 * event_router.rs. Adding one here without adding the arm fails the test.
 */
const EventType = Object.freeze({
  MEETING_STARTED: 'MeetingStarted',
  PARTIAL: 'Partial',
  FINAL: 'Final',
  PROVIDER_STATUS: 'ProviderStatus',
  SPEAKER_REVISION: 'SpeakerRevision',
  MEETING_SUMMARY: 'MeetingSummary',
  ERROR: 'Error',
  CHUNK_PERSISTED: 'ChunkPersisted',
});

/**
 * Write one protocol message. Serialization is centralized here so a payload
 * can never be emitted with a mistyped or unregistered `type`.
 *
 * @param {string} type    one of EventType's values
 * @param {Object} payload JSON-safe fields merged into the message
 */
function emit(type, payload = {}) {
  if (!Object.values(EventType).includes(type)) {
    // Fail loudly on stderr rather than silently shipping a message that the
    // Rust router will drop on the floor.
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        component: 'protocol',
        event: 'unknown_event_type',
        type,
      })}\n`
    );
    return;
  }
  process.stdout.write(`${JSON.stringify({ type, ...payload })}\n`);
}

// --- Typed emitters -----------------------------------------------------------
// One per message, so call sites pass named arguments rather than assembling
// object literals that only the Rust side can validate.

/**
 * The meeting row this process just inserted.
 *
 * The gateway is the sole writer of `meetings`, so this is the only way the
 * Rust host learns the id — it needs it to stamp usage rows with the meeting
 * they belong to. Nothing waits on it: the brief store keys on a Rust-side
 * session id that exists from the moment Start is pressed.
 */
const emitMeetingStarted = (meetingId, displayId, projectId) =>
  emit(EventType.MEETING_STARTED, { meetingId, displayId, projectId });

const emitPartial = (text, speaker, sttLabel) =>
  emit(EventType.PARTIAL, { text, speaker, sttLabel });

const emitFinal = (text, speaker, sttLabel, start, end) =>
  emit(EventType.FINAL, { text, speaker, sttLabel, start, end });

const emitProviderStatus = (provider, state) =>
  emit(EventType.PROVIDER_STATUS, { provider, state });

const emitSpeakerRevision = (revision) =>
  emit(EventType.SPEAKER_REVISION, { revision });

const emitMeetingSummary = (text) => emit(EventType.MEETING_SUMMARY, { text });

const emitChunkPersisted = (chunkId) => emit(EventType.CHUNK_PERSISTED, { chunkId });

const emitError = (message) => emit(EventType.ERROR, { message });

module.exports = {
  EventType,
  emit,
  emitMeetingStarted,
  emitPartial,
  emitFinal,
  emitProviderStatus,
  emitSpeakerRevision,
  emitMeetingSummary,
  emitChunkPersisted,
  emitError,
};
