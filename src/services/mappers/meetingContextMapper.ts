import { MeetingContext } from '../../shared/types';
import { StartCapturePayload } from '../wire';

/** Whitespace-only input is sent as absent rather than as an empty string. */
function toOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Domain context -> `start_capture` arguments.
 *
 * The role is flattened to its human label because the backend feeds it
 * straight into an LLM prompt, where "Technical Lead" reads better than a slug.
 */
export function toStartCapturePayload(context?: MeetingContext): StartCapturePayload {
  return {
    context: toOptionalText(context?.description),
    role: toOptionalText(context?.role?.label),
  };
}
