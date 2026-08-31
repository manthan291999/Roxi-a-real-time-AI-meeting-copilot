#!/usr/bin/env node
/**
 * Index maintenance tool — rebuilds the chatbot's FTS index from the meeting
 * DB. Needs no API key (skipLlm), so it never touches LLM config.
 *
 * Usage: node bin/rebuild-index.js [--verify]
 */

const { buildContainer } = require('../src/composition/container');

function main() {
  const verify = process.argv.includes('--verify');
  const container = buildContainer({ skipLlm: true });

  try {
    const stats = container.indexBuilder.rebuild(container.store);
    console.log(`✔ Index rebuilt: ${stats.corpusCount} rows, ${stats.meetingCount} meetings (${stats.durationMs}ms)`);
    console.log(`  index db: ${container.config.indexDbPath}`);
    console.log(`  meeting db: ${container.config.meetingDbPath} (read-only)`);

    if (verify) {
      // Smoke-test retrieval so a broken index fails loudly here, not at chat time.
      const hits = container.retriever.search(['meeting'], { limit: 3 });
      console.log(`✔ Verify: sample search returned ${hits.length} hit(s)`);
      if (hits.length === 0 && stats.corpusCount > 0) {
        throw new Error('Index has rows but sample search returned nothing');
      }
    }
  } finally {
    container.shutdown();
  }
}

try {
  main();
} catch (err) {
  console.error('✖', err.message);
  process.exit(1);
}
