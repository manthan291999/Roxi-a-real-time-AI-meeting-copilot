/**
 * Port: EmbeddingGateway — text to vector.
 *
 * Separate from LlmGateway on purpose. They share a provider but nothing else:
 * different endpoint, different pricing, different failure meaning (a failed
 * embedding fails an upload; a failed completion fails an answer), and above
 * all a different budget — one large upload must not exhaust the call budget
 * belonging to the conversation it was uploaded for.
 *
 * Every returned vector is L2-normalized, which is the invariant
 * DocumentRepository relies on to treat cosine similarity as a plain dot
 * product.
 *
 * @interface EmbeddingGateway
 * @method model       @returns {string} model id, stored as provenance so a
 *                     model change can be detected and the corpus re-embedded
 * @method dimensions  @returns {number} vector length
 * @method embedBatch  @param {string[]} texts @param {{tag?: string}} [opts]
 *                     @returns {Promise<Float32Array[]>} one per input, in order
 * @method embedOne    @param {string} text @param {{tag?: string}} [opts]
 *                     @returns {Promise<Float32Array>}
 */
module.exports = {};
