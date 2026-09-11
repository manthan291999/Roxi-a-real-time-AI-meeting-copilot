import { SpeakerRevision } from '../../shared/types';
import { SpeakerRevisionWire } from '../wire';

/**
 * Wire payload -> speaker revisions.
 *
 * The Rust router forwards this one verbatim as whatever JSON the gateway sent
 * (`Option<serde_json::Value>`), so unlike the other mappers this one cannot
 * assume it received an array at all — a provider that emits nothing leaves it
 * null. Anything that is not a usable correction is dropped rather than
 * rendered, since applying a half-formed revision would relabel a line with
 * `undefined`.
 */
export function toSpeakerRevisions(payload: SpeakerRevisionWire[] | null | undefined): SpeakerRevision[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .filter(
      (r): r is SpeakerRevisionWire =>
        !!r && typeof r.turnOrder === 'number' && typeof r.speaker === 'string' && r.speaker !== ''
    )
    .map((r) => ({ turnOrder: r.turnOrder, sttLabel: r.speaker }));
}
