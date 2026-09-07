import { TxLine } from '../../shared/types';
import { TranscriptWire } from '../wire';

/**
 * Wire payload -> transcript line.
 *
 * The Rust router sends only { text, speaker, sttLabel } (sidecar/events.rs
 * TranscriptPayload), but TxLine also needs an id, a timestamp, the partial
 * flag and a speaker index. Casting the payload straight to TxLine left all
 * four undefined, so every line rendered "NaN:NaN AM", partials were styled
 * identically to finals, and every speaker got colors[0].
 *
 * Pure apart from the two module-level counters, so it is unit-testable
 * without Tauri — same shape as suggestCardMapper.
 */

/** Stable per-speaker index so each voice keeps one colour for the session. */
const speakerIndex = new Map<string, number>();

function indexFor(sttLabel: string): number {
  let idx = speakerIndex.get(sttLabel);
  if (idx === undefined) {
    idx = speakerIndex.size;
    speakerIndex.set(sttLabel, idx);
  }
  return idx;
}

let seq = 0;

export function toTxLine(
  wire: TranscriptWire,
  partial: boolean,
  receivedAt: number = Date.now(),
): TxLine {
  // sttLabel is the stable identity the gateway's diarization layer keys on.
  // Fall back to the resolved name only when the host omitted it.
  const sttLabel = wire.sttLabel ?? wire.speaker ?? 'Speaker';

  return {
    // One partial per speaker is displayed at a time, so a per-speaker key is
    // stable across the word-by-word updates that replace it.
    id: partial ? `p_${sttLabel}` : `t_${receivedAt}_${seq++}`,
    speaker: wire.speaker ?? sttLabel,
    sttLabel,
    text: wire.text ?? '',
    // Arrival time, deliberately not the provider's offset: AssemblyAI reports
    // turn.start in milliseconds and Speechmatics metadata.start_time in
    // seconds, both relative to session start, while the UI renders a
    // wall-clock time. Plumbing those through would move two incompatible
    // units into the frontend.
    time: receivedAt,
    partial,
    speakerIdx: indexFor(sttLabel),
  };
}
