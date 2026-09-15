#!/usr/bin/env node
/**
 * CLI harness — test the full LangGraph chatbot against the real meeting DB.
 *
 * Usage:
 *   node bin/ask.js "what did we decide about the database?"
 *   node bin/ask.js --repl                 # interactive multi-turn chat
 *   node bin/ask.js --rebuild "question"   # force index rebuild first
 *
 * Web search (independent of retrieval):
 *   node bin/ask.js --web=auto "…"      offer the tool, let the model decide
 *   node bin/ask.js --web=always "…"    force a search (research mode)
 *   node bin/ask.js --web=never "…"     no tool at all
 *   node bin/ask.js --direct "…"        Knowledge off (model + web only)
 * Omitting --web uses CHATBOT_WEB_SEARCH_MODE (default 'auto'). 'always' is
 * reachable here and over the protocol; the UI exposes only auto/never.
 */

const { buildContainer } = require('../src/composition/container');
const { askOnce, startRepl } = require('../src/transport/cliRepl');

async function main() {
  const args = process.argv.slice(2);
  const repl = args.includes('--repl');
  const rebuild = args.includes('--rebuild');
  const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  const webArg = args.find((a) => a.startsWith('--web'));
  // --web on its own means 'auto'; --web=x passes x through to be validated
  // in the use case, so the CLI and the sidecar share one rule.
  const webMode = webArg ? (webArg.includes('=') ? webArg.split('=')[1] : 'auto') : undefined;
  const mode = args.includes('--direct') ? 'direct' : undefined;
  const opts = { webMode, mode };

  const container = buildContainer();

  // Make sure the FTS index exists / is fresh before asking.
  const res = rebuild
    ? container.indexBuilder.rebuild(container.store)
    : container.indexBuilder.rebuildIfStale(container.store, { maxAgeMs: container.config.indexMaxAgeMs });
  if (res.rebuilt) {
    process.stderr.write(`[index] rebuilt (${res.reason}): ${res.stats.corpusCount} rows, ${res.stats.meetingCount} meetings in ${res.stats.durationMs}ms\n`);
  } else {
    process.stderr.write('[index] fresh — no rebuild needed\n');
  }

  if (repl) {
    await startRepl(container, opts);
    return;
  }
  if (!question) {
    console.error('Usage: node bin/ask.js "your question"   |   node bin/ask.js --repl');
    container.shutdown();
    process.exit(2);
  }

  try {
    await askOnce(container, question, 'cli', opts);
  } finally {
    container.shutdown();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
