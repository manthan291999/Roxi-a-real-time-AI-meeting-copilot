'use strict';

/**
 * PurgeEpisodicMemoryUseCase — enforces the 90-day retention window on
 * `roxi_episodic_memory` (plan §01/§05a). Episodic memory is a searchable
 * COPY of `chunks`, not the source of truth, so this only ever removes
 * Qdrant points — meeting_history.db is never touched. A purged chunk simply
 * stops being semantically searchable; it stays fully present in lexical
 * search and the meeting's own transcript view, and is re-embeddable by a
 * future backfill if the window is ever widened.
 *
 * `roxi_semantic_memory` (glossary/speaker knowledge) is explicitly exempt —
 * a definition doesn't get less true with age, so nothing there expires on
 * a clock.
 */
class PurgeEpisodicMemoryUseCase {
  /**
   * @param {Object} deps
   * @param {import('../../domain/ports/VectorIndex').VectorIndex} deps.vectorIndex episodic collection only
   * @param {number} [deps.retentionDays]
   * @param {import('../../domain/ports/ChatLogger').ChatLogger} [deps.logger]
   */
  constructor({ vectorIndex, retentionDays = 90, logger = null }) {
    this.vectorIndex = vectorIndex;
    this.retentionDays = retentionDays;
    this.logger = logger;
  }

  async execute() {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000).toISOString();
    const { deleted } = await this.vectorIndex.deleteWhere({
      must: [{ key: 'created_at', range: { lt: cutoff } }],
    });
    if (deleted > 0) {
      this.logger?.info('purge', 'episodic_purged', { cutoff, deleted });
    }
    return { deleted };
  }
}

module.exports = { PurgeEpisodicMemoryUseCase };
