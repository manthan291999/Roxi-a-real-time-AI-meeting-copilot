const db = require('../db/index.js');
const { log } = require('../infrastructure/logger.js');

function buildFallbackSummary() {
  const agg = db.getMeetingAggregates();
  const lines = [];
  lines.push('# Meeting Summary');
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

async function shutdown(reason, status, manager) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'sidecar', 'shutdown_started', { reason, status });

  const summary = buildFallbackSummary();
  const kind = 'summary';

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
