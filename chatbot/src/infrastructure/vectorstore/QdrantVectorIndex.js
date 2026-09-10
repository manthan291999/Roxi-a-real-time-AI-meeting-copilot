/**
 * QdrantVectorIndex — VectorIndex adapter over Qdrant's REST API.
 *
 * Uses Node's built-in `fetch` (Node 20+, already the project's floor) rather
 * than adding an HTTP client dependency for what is three plain JSON calls.
 *
 * Collection creation is deliberately NOT here: Rust's vector_client.rs
 * ensures both collections exist at app startup (Phase 1). This adapter only
 * ever reads/writes points into a collection it assumes already exists —
 * mirrors how DocumentEvidenceSource never creates doc_store.db's schema.
 */

const { StoreError } = require('../../domain/errors');

class QdrantVectorIndex {
  /**
   * @param {{baseUrl: string, collection: string, logger?: Object}} opts
   */
  constructor({ baseUrl, collection, logger = null }) {
    this.baseUrl = baseUrl;
    this.collection = collection;
    this.logger = logger;
  }

  /**
   * @param {{id: number|string, vector: number[], payload: Object}[]} points
   * @returns {Promise<void>}
   */
  async ensureCollection(collectionName = this.collection) {
    try {
      const res = await fetch(`${this.baseUrl}/collections/${collectionName}`);
      if (res.status === 200) {
        return; // Already exists
      }
      
      const createRes = await fetch(`${this.baseUrl}/collections/${collectionName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: { size: 1536, distance: "Cosine" },
          hnsw_config: { m: 16, ef_construct: 128 }
        })
      });
      
      if (!createRes.ok) {
        const text = await createRes.text();
        throw new Error(`Failed to create collection: ${createRes.status} ${text}`);
      }
      
      // Create indexes for episodic memory if this is the episodic collection
      if (collectionName === 'roxi_episodic_memory') {
        const indexes = [
          { field_name: "meeting_id", field_schema: "integer" },
          { field_name: "project_id", field_schema: "integer" },
          { field_name: "speaker", field_schema: "keyword" },
          { field_name: "significance", field_schema: "keyword" },
          { field_name: "meeting_start_time", field_schema: "datetime" },
          { field_name: "created_at", field_schema: "datetime" }
        ];
        
        for (const idx of indexes) {
          await fetch(`${this.baseUrl}/collections/${collectionName}/index`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(idx)
          });
        }
      }
      // Create indexes for semantic memory
      else if (collectionName === 'roxi_semantic_memory') {
        const indexes = [
          { field_name: "source_table", field_schema: "keyword" },
          { field_name: "project_id", field_schema: "integer" }
        ];
        for (const idx of indexes) {
          await fetch(`${this.baseUrl}/collections/${collectionName}/index`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(idx)
          });
        }
      }
      
    } catch (err) {
      throw new Error(`ensureCollection failed: ${err.message}`);
    }
  }

  async upsertBatch(points) {
    if (!Array.isArray(points) || points.length === 0) return;

    // wait=true: the caller (SyncEpisodicMemoryUseCase) advances its
    // high-water mark immediately after this resolves, so the write must be
    // durable before that happens — an async-queued upsert that later failed
    // would silently skip chunks on the next sync.
    const url = `${this.baseUrl}/collections/${this.collection}/points?wait=true`;
    // Vectors commonly arrive as Float32Array (every EmbeddingGateway
    // implementation returns one) rather than a plain array. JSON.stringify
    // serializes a typed array as {"0":..,"1":..} — an indexed object, not a
    // JSON array — which Qdrant rejects. Normalize here, once, rather than
    // requiring every caller to remember Array.from().
    const jsonSafePoints = points.map((p) => ({ ...p, vector: Array.from(p.vector) }));
    let res;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: jsonSafePoints }),
      });
    } catch (err) {
      throw new StoreError(`Qdrant upsert request failed: ${err.message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new StoreError(`Qdrant upsert failed: ${res.status} ${text}`.trim());
    }

    this.logger?.debug('vectorstore', 'upsert_ok', {
      collection: this.collection,
      count: points.length,
    });
  }

  /**
   * @param {number[]} vector
   * @param {{limit: number, minSimilarity?: number, filter?: {projectId?: number|null}}} opts
   * @returns {Promise<import('../../domain/ports/VectorIndex').VectorHit[]>}
   */
  async search(vector, { limit = 24, minSimilarity = 0, filter = {} } = {}) {
    const body = {
      // Same normalization as upsertBatch — see its comment.
      vector: Array.from(vector),
      limit,
      score_threshold: minSimilarity,
      with_payload: true,
    };
    const qdrantFilter = toQdrantFilter(filter);
    if (qdrantFilter) body.filter = qdrantFilter;

    const url = `${this.baseUrl}/collections/${this.collection}/points/search`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new StoreError(`Qdrant search request failed: ${err.message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new StoreError(`Qdrant search failed: ${res.status} ${text}`.trim());
    }

    const data = await res.json();
    const results = Array.isArray(data.result) ? data.result : [];
    return results.map((r) => ({ id: r.id, similarity: r.score, payload: r.payload || {} }));
  }

  /**
   * Delete every point matching a filter — used by PurgeEpisodicMemoryUseCase
   * for the 90-day retention window (plan §05a). Qdrant's delete-by-filter
   * response carries an operation status, not a point count, so this counts
   * matching points first (exact count) and deletes them in a second call —
   * two round trips, fine for a job that runs at most once a day.
   * @param {{must: Array<{key:string, range?:Object, match?:Object}>}} filter
   * @returns {Promise<{deleted:number}>}
   */
  async deleteWhere(filter) {
    let deleted = 0;
    try {
      const countRes = await fetch(`${this.baseUrl}/collections/${this.collection}/points/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, exact: true }),
      });
      if (countRes.ok) {
        const data = await countRes.json();
        deleted = data?.result?.count ?? 0;
      }
    } catch (err) {
      throw new StoreError(`Qdrant count request failed: ${err.message}`);
    }

    if (deleted === 0) return { deleted: 0 };

    let res;
    try {
      res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/delete?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter }),
      });
    } catch (err) {
      throw new StoreError(`Qdrant delete request failed: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new StoreError(`Qdrant delete failed: ${res.status} ${text}`.trim());
    }

    this.logger?.debug('vectorstore', 'delete_where_ok', { collection: this.collection, deleted });
    return { deleted };
  }
}

/**
 * Only `projectId` is wired today — the one scope EvidenceSource's contract
 * currently names. Unscoped (null/omitted) means search everything, matching
 * how DocumentEvidenceSource treats an absent projectId.
 * @private
 */
function toQdrantFilter({ projectId } = {}) {
  if (projectId === null || projectId === undefined) return null;
  return { must: [{ key: 'project_id', match: { value: projectId } }] };
}

module.exports = { QdrantVectorIndex };
