//! `DocumentSource` over the chatbot's `doc_store.db` — strictly read-only.
//!
//! The chatbot owns this file: it parses uploads, chunks them, embeds the
//! chunks, and writes the rows. Rust opens it with `SQLITE_OPEN_READ_ONLY` so
//! that ownership is enforced by the handle rather than by discipline.
//!
//! Search is a brute-force scan, matching the chatbot's own adapter: a few
//! thousand 1,536-dimension vectors is a few million multiply-adds — single
//! digit milliseconds — and it happens **once per capture**, not once per chunk.
//! Owning a vector index or shipping a SQLite extension would buy nothing at
//! this size. Revisit past ~50k chunks.
//!
//! Vectors are stored L2-normalized, so cosine similarity is a plain dot
//! product. The query vector is normalized here for the same reason.

use crate::adapters::db_paths;
use crate::adapters::sqlite_schema::has_column;
use crate::agents::brief::model::DocExtract;
use crate::domain::project::ProjectId;
use crate::ports::document_source::DocumentSource;
use anyhow::Result;
use rusqlite::{Connection, OpenFlags};
use std::time::Duration;

/// Below this a "match" is noise. Kept in step with the chatbot's
/// `MIN_COSINE_SIMILARITY`: a brief grounded on an irrelevant passage is worse
/// than one with no reference material, because the model will use it.
const MIN_SIMILARITY: f32 = 0.25;

/// Cap on how much of one passage reaches the brief. The budget would trim it
/// anyway; truncating here keeps one 20-page chunk from starving the rest.
const MAX_CHUNK_CHARS: usize = 1200;

pub struct SqliteDocumentSource;

impl SqliteDocumentSource {
    pub fn new() -> Self {
        Self
    }

    /// `None` when there is no document store — which is the normal state of an
    /// install where nobody has uploaded anything, not an error.
    fn open(&self) -> Option<Connection> {
        let path = db_paths::doc_store_db();
        if !path.exists() {
            return None;
        }
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        let _ = conn.busy_timeout(Duration::from_secs(5));
        Some(conn)
    }

    /// The scope predicate: a shared template stays global
    /// (`project_id IS NULL`), a client contract scopes to its project.
    ///
    /// Empty when the chatbot has not applied D002 yet, which is exactly the
    /// pre-migration behaviour — documents were global.
    ///
    /// The id is interpolated rather than bound because the clause itself is
    /// conditional, and a binding that exists in one branch and not the other
    /// makes the parameter count depend on the schema. It is safe to
    /// interpolate: `ProjectId` wraps an `i64`, so there is no string to
    /// escape and nothing a caller could smuggle through.
    fn scope_clause(conn: &Connection, project: ProjectId) -> String {
        if has_column(conn, "documents", "project_id") {
            format!(
                "AND (d.project_id IS NULL OR d.project_id = {})",
                project.value()
            )
        } else {
            String::new()
        }
    }
}

impl DocumentSource for SqliteDocumentSource {
    fn count(&self, project: ProjectId) -> Result<usize> {
        let Some(conn) = self.open() else {
            return Ok(0);
        };
        let sql = format!(
            "SELECT COUNT(*) FROM document_chunks c
             JOIN documents d ON d.doc_id = c.doc_id
             WHERE d.status = 'ready' {}",
            Self::scope_clause(&conn, project)
        );
        let count: i64 = conn.query_row(&sql, [], |row| row.get(0))?;
        Ok(count as usize)
    }

    fn top_chunks(
        &self,
        project: ProjectId,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<DocExtract>> {
        let Some(conn) = self.open() else {
            return Ok(Vec::new());
        };
        let query = normalize(query_vector);
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let sql = format!(
            "SELECT d.file_name, c.page_number, c.text, c.embedding
             FROM document_chunks c
             JOIN documents d ON d.doc_id = c.doc_id
             WHERE d.status = 'ready' {}
             ORDER BY c.doc_id, c.chunk_index",
            Self::scope_clause(&conn, project)
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
            ))
        })?;

        let mut scored: Vec<DocExtract> = rows
            .filter_map(Result::ok)
            .filter_map(|(file_name, page, text, blob)| {
                let score = dot(&query, &decode_vector(&blob)?);
                if score < MIN_SIMILARITY {
                    return None;
                }
                Some(DocExtract {
                    file_name,
                    page,
                    text: truncate(&text, MAX_CHUNK_CHARS).to_string(),
                    score,
                })
            })
            .collect();

        // Sort by score, then by the citation, so two passages that tie score
        // exactly still land in a deterministic order — a coin-flip here would
        // change the prefix between captures of the same project.
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.file_name.cmp(&b.file_name))
                .then_with(|| a.page.cmp(&b.page))
        });
        scored.truncate(limit);

        Ok(scored)
    }

    fn chunks_for_documents(&self, doc_ids: &[String]) -> Result<Vec<DocExtract>> {
        let Some(conn) = self.open() else {
            return Ok(Vec::new());
        };
        if doc_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = doc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT d.file_name, c.page_number, c.text, 1.0
             FROM document_chunks c
             JOIN documents d ON d.doc_id = c.doc_id
             WHERE c.doc_id IN ({})
             ORDER BY c.doc_id, c.chunk_index",
            placeholders
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(doc_ids), |row| {
            Ok(DocExtract {
                file_name: row.get::<_, String>(0)?,
                page: row.get::<_, Option<i64>>(1)?,
                text: truncate(&row.get::<_, String>(2)?, MAX_CHUNK_CHARS).to_string(),
                score: row.get::<_, f64>(3)? as f32,
            })
        })?;

        let extracts: Vec<DocExtract> = rows.filter_map(Result::ok).collect();
        Ok(extracts)
    }
}

/// Decode a Float32LE BLOB. Returns `None` for a length that is not a whole
/// number of floats rather than reading past the end.
fn decode_vector(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.is_empty() || blob.len() % 4 != 0 {
        return None;
    }
    Some(
        blob.chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
    )
}

/// Dot product over the shared prefix. Equals cosine similarity when both
/// inputs are unit length.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn normalize(vector: &[f32]) -> Vec<f32> {
    let magnitude = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if magnitude <= f32::EPSILON {
        return Vec::new();
    }
    vector.iter().map(|v| v / magnitude).collect()
}

fn truncate(text: &str, max: usize) -> &str {
    let text = text.trim();
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_malformed_blob_is_skipped_rather_than_read_past() {
        assert!(decode_vector(&[]).is_none());
        assert!(decode_vector(&[1, 2, 3]).is_none());
        assert_eq!(decode_vector(&1.0f32.to_le_bytes()), Some(vec![1.0]));
    }

    #[test]
    fn cosine_of_a_unit_vector_with_itself_is_one() {
        let v = normalize(&[3.0, 4.0]);
        assert!((dot(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_zero_vector_normalizes_to_nothing_rather_than_nan() {
        assert!(normalize(&[0.0, 0.0]).is_empty());
    }

    #[test]
    fn mismatched_dimensions_do_not_panic() {
        assert_eq!(dot(&[1.0, 1.0], &[1.0]), 1.0);
    }
}
