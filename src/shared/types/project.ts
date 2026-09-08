/**
 * Mirror of src-tauri/src/domain/project.rs.
 * Rule: never import from this file into Rust — the source of truth flows one way.
 */
import { UploadedDocument } from './document';

/** Newtype mirror of Rust ProjectId. Kept as number; JSON always deserializes i64 as number. */
export type ProjectId = number;

/**
 * Narrow reference: id + code + name only.
 * Hot paths (brief compiler, display-id preview) clone this, not the full Project.
 */
export interface ProjectRef {
  /** maps to projects.project_id */
  id: ProjectId;
  /** Short uppercase code, e.g. "ROXI" in "ROXI-007". */
  code: string;
  name: string;
}

/**
 * Full project row — as list_projects and create_project return it.
 * Carries description and meeting_count for the picker; ProjectRef stays narrow.
 */
export interface Project extends ProjectRef {
  description?: string;
  meeting_count: number;
  /** RFC3339. Used to sort "recent" projects above alphabetical in the picker. */
  last_used_at?: string;
  documents?: UploadedDocument[];
}

/**
 * The value the ProjectPicker produces.
 * A discriminated union — "both set" and "id + name set" are unrepresentable.
 */
export type ProjectSelection =
  | { kind: 'existing'; project: ProjectRef }
  | { kind: 'new'; name: string }
  | { kind: 'unsorted' };

/**
 * Pure function: derive a 4-letter code from a free-text name.
 * Must produce the same result as domain/project.rs::derive_code — change them together.
 */
export function deriveProjectCode(name: string): string {
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return letters || 'GEN';
}
