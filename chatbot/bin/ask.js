#!/usr/bin/env node
/**
 * CLI harness — test the full LangGraph chatbot against the real meeting DB.
 *
 * Usage:
 *   node bin/ask.js "what did we decide about the database?"
 *   node bin/ask.js --repl                 # interactive multi-turn chat
 *   node bin/ask.js --rebuild "question"   # force index rebuild first
 */

const { buildContainer } = require('../src/composition/container');
const { askOnce, startRepl } = require('../src/transport/cliRepl');

async function main() {
  const args = process.argv.slice(2);
  const repl = args.includes('--repl');
  const rebuild = args.includes('--rebuild');
  const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();

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
    await startRepl(container);
    return;
  }
  if (!question) {
    console.error('Usage: node bin/ask.js "your question"   |   node bin/ask.js --repl');
    container.shutdown();
    process.exit(2);
  }

  try {
    await askOnce(container, question);
  } finally {
    container.shutdown();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
