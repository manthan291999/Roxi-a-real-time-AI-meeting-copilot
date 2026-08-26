const { analyseChunk } = require('./agent-orchestrator.js');
const { persistChunkArtifacts } = require('./chunk-persister.js');
const { broadcastChunkEvents } = require('./chunk-broadcaster.js');
const { log, metrics } = require('../infrastructure/logger.js');

// Rule-based sanitizer — zero LLM cost, already covers hallucinations,
// blocklist phrases, low confidence, and repetition. The LLM-based
// TranscriptCleaner is intentionally NOT used here — it consumed 1 API call
// per chunk without adding meaningful accuracy over the rule-based checks.
const sanitizer = require('../stt/transcript-sanitizer.js');

let seqCounter = 0;
let sessionPromptTokens = 0;
let sessionCompletionTokens = 0;

async function runChunk(chunkText, speaker) {
  seqCounter++;
  const seq = seqCounter;

  // Free rule-based gate — no API call needed
  const sanityCheck = sanitizer.sanitize(chunkText, 1.0);
  if (!sanityCheck.ok) {
    log('info', 'runner', 'chunk_dropped_sanitizer', { seq, reason: sanityCheck.reason });
    return;
  }

  try {
    const result = await analyseChunk(chunkText, speaker);

    // Track cumulative token cost for cost awareness
    if (result.api_calls_used > 0) {
      sessionPromptTokens += result.prompt_tokens || 0;
      sessionCompletionTokens += result.completion_tokens || 0;
      metrics.observe('session_tokens_prompt', sessionPromptTokens, { seq });
      metrics.observe('session_tokens_completion', sessionCompletionTokens, { seq });
      log('info', 'runner', 'token_usage', {
        seq,
        chunk_calls: result.api_calls_used,
        session_prompt: sessionPromptTokens,
        session_completion: sessionCompletionTokens,
        circuit_state: result.breaker?.state,
      });
    }

    persistChunkArtifacts(result, seq, speaker, chunkText);
    broadcastChunkEvents(result, speaker);
  } catch (err) {
    log('error', 'runner', 'chunk_failed', { seq, error: err.message });
  }
}

module.exports = { runChunk };

