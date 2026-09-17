#!/usr/bin/env node
/* eslint-disable no-console -- this IS the report: the table goes to stdout
   so it can be piped, and per-case progress goes to stderr so it does not. */
/**
 * eval-guardrail — replays every question this install has actually logged
 * through triage() and shows what would have been intercepted.
 *
 * ZERO API CALLS. Questions are not asked to the model; they are read back
 * out of llm_usage.db, where AnswerQuestionUseCase's normal operation
 * already wrote them (request_messages on every analyze_query call — see
 * analyzeQueryNode.js, which is the RAG entry node every 'rag'-mode turn
 * passes through before triage would ever run). That is what makes this
 * harness free to re-run on every token-set edit rather than something to
 * save for the end: no container, no OPENAI_API_KEY, no network — the
 * gibberish gate's corpus check is a LOCAL SQLite query (FtsCorpusProbe
 * against this install's own chat_index.db), not an API call either.
 *
 * This is the real acceptance gate for the pre-router plan (§10): "any real
 * question intercepted is a blocker, not a tuning note." There is
 * deliberately no labelled fixture to assert against — unlike
 * eval-web-search's hand-curated cases, there is no ground truth here except
 * a human's own judgement of the real questions this install has asked.
 * Read every intercepted line yourself before trusting the tally.
 *
 * KNOWN METHODOLOGY GAP — an `ack` or `greeting` intercepted here is not
 * automatically a false positive, and this harness cannot tell you which:
 * each row is replayed in ISOLATION, with no `history` and no `route`, so
 * pendingClarification.js's stand-down (see that file) NEVER fires here —
 * it has nothing to detect a pending clarification from. A bare "yes" that
 * correctly answered a real clarifying question in its ORIGINAL live
 * conversation will still show up as an `ack` interception in this report,
 * every time, because this tool has no way to reconstruct that the turn
 * before it ended in a question. That is not a defect in the guardrail —
 * the live pendingClarification path is covered end to end, WITH real
 * conversational state, by test/graph.test.js's dedicated two-turn "clarify
 * then yes" test — it is a limitation of replaying flat, standalone log
 * rows. Before flagging an ack/greeting row here as a real miss, check
 * whether the row before it (by id, in llm_usage.db) plausibly ended in a
 * clarifying question; if so, this is expected, not a regression.
 *
 * Usage:
 *   node bin/eval-guardrail.js                     full report
 *   node bin/eval-guardrail.js --dry                list extracted questions, classify nothing
 *   node bin/eval-guardrail.js --show=intercepted   only the intercepted lines
 *   node bin/eval-guardrail.js --show=passed        only the passed-through lines
 *   node bin/eval-guardrail.js --mode=direct        classify as if asked in direct mode
 *   node bin/eval-guardrail.js --no-corpus-probe    shape gate alone for gibberish (no DB read)
 *   node bin/eval-guardrail.js --limit=20           most recent N rows only
 *   node bin/eval-guardrail.js --out=report.json    where to write the report
 *   node bin/eval-guardrail.js --baseline=prev.json diff against a prior run's report
 *
 * Read the output in this order:
 *   1. Every intercepted line — is each one genuinely a greeting/help/ack/
 *      empty/gibberish turn, or did the guardrail just swallow a real
 *      question? A false positive here is the one thing that blocks this
 *      phase, whatever the tally says.
 *   2. The per-kind tally — how many of each of greeting/help/ack/gibberish/
 *      empty fired. There is no fixed target number (this install's log
 *      keeps growing), so compare against --baseline from your own last run
 *      rather than a number written into this file — a large jump either
 *      direction after a token-set or threshold edit is the signal to go
 *      re-read the diff, not to assume it is fine.
 *   3. --baseline against last run's --out file, if you want the drift
 *      called out by id rather than re-reading every line by eye.
 */

const fs = require('fs');
const Database = require('better-sqlite3');

const { loadConfig } = require('../src/config/envConfig');
const { triage } = require('../src/application/guardrail/triage');
const { MODES } = require('../src/application/graph/constants');
const { FtsCorpusProbe } = require('../src/infrastructure/persistence/FtsCorpusProbe');

