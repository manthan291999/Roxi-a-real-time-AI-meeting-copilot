#!/usr/bin/env node

const { buildContainer } = require('../src/composition/container');

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const episodic = args.includes('--episodic');
  const semantic = args.includes('--semantic');
  
  if (!episodic && !semantic) {
    console.error('Usage: node chatbot/bin/sync-vectors.js [--force] [--episodic] [--semantic]');
    process.exit(1);
  }

  const container = buildContainer();
  const { syncEpisodicMemory, syncSemanticMemory, vectorIndex, store, logger } = container;

  if (!syncEpisodicMemory && !syncSemanticMemory) {
    console.error('Vector sync not configured (Qdrant dependencies missing)');
    process.exit(1);
  }

  console.log('Ensuring Qdrant collections exist...');
  await vectorIndex.ensureCollection('roxi_episodic_memory');
  await vectorIndex.ensureCollection('roxi_semantic_memory');

  try {
    if (episodic && syncEpisodicMemory) {
      console.log(`Starting episodic vector sync (force: ${force})`);
      const stats = await syncEpisodicMemory.execute({ force });
      console.log(`Episodic sync complete. Embedded ${stats.embedded} chunks.`);
    }

    if (semantic && syncSemanticMemory) {
      console.log(`Starting semantic vector sync (force: ${force})`);
      const stats = await syncSemanticMemory.execute();
      console.log(`Semantic sync complete. Embedded ${stats.embedded} terms.`);
    }

    process.exit(0);
  } catch (error) {
    console.error(`Sync failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
