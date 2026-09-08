/**
 * AI Meeting Interpreter — Project Repository
 *
 * Resolves the project a meeting belongs to and allocates its per-project
 * sequence number.
 *
 * ## Why the sequence lives here and not in Rust
 *
 * `project_seq` is `MAX(project_seq) + 1` for that project, and it has to be
 * computed in the same transaction as the meeting insert or two concurrent
 * captures can allocate the same number. This is the process that inserts the
 * meeting row, so this is the only place that can do it safely.
 * `better-sqlite3` is synchronous, so a transaction is enough — no extra
 * locking, and no sequence lock held across a modal.
 *
 * The Rust host resolves *which* project (it owns the picker and the `projects`
 * table) and passes the id down as `--project-id`. This module trusts that id
 * but verifies it exists, because a stale id must file the meeting under
 * `Unsorted` rather than write a dangling foreign key.
 *
 * Never throws — a project failure must degrade to `Unsorted`, never cost the
 * meeting.
 */

'use strict';

const { log } = require('../infrastructure/logger.js');

/** The bucket every un-filed meeting lands in. Created by migration M008. */
const DEFAULT_PROJECT_CODE = 'GEN';

/**
 * Format a display id: `ROXI-007`.
 *
 * This format is also implemented in `src/features/capture/context-intake`
 * for the modal's live preview. That copy is a *preview* and reserves nothing;
 * this one is what gets written. If they drift, the preview is wrong — which is
 * cosmetic — so the duplication is deliberate rather than shared across a
 * process boundary just to be shared.
 */
function formatDisplayId(code, seq) {
  return `${String(code).toUpperCase()}-${String(seq).padStart(3, '0')}`;
}

class ProjectRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.stmts = {
      byId: db.prepare('SELECT project_id, code, name FROM projects WHERE project_id = ?'),
      byCode: db.prepare('SELECT project_id, code, name FROM projects WHERE code = ?'),
      nextSeq: db.prepare(
        'SELECT COALESCE(MAX(project_seq), 0) + 1 AS next FROM meetings WHERE project_id = ?'
      ),
    };
  }

  /**
   * Resolve the project for a capture.
   *
   * @param {{id?: number|null, code?: string|null}} [selection]
   * @returns {{projectId: number, code: string, name: string}|null} null only if
   *   even `Unsorted` is missing, which means the schema is broken — the caller
   *   then writes a meeting with a null `project_id`, exactly as before M008.
   */
  resolve(selection = {}) {
    const id = Number(selection.id);
    if (Number.isInteger(id) && id > 0) {
      const row = this.stmts.byId.get(id);
      if (row) return toProject(row);
      log('warn', 'db', 'project_not_found', { projectId: id });
    }
    return this.unsorted();
  }

  /** @returns {{projectId: number, code: string, name: string}|null} */
  unsorted() {
    const row = this.stmts.byCode.get(DEFAULT_PROJECT_CODE);
    if (row) return toProject(row);
    log('error', 'db', 'default_project_missing', { code: DEFAULT_PROJECT_CODE });
    return null;
  }

  /**
   * The next sequence number for a project.
   *
   * MUST be called inside the transaction that inserts the meeting.
   *
   * @param {number} projectId
   * @returns {number}
   */
  nextSeq(projectId) {
    return this.stmts.nextSeq.get(projectId).next;
  }
}

function toProject(row) {
  return { projectId: row.project_id, code: row.code, name: row.name };
}

module.exports = { ProjectRepository, formatDisplayId, DEFAULT_PROJECT_CODE };
