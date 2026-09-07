/**
 * stdioSidecar — transport boundary for the Tauri/Rust integration.
 *
 * Protocol (line-delimited JSON):
 *   stdin  -> {"type":"Ask","question":"...","threadId":"...","history":[...]}
 *             {"type":"RebuildIndex","force":false}
 *             {"type":"Shutdown"}
 *   stdout <- {"type":"Ready"}
 *             {"type":"ChatThinking","threadId":"ask","node":"retrieve"}
 *             {"type":"ChatReply","threadId":"ask","payload":{...}}
 *             {"type":"IndexRebuilt","stats":{...}}
 *             {"type":"Error","threadId":"ask","message":"...","code":"..."}
 *             {"type":"Bye"}
 *
 * Every response to an Ask echoes its threadId. The host fans these out as
 * global Tauri events, so without it a UI with more than one thread appends
 * every answer to all of them. threadId is omitted only where it genuinely is
 * not known (malformed stdin, unknown message type).
 *
 * stdout carries ONLY protocol messages; logs go to stderr via the logger.
 */

const readline = require('readline');
const { ChatbotError } = require('../domain/errors');

/** Friendly labels for ChatThinking events (UI-side mapping lives in React). */
function startStdioSidecar(container) {
  const { useCase, indexBuilder, store, logger } = container;

  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

  // Ensure the index exists before accepting questions.
  try {
    const res = indexBuilder.rebuildIfStale(store, { maxAgeMs: container.config.indexMaxAgeMs });
    if (res.rebuilt) logger.info('sidecar', 'index_refreshed', { reason: res.reason });
  } catch (err) {
    logger.error('sidecar', 'index_refresh_failed', { message: err.message });
  }

  emit({ type: 'Ready' });

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  let busy = false;

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
      emit({ type: 'Error', threadId: msg.threadId, message: err.message, code });
    });
  });

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'Ask': {
        const threadId = msg.threadId || 'default';
        if (busy) {
          emit({
            type: 'Error',
            threadId,
            message: 'Previous question still processing',
            code: 'BUSY',
          });
          return;
        }
        busy = true;
        try {
          const payload = await useCase.run({
            question: msg.question,
            threadId,
            history: Array.isArray(msg.history) ? msg.history : [],
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
          busy = false;
        }
        return;
      }
      case 'RebuildIndex': {
        const stats = msg.force ? indexBuilder.rebuild(store) : indexBuilder.rebuildIfStale(store, { maxAgeMs: container.config.indexMaxAgeMs });
        emit({ type: 'IndexRebuilt', stats });
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
    try { container.shutdown(); } catch (_) { /* best effort */ }
    process.exit(code);
  }

  // Graceful teardown: Rust may kill the process group on app exit.
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  rl.on('close', () => shutdown(0));
}

module.exports = { startStdioSidecar };
