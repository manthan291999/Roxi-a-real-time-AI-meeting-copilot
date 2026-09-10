/**
 * stdioSidecar — transport boundary for the Tauri/Rust integration.
 *
 * Protocol (line-delimited JSON):
 *   stdin  -> {"type":"Ask","question":"...","threadId":"...","history":[...],"liveContext":"..."}
 *             liveContext: recent lines from the meeting currently being
 *             recorded, if any — covers the gap before those lines are
 *             indexed into chat_index.db. Optional, omitted when idle.
 *             {"type":"UploadDocument","docId":"uuid","filePath":"/abs/spec.pdf","fileName":"spec.pdf"}
 *             {"type":"ListDocuments"}
 *             {"type":"DeleteDocument","docId":"uuid"}
 *             {"type":"RebuildIndex","force":false}
 *             {"type":"SyncVectors","force":false}
 *             {"type":"Shutdown"}
 *   stdout <- {"type":"Ready"}
 *             {"type":"ChatThinking","threadId":"ask","node":"retrieve"}
 *             {"type":"ChatReply","threadId":"ask","payload":{...}}
 *             {"type":"DocumentProgress","docId":"…","phase":"parse|chunk|embed|store","done":128,"total":200}
 *             {"type":"DocumentReady","docId":"…","fileName":"spec.pdf","chunkCount":200,"pageCount":42}
 *             {"type":"DocumentList","docs":[{…}]}
 *             {"type":"DocumentDeleted","docId":"…"}
 *             {"type":"IndexRebuilt","stats":{...}}
 *             {"type":"VectorsSynced","stats":{"embedded":12,"highWaterMark":247}}
 *             {"type":"Error","threadId":"ask","message":"...","code":"..."}
 *             {"type":"Bye"}
 *
 * Episodic memory sync (Meeting Semantic Memory §09) runs automatically —
 * once at startup and then every config.episodicSyncMaxAgeMs — as well as on
 * explicit SyncVectors. Semantic memory sync (glossary terms, §06/§08) runs
 * on its own, much slower cadence (config.semanticSyncMaxAgeMs) since
 * glossary terms change far more slowly than chunks arrive — it is NOT tied
 * to the episodic timer. The automatic runs are fire-and-forget: unlike the
 * FTS rebuild above, embedding is a network call, so blocking Ready on it (or
 * surfacing its failures as protocol Errors nobody asked for) would be wrong.
 * SyncVectors exists for the same reason RebuildIndex does: an explicit,
 * correlatable way to ask for the same work on demand — it runs whichever of
 * the two syncs are configured, together, on request.
 *
 * Episodic retention (plan §05a) runs as a third, independent background job:
 * PurgeEpisodicMemoryUseCase on config.episodicPurgeIntervalMs (default
 * daily). It only ever removes Qdrant points past the retention window —
 * meeting_history.db is never touched — so it has no busy-lane interaction
 * with the two syncs above and no SyncVectors-style on-demand trigger.
 *
 * Every response to an Ask echoes its threadId. The host fans these out as
 * global Tauri events, so without it a UI with more than one thread appends
 * every answer to all of them. threadId is omitted only where it genuinely is
 * not known (malformed stdin, unknown message type). Document messages carry
 * docId instead — they belong to a file, not to a conversation.
 *
 * Concurrency: two independent lanes, askBusy and docBusy. A single flag would
 * make a question asked during a 30-second upload fail with BUSY, which is
 * exactly when someone wants to ask about the document they just added.
 * better-sqlite3 is synchronous and the doc store is its own file, so the
 * lanes cannot interleave a write; the lock is only about serializing each
 * kind of request against itself.
 *
 * stdout carries ONLY protocol messages; logs go to stderr via the logger.
 */

const readline = require('readline');
const { ChatbotError } = require('../domain/errors');