/**
 * The exact trailing marker analyzeQueryNode.js appends to every user
 * message: `(historyBlock ? ... : '') + 'User question: ' + state.question`.
 * Split on the LAST occurrence rather than the first, so a question that
 * happens to quote the words "user question" earlier in its own text (or in
 * the prior-conversation block ahead of it) does not truncate the real one.
 */
const QUESTION_MARKER = 'User question: ';

function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
  };
  const show = get('show');
  return {
    dry: Boolean(get('dry')),
    mode: get('mode') === 'direct' ? MODES.DIRECT : MODES.RAG,
    limit: Number.parseInt(get('limit'), 10) || 0,
    show: show === 'intercepted' || show === 'passed' ? show : null,
    out: typeof get('out') === 'string' ? get('out') : 'guardrail-eval.json',
    baseline: typeof get('baseline') === 'string' ? get('baseline') : null,
    noCorpusProbe: Boolean(get('no-corpus-probe')),
  };
}

/**
 * Reads every historically logged RAG question straight out of the usage DB
 * the gateway already writes to — see AnswerQuestionUseCase's own
 * `this.logger.info(...)` call, which is a *separate* log from this table;
 * this table is OpenAiLlmGateway's per-call usage row (usageStore.record),
 * one per analyze_query call, which is one per RAG-mode turn.
 *
 * @returns {{id: number, ts: string, question: string}[]} oldest first
 */
function readHistoricalQuestions(usageDbPath, limit) {
  if (!fs.existsSync(usageDbPath)) {
    throw new Error(`usage DB not found at ${usageDbPath} — has this install run a chat turn yet?`);
  }
  const db = new Database(usageDbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT id, ts, request_messages FROM llm_requests
      WHERE source = 'chatbot' AND tag = 'analyze_query'
      ORDER BY id ASC
    `).all();
    const questions = [];
    for (const row of rows) {
      let messages;
      try {
        messages = JSON.parse(row.request_messages);
      } catch (err) {
        questions.push({ id: row.id, ts: row.ts, question: null, extractError: err.message });
        continue;
      }
      const userTurn = Array.isArray(messages) ? [...messages].reverse().find((m) => m.role === 'user') : null;
      if (!userTurn || typeof userTurn.content !== 'string') {
        questions.push({ id: row.id, ts: row.ts, question: null, extractError: 'no user message found' });
        continue;
      }
      const markerAt = userTurn.content.lastIndexOf(QUESTION_MARKER);
      const question = markerAt === -1 ? userTurn.content : userTurn.content.slice(markerAt + QUESTION_MARKER.length);
      questions.push({ id: row.id, ts: row.ts, question: question.trim() });
    }
    return limit > 0 ? questions.slice(-limit) : questions;
  } finally {
    db.close();
  }
}

function loadBaseline(baselinePath) {
  if (!baselinePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const byId = new Map();
    for (const r of parsed.results || []) byId.set(r.id, r.intercept);
    return byId;
  } catch (err) {
    console.error(`[eval-guardrail] could not read baseline ${baselinePath}: ${err.message}`);
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const questions = readHistoricalQuestions(config.usageDbPath, args.limit);

  if (questions.length === 0) {
    console.error('No logged analyze_query calls found — nothing to replay.');
    process.exit(2);
  }

  if (args.dry) {
    console.log(`${questions.length} historical question(s) — no classification run:\n`);
    for (const q of questions) {
      console.log(`  #${q.id}  ${q.ts}  ${q.question === null ? `[unparsed: ${q.extractError}]` : JSON.stringify(q.question)}`);
    }
    return;
  }

  const baseline = loadBaseline(args.baseline);

  // Real corpus probe by default, pointed at THIS install's own FTS index —
  // the same one a live chatbot process would use. --no-corpus-probe swaps
  // in null (shape gate alone; see triage.js's own doc comment on why an
  // absent probe is NOT the same as a probe on a genuinely empty index) for
  // isolating what the shape gate alone would catch, independent of what
  // has been indexed.
  const corpusProbe = args.noCorpusProbe ? null : new FtsCorpusProbe(config.indexDbPath);
  args.corpusProbeLabel = args.noCorpusProbe
    ? 'disabled (--no-corpus-probe) — shape gate alone'
    : `FtsCorpusProbe @ ${config.indexDbPath}`;

  let results;
  try {
    results = questions.map((q) => {
      if (q.question === null) {
        return { id: q.id, ts: q.ts, question: null, extractError: q.extractError, intercept: false, kind: null };
      }
      const decision = triage({ question: q.question, mode: args.mode }, { corpusProbe });
      return {
        id: q.id,
        ts: q.ts,
        question: q.question,
        intercept: decision.intercept,
        kind: decision.kind,
        reason: decision.reason,
      };
    });
  } finally {
    corpusProbe?.close();
  }

  report(results, args, baseline, config.usageDbPath);
}

