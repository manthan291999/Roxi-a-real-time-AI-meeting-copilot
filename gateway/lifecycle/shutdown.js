const db = require('../db/index.js');
const { generateMeetingSummary } = require('../pipeline/agent-orchestrator.js');
const { log } = require('../infrastructure/logger.js');

const SUMMARY_DEADLINE_MS = 12000;

function buildFallbackSummary() {
  const agg = db.getMeetingAggregates();
  const lines = [];
  lines.push('# Meeting Summary (auto-generated fallback)');
  lines.push('');
  lines.push('_The AI summary service was unavailable; this summary was compiled from captured artifacts._');
  lines.push('');
  if (agg.topic) lines.push(`**Topic:** ${agg.topic}`);
  lines.push(`**Chunks analyzed:** ${agg.chunkCount}`);
  if (agg.speakers && agg.speakers.length > 0) {
    lines.push('');
    lines.push('## Participants');
    agg.speakers.forEach((s) => lines.push(`- ${s.speaker} (${s.chunk_count} contributions)`));
  }
  if (agg.decisions && agg.decisions.length > 0) {
    lines.push('');
    lines.push('## Decisions Made');
    agg.decisions.forEach((d) => lines.push(`- ${d}`));
  }
  if (agg.actionItems && agg.actionItems.length > 0) {
    lines.push('');
    lines.push('## Action Items');
    agg.actionItems.forEach((a) => {
      const who = a.assignee ? ` (${a.assignee})` : '';
      const due = a.deadline ? ` — due ${a.deadline}` : '';
      lines.push(`- ${a.description}${who}${due}`);
    });
  }
  if (agg.risks && agg.risks.length > 0) {
    lines.push('');
    lines.push('## Risks & Concerns');
    agg.risks.forEach((r) => lines.push(`- [${(r.severity || 'unknown').toUpperCase()}] ${r.category || 'GENERAL'}: ${r.text}`));
  }
  return lines.join('\n');
}

let shuttingDown = false;

async function shutdown(reason, status, manager, semanticBuffer) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'sidecar', 'shutdown_started', { reason, status });

  try {
    await semanticBuffer.drain();
  } catch (err) {
    log('error', 'sidecar', 'shutdown_flush_failed', { message: (err.message || '').slice(0, 200) });
  }

  let summary = null;
  let kind = 'executive';
  let summaryTimer = null;
  try {
    const deadline = new Promise((resolve) => {
      summaryTimer = setTimeout(() => resolve(null), SUMMARY_DEADLINE_MS);
    });
    summary = await Promise.race([generateMeetingSummary(), deadline]);
  } catch (err) {
    log('error', 'sidecar', 'summary_error', { message: (err.message || '').slice(0, 200) });
  } finally {
    if (summaryTimer) clearTimeout(summaryTimer);
  }
  if (!summary) {
    summary = buildFallbackSummary();
    kind = 'fallback_template';
    log('warn', 'sidecar', 'summary_fallback_used', {});
  }

  console.log(JSON.stringify({ type: 'MeetingSummary', text: summary }));

  try {
    await db.endMeeting(summary, status, kind);
  } catch (err) {
    log('error', 'sidecar', 'end_meeting_error', { message: (err.message || '').slice(0, 200) });
  }

  try { await manager.close(); } catch (_) { }

  log('info', 'sidecar', 'shutdown_complete', { reason });
  process.exit(status === 'ended' ? 0 : 1);
}

module.exports = { shutdown };
