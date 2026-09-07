/**
 * AssemblyAI real-time STT provider.
 *
 * Extracted from sidecar.js with no behavior change: same Universal-3.5-Pro
 * streaming config, same speaker normalization and PENDING fallback.
 *
 * Emits normalized events consumed by ProviderManager:
 *   - 'connected'
 *   - 'partial'         { text, speaker }
 *   - 'final'           { text, speaker, start, end }
 *   - 'speakerRevision' { revision }
 *   - 'error'           { message, fatal }
 *   - 'closed'          { code, reason }
 */

const EventEmitter = require('events');
const { AssemblyAI } = require('assemblyai');

const SAMPLE_RATE = 16000;

function normalizeSpeaker(rawSpeaker) {
  if (!rawSpeaker) return "Speaker A";
  const s = String(rawSpeaker).trim();
  if (/^Speaker\s+[A-Za-z0-9]+$/i.test(s)) {
    return s.replace(/^speaker\s+/i, "Speaker ");
  }
  if (/^[A-Za-z]$/.test(s)) {
    return `Speaker ${s.toUpperCase()}`;
  }
  if (/^\d+$/.test(s)) {
    const num = parseInt(s, 10);
    if (num >= 1 && num <= 26) {
      return `Speaker ${String.fromCharCode(64 + num)}`;
    }
    return `Speaker ${s}`;
  }
  return s;
}

/**
 * Mean word confidence for a turn. Returns 1 when the provider reported no
 * word-level confidence, rather than NaN — `NaN < threshold` is false, so a
 * missing value used to pass the sanitizer by accident rather than by intent.
 */
function meanConfidence(words) {
  if (!Array.isArray(words) || words.length === 0) return 1;
  let sum = 0;
  let count = 0;
  for (const w of words) {
    if (typeof w.confidence === 'number' && Number.isFinite(w.confidence)) {
      sum += w.confidence;
      count++;
    }
  }
  return count > 0 ? sum / count : 1;
}

function isAuthError(message) {
  return /401|403|unauthorized|unauthenticated|authentication|invalid api key|api key/i.test(
    String(message)
  );
}

class AssemblyAIProvider extends EventEmitter {
  constructor(apiKey) {
    super();
    this.name = 'assemblyai';
    this.apiKey = apiKey;
    this.isConnected = false;
    this.lastKnownSpeaker = "Speaker A";
    this.rt = null;
  }

  async connect() {
    const client = new AssemblyAI({ apiKey: this.apiKey });
    const rt = client.streaming.transcriber({
      sampleRate: SAMPLE_RATE,
      encoding: 'pcm_s16le',
      speechModel: 'universal-3-5-pro',
      languageCode: 'en',
      speakerLabels: true,
      maxSpeakers: 4,
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.4,
      minEndOfTurnSilenceWhenConfident: 300,
      maxTurnSilence: 2000,
      connectTimeout: 5000,
    });
    this.rt = rt;

    rt.on('open', (event) => {
      const sessionId = event?.id || event?.sessionId || "session";
      this.isConnected = true;
      this.emit('connected', { sessionId });
    });

    rt.on('error', (error) => {
      const message = error?.toString?.() || String(error);
      this.emit('error', { message, fatal: isAuthError(message) });
    });

    rt.on('close', (code, reason) => {
      this.isConnected = false;
      this.emit('closed', { code, reason: String(reason || '') });
    });

    rt.on('turn', (turn) => this.handleTurn(turn));

    rt.on('speaker_revision', (revision) => {
      if (revision) {
        this.emit('speakerRevision', { revision });
      }
    });

    await rt.connect();
  }

  handleTurn(turn) {
    if (!turn || !turn.transcript) return;

    // Get acoustic speaker (Speaker A, B, etc.)
    let acousticSpeaker =
      turn.speaker_label || (turn.words && turn.words[0] && turn.words[0].speaker);

    if (acousticSpeaker === "PENDING") {
      // If pending, use the last known speaker
      acousticSpeaker = this.lastKnownSpeaker;
    } else if (acousticSpeaker) {
      acousticSpeaker = normalizeSpeaker(acousticSpeaker);
      this.lastKnownSpeaker = acousticSpeaker; // Update fallback
    } else {
      acousticSpeaker = this.lastKnownSpeaker;
    }

    const speaker = acousticSpeaker;
    const text = turn.transcript.trim();
    if (!text) return;

    if (!turn.end_of_turn) {
      this.emit('partial', { text, speaker });
    } else {
      this.emit('final', {
        text,
        speaker,
        start: turn.start,
        end: turn.end,
        confidence: meanConfidence(turn.words),
      });
    }
  }

  sendAudio(payload) {
    if (this.isConnected && this.rt) {
      this.rt.sendAudio(payload);
    }
  }

  async close() {
    this.isConnected = false;
    try {
      if (this.rt) await this.rt.close();
    } catch (_) {
      // Best-effort teardown; ignore errors during shutdown.
    }
  }
}

module.exports = { AssemblyAIProvider };
