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
  let project_id: number | undefined;
  let new_project_name: string | undefined;

  if (context?.project?.kind === 'existing') {
    project_id = context.project.project.id;
  } else if (context?.project?.kind === 'new') {
    new_project_name = context.project.name;
  }
  // kind === 'unsorted' → both undefined → Rust uses GEN bucket

  return {
    name: toOptionalText(context?.name),
    context: toOptionalText(context?.description),
    role: toOptionalText(context?.role?.label),
    project_id,
    new_project_name,
    doc_ids: context?.docIds?.length ? context.docIds : undefined,
  };
}
