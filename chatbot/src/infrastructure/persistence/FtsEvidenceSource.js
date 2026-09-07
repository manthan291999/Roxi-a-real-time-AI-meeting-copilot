/**
 * FtsEvidenceSource — EvidenceSource adapter over the existing FtsRetriever.
 *
 * A thin translation layer, deliberately: FtsRetriever is shipped, tested and
 * still needed by respondNoDataNode for recentTopics(), so it is NOT modified.
 * This wraps it to speak the EvidenceSource contract, stamping the two fields
 * the composite and the citation layer need — sourceType and groupKey.
 */

'use strict';

class FtsEvidenceSource {
  /**
   * @param {import('../../domain/ports/Retriever').Retriever} retriever
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [logger]
   */
  constructor(retriever, logger = null) {
    this.name = 'meetings';
    this.retriever = retriever;
    this.logger = logger;
  }

  /**
   * Lexical search, so only matchExprs is used; `question` is ignored because
   * FTS5 MATCH cannot take natural language.
   *
   * @param {{matchExprs: string[], limit: number}} query
   * @returns {Promise<import('../../domain/ports/EvidenceSource').EvidenceHit[]>}
   */
  async search({ matchExprs = [], limit = 24 } = {}) {
    if (!Array.isArray(matchExprs) || matchExprs.length === 0) return [];

    // FtsRetriever.search is synchronous; the port is async because a sibling
    // source has to make a network call to embed the question.
    const hits = this.retriever.search(matchExprs, { limit });

    return hits.map((hit) => ({
      ...hit,
      sourceType: 'meeting',
      groupKey: `meeting:${hit.meetingId}`,
    }));
  }
}

module.exports = { FtsEvidenceSource };