function report(results, args, baseline, usageDbPath) {
  const intercepted = results.filter((r) => r.intercept);
  const passed = results.filter((r) => !r.intercept);
  const unparsed = results.filter((r) => r.question === null);

  const line = (s) => console.log(s);
  line('');
  line('═══ Guardrail replay ══════════════════════════════════════════');
  line('');
  line(`  source                 ${usageDbPath}`);
  line(`  questions replayed     ${results.length}`);
  line(`  mode                   ${args.mode}`);
  line(`  corpus probe           ${args.corpusProbeLabel}`);
  if (unparsed.length) line(`  unparsed rows          ${unparsed.length} (see below)`);
  line('');

  if (args.show !== 'passed') {
    line(`  intercepted (${intercepted.length}) — review every one of these by hand`);
    if (intercepted.length === 0) {
      line('    (none)');
    } else {
      const byKind = {};
      for (const r of intercepted) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      line(`    by kind: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join('  ')}`);
      line('');
      for (const r of intercepted) {
        line(`    #${String(r.id).padEnd(6)} ${r.kind.padEnd(9)} ${JSON.stringify(r.question)}`);
      }
    }
    line('');
  }

  if (args.show !== 'intercepted') {
    line(`  passed through (${passed.length})`);
    if (args.show === 'passed') {
      for (const r of passed) {
        if (r.question === null) continue;
        line(`    #${String(r.id).padEnd(6)} ${JSON.stringify(r.question)}`);
      }
      line('');
    }
  }

  if (unparsed.length) {
    line(`  unparsed (${unparsed.length}) — request_messages did not decode as expected`);
    for (const r of unparsed) line(`    #${r.id}: ${r.extractError}`);
    line('');
  }

  if (baseline) {
    const changed = results.filter((r) => baseline.has(r.id) && baseline.get(r.id) !== r.intercept);
    const added = results.filter((r) => !baseline.has(r.id));
    line(`  vs baseline (${args.baseline})`);
    line(`    classification changed   ${changed.length}`);
    line(`    new rows since baseline  ${added.length}`);
    for (const r of changed) {
      line(`      #${r.id} was ${baseline.get(r.id) ? 'intercepted' : 'passed'}, now ${r.intercept ? 'intercepted' : 'passed'} — ${JSON.stringify(r.question)}`);
    }
    line('');
  }

  line(`  tally: ${intercepted.length} intercepted / ${passed.length} passed / ${results.length} total`);
  line('  There is no fixed target number — this install\'s log grows with every real turn, so the');
  line('  right comparison is --baseline against your own last run, not a number written into this');
  line('  script. An ack/greeting row can be a correctly-standalone-classified turn that a live');
  line('  conversation\'s pendingClarification stand-down protected differently — see this file\'s own');
  line('  "KNOWN METHODOLOGY GAP" header comment before calling one a miss.');
  line('');

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    totals: { total: results.length, intercepted: intercepted.length, passed: passed.length, unparsed: unparsed.length },
    results,
  };
  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
  line(`  report written to ${args.out}`);
  line('  Keep it beside a token-set change as the "before" for --baseline on the next run.');
  line('');
}

try {
  main();
} catch (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
}