/** Friendly labels for ChatThinking events (UI-side mapping lives in React). */
function startStdioSidecar(container, io = {}) {
  const { useCase, indexBuilder, store, logger, indexDocument, manageDocuments, syncEpisodicMemory, syncSemanticMemory, purgeEpisodicMemory } = container;

  // Streams are injectable so the protocol can be driven by a test without
  // touching the real stdio or calling process.exit. Production passes
  // nothing and gets exactly the previous behaviour.
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  const exit = io.exit || ((code) => process.exit(code));
  const ownsProcess = !io.input;

  const emit = (obj) => output.write(JSON.stringify(obj) + '\n');

  // Ensure the index exists before accepting questions.
  try {
    const res = indexBuilder.rebuildIfStale(store, { maxAgeMs: container.config.indexMaxAgeMs });
    if (res.rebuilt) logger.info('sidecar', 'index_refreshed', { reason: res.reason });
  } catch (err) {
    logger.error('sidecar', 'index_refresh_failed', { message: err.message });
  }

  emit({ type: 'Ready' });

  // Episodic memory: fire-and-forget at startup, then on the configured
  // interval for as long as this sidecar process lives (see class doc).
  // Deliberately after Ready, unlike the FTS rebuild above: embedding is a
  // network call and must not delay the sidecar becoming usable.
  //
  // episodicSyncBusy guards the startup call, every interval tick, AND an
  // explicit SyncVectors against each other. Without it, a slow startup
  // backfill still in flight when the first interval tick (or a manual
  // SyncVectors) lands re-embeds the exact same pending chunks concurrently —
  // confirmed the hard way in this feature's own verification: a 135-chunk
  // backfill overlapped with a SyncVectors sent one second later duplicated
  // all 135 embeddings before either had saved a high-water mark for the
  // other to see. semanticSyncBusy guards the (separate, slower) semantic
  // sync the same way, independently.
  let episodicSyncTimer = null;
  let semanticSyncTimer = null;
  let purgeTimer = null;
  let episodicSyncBusy = false;
  let semanticSyncBusy = false;

  const runEpisodicSync = async (opts) => {
    if (!syncEpisodicMemory || episodicSyncBusy) return null;
    episodicSyncBusy = true;
    try {
      return await syncEpisodicMemory.execute(opts);
    } finally {
      episodicSyncBusy = false;
    }
  };
  const runSemanticSync = async () => {
    if (!syncSemanticMemory || semanticSyncBusy) return null;
    semanticSyncBusy = true;
    try {
      return await syncSemanticMemory.execute();
    } finally {
      semanticSyncBusy = false;
    }
  };

  // In production these timers coexist with the stdin/readline listener
  // below, which is what actually keeps the sidecar process alive — a
  // background job must never be the ONLY thing pinning the event loop open,
  // or a process that should otherwise be able to exit (streams closed, no
  // pending work) would be stuck alive by a timer nobody is listening to the
  // results of. Hence `.unref()` on every one of them.
  if (syncEpisodicMemory) {
    const runBackground = () => {
      runEpisodicSync().then((stats) => {
        if (stats && stats.embedded > 0) logger.info('sidecar', 'episodic_sync_done', stats);
      }).catch((err) => {
        // Background work — log, do not surface a protocol Error nobody
        // asked for. SyncVectors below is the path for an explicit request.
        logger.warn('sidecar', 'episodic_sync_failed', { message: err.message });
      });
    };
    runBackground();
    episodicSyncTimer = setInterval(runBackground, container.config.episodicSyncMaxAgeMs);
    episodicSyncTimer.unref();
  }

  if (syncSemanticMemory) {
    const runBackground = () => {
      runSemanticSync().then((stats) => {
        if (stats && stats.embedded > 0) logger.info('sidecar', 'semantic_sync_done', stats);
      }).catch((err) => {
        logger.warn('sidecar', 'semantic_sync_failed', { message: err.message });
      });
    };
    runBackground();
    semanticSyncTimer = setInterval(runBackground, container.config.semanticSyncMaxAgeMs);
    semanticSyncTimer.unref();
  }

  // Retention (plan §05a): independent of both syncs above — it only ever
  // deletes points past the retention window, never embeds anything, so it
  // shares no busy lane with them.
  if (purgeEpisodicMemory) {
    const runPurge = () => {
      purgeEpisodicMemory.execute().then((res) => {
        if (res && res.deleted > 0) logger.info('sidecar', 'episodic_purge_done', res);
      }).catch((err) => {
        logger.warn('sidecar', 'episodic_purge_failed', { message: err.message });
      });
    };
    runPurge();
    purgeTimer = setInterval(runPurge, container.config.episodicPurgeIntervalMs);
    purgeTimer.unref();
  }

  const rl = readline.createInterface({ input, terminal: false });

  // Two lanes, not one flag: asking and indexing must not block each other.
  let askBusy = false;
  let docBusy = false;

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_) {
      emit({ type: 'Error', message: 'Malformed JSON on stdin', code: 'PROTOCOL_ERROR' });
      return;
    }

    handleMessage(msg).catch((err) => {
      const code = err instanceof ChatbotError ? err.code : 'INTERNAL_ERROR';
      logger.error('sidecar', 'request_failed', { type: msg.type, code, message: err.message });
      // Correlate with whichever identifier the request carried: chat messages
      // belong to a thread, document messages to a file.
      emit({ type: 'Error', threadId: msg.threadId, docId: msg.docId, message: err.message, code });
    });
  });

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'Ask': {
        const threadId = msg.threadId || 'default';
        if (askBusy) {
          emit({
            type: 'Error',
            threadId,
            message: 'Previous question still processing',
            code: 'BUSY',
          });
          return;
        }
        askBusy = true;
        try {
          const payload = await useCase.run({
            question: msg.question,
            threadId,
            history: Array.isArray(msg.history) ? msg.history : [],
            liveContext: typeof msg.liveContext === 'string' ? msg.liveContext : '',
            onNode: (node) => emit({ type: 'ChatThinking', threadId, node }),
          });
          emit({ type: 'ChatReply', threadId, payload });
        } catch (err) {
          // Emit the error as a protocol message — do NOT rethrow, which would
          // cause handleMessage().catch() to emit a SECOND error event and also
          // risk an unhandledRejection if the outer .catch misses it.
          const code = err && err.code ? err.code : 'INTERNAL_ERROR';
          logger.error('sidecar', 'ask_failed', { code, message: err && err.message });
          emit({
            type: 'Error',
            threadId,
            message: (err && err.message) || 'Unknown error',
            code,
          });
        } finally {
          askBusy = false;
        }
        return;
      }
      case 'UploadDocument': {
        if (!indexDocument) {
          emit({ type: 'Error', docId: msg.docId, message: 'Document indexing unavailable (no API key)', code: 'CONFIG_ERROR' });
          return;
        }
        if (docBusy) {
          emit({
            type: 'Error',
            docId: msg.docId,
            message: 'Another document is still indexing',
            code: 'BUSY',
          });
          return;
        }
        docBusy = true;
        try {
          const result = await indexDocument.execute({
            docId: msg.docId,
            filePath: msg.filePath,
            fileName: msg.fileName,
            // Absent means global. The host sends this only when a project was
            // active at upload time.
            projectId: msg.projectId ?? null,
            onProgress: ({ phase, done, total }) =>
              emit({ type: 'DocumentProgress', docId: msg.docId, phase, done, total }),
          });
          emit({
            type: 'DocumentReady',
            docId: result.docId,
            fileName: result.fileName,
            chunkCount: result.chunkCount,
            pageCount: result.pageCount,
            deduped: result.deduped,
          });
        } catch (err) {
          // Emitted here rather than rethrown, for the same reason as Ask: the
          // outer catch would emit a second Error for the same failure.
          const code = err && err.code ? err.code : 'DOCUMENT_ERROR';
          logger.error('sidecar', 'upload_failed', { docId: msg.docId, code, message: err && err.message });
          emit({
            type: 'Error',
            docId: msg.docId,
            message: (err && err.message) || 'Document indexing failed',
            code,
          });
        } finally {
          docBusy = false;
        }
        return;
      }
      case 'ListDocuments': {
        if (!manageDocuments) {
          emit({ type: 'DocumentList', docs: [] });
          return;
        }
        emit({ type: 'DocumentList', docs: manageDocuments.list() });
        return;
      }
      case 'DeleteDocument': {
        if (!manageDocuments) {
          emit({ type: 'Error', docId: msg.docId, message: 'Document store unavailable (no API key)', code: 'CONFIG_ERROR' });
          return;
        }
        const { docId } = manageDocuments.remove(msg.docId);
        emit({ type: 'DocumentDeleted', docId });
        return;
      }
      case 'RebuildIndex': {
        const stats = msg.force ? indexBuilder.rebuild(store) : indexBuilder.rebuildIfStale(store, { maxAgeMs: container.config.indexMaxAgeMs });
        emit({ type: 'IndexRebuilt', stats });
        return;
      }
      case 'SyncVectors': {
        if (!syncEpisodicMemory && !syncSemanticMemory) {
          emit({ type: 'Error', message: 'Memory sync unavailable (no API key)', code: 'CONFIG_ERROR' });
          return;
        }
        if (episodicSyncBusy || semanticSyncBusy) {
          emit({ type: 'Error', message: 'Memory sync already running', code: 'BUSY' });
          return;
        }
        // An explicit request runs whichever of the two syncs are
        // configured, together — unlike the independent background timers.
        const stats = {};
        if (syncEpisodicMemory) stats.episodic = await runEpisodicSync({ force: Boolean(msg.force) });
        if (syncSemanticMemory) stats.semantic = await runSemanticSync();
        emit({ type: 'VectorsSynced', stats });
        return;
      }
      case 'Shutdown': {
        emit({ type: 'Bye' });
        shutdown(0);
        return;
      }
      default:
        emit({ type: 'Error', message: `Unknown message type: ${msg.type}`, code: 'PROTOCOL_ERROR' });
    }
  }

  function shutdown(code) {
    if (episodicSyncTimer) clearInterval(episodicSyncTimer);
    if (semanticSyncTimer) clearInterval(semanticSyncTimer);
    if (purgeTimer) clearInterval(purgeTimer);
    try { container.shutdown(); } catch (_) { /* best effort */ }
    exit(code);
  }

  // Graceful teardown: Rust may kill the process group on app exit. Only the
  // real sidecar claims the process-wide signals; a test harness driving
  // injected streams must not register (or fire) them.
  if (ownsProcess) {
    process.on('SIGTERM', () => shutdown(0));
    process.on('SIGINT', () => shutdown(0));
    rl.on('close', () => shutdown(0));
  }

  return { shutdown };
}

module.exports = { startStdioSidecar };
