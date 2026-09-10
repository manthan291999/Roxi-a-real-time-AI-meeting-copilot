/**
 * Port: VectorIndex — a Qdrant collection.
 *
 * @typedef {Object} VectorHit
 * @property {number|string} id
 * @property {number} similarity   Qdrant's returned score. For a Cosine-
 *   distance collection this IS the cosine similarity, already comparable to
 *   MIN_COSINE_SIMILARITY the same way DocumentEvidenceSource's is.
 * @property {Object} payload
 *
 * @interface VectorIndex
 * @method upsertBatch  @param {{id: number|string, vector: number[], payload: Object}[]} points
 *                       @returns {Promise<void>}
 * @method search
 *   @param {number[]} vector
 *   @param {{limit: number, minSimilarity?: number, filter?: {projectId?: number|null}}} opts
 *     `filter.projectId`: omit/null for unscoped search. Sources that cannot
 *     honour a filter must ignore it rather than fail (same rule EvidenceSource
 *     itself states for `query.projectId`).
 *   @returns {Promise<VectorHit[]>} sorted best-first
 */
module.exports = {};
