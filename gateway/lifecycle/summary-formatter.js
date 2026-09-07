/**
 * AI Meeting Interpreter — Fallback Summary Formatter
 *
 * Turns persisted meeting aggregates into the markdown summary shown when the
 * session ends. Pure presentation: it takes an aggregates object and returns a
 * string, with no knowledge of SQLite or the shutdown sequence. (It previously
 * lived inside shutdown.js, which coupled process teardown to markdown.)
 */

'use strict';

/**
 * @param {{topic: ?string, chunkCount: number, speakers: Array, decisions: Array,
 *          actionItems: Array, risks: Array}} agg
 * @returns {string} markdown
 */
function buildFallbackSummary(agg) {
  const lines = ['# Meeting Summary', ''];

  if (agg.topic) lines.push(`**Topic:** ${agg.topic}`);
  lines.push(`**Chunks analyzed:** ${agg.chunkCount}`);

  if (agg.speakers && agg.speakers.length > 0) {
    lines.push('', '## Participants');
    for (const s of agg.speakers) {
      lines.push(`- ${s.speaker} (${s.chunk_count} contributions)`);
    }
  }

  if (agg.decisions && agg.decisions.length > 0) {
    lines.push('', '## Decisions Made');
    for (const d of agg.decisions) lines.push(`- ${d}`);
  }

  if (agg.actionItems && agg.actionItems.length > 0) {
    lines.push('', '## Action Items');
    for (const a of agg.actionItems) {
      const who = a.assignee ? ` (${a.assignee})` : '';
      const due = a.deadline ? ` — due ${a.deadline}` : '';
      lines.push(`- ${a.description}${who}${due}`);
    }
  }

  if (agg.risks && agg.risks.length > 0) {
    lines.push('', '## Risks & Concerns');
    for (const r of agg.risks) {
      lines.push(`- [${(r.severity || 'unknown').toUpperCase()}] ${r.category || 'GENERAL'}: ${r.text}`);
    }
  }

  return lines.join('\n');
}

module.exports = { buildFallbackSummary };
