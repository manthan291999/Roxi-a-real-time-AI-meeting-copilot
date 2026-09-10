/**
 * Speechmatics real-time STT provider (fallback for AssemblyAI).
 *
 * Uses the official @speechmatics/real-time-client (the old `speechmatics`
 * npm package is deprecated) plus @speechmatics/auth to mint a short-lived
 * realtime JWT from the long-lived API key.
 *
 * Emits the same normalized events as AssemblyAIProvider:
 *   - 'connected'
 *   - 'partial'         { text, speaker }
 *   - 'final'           { text, speaker, start, end }
 *   - 'error'           { message, fatal }
 *   - 'closed'          { code, reason }
 */

const EventEmitter = require('events');
const { RealtimeClient } = require('@speechmatics/real-time-client');
const { createSpeechmaticsJWT } = require('@speechmatics/auth');

// Auto-routes to the lowest-latency region. Set explicitly — the SDK's
// built-in default (eu2) should not be relied on.
const REALTIME_URL = 'wss://global.rt.speechmatics.com/v2/';
const SAMPLE_RATE = 16000;
const MAX_SPEAKERS = 4;

// Speechmatics realtime JWTs are only checked at connection time, so a short
// TTL is fine; a fresh one is minted on every (re)connect.
const JWT_TTL_SECONDS = 60;

/**
 * Map Speechmatics speaker IDs ("S1", "S2", ...) to the app's
 * "Speaker A/B/..." labels. "UU" means the speaker could not be determined.
 */
function mapSpeaker(rawSpeaker, lastKnownSpeaker) {
  const s = String(rawSpeaker || '').trim();
  const match = /^S(\d+)$/.exec(s);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 26) {
      return `Speaker ${String.fromCharCode(64 + num)}`;
    }
    return `Speaker ${s}`;
  }
  // "UU" (unknown) or missing → fall back to the last known speaker,
  // mirroring the AssemblyAI "PENDING" handling.
  return lastKnownSpeaker;
}

class SpeechmaticsProvider extends EventEmitter {
  constructor(apiKey) {
    super();
    this.name = 'speechmatics';
    this.apiKey = apiKey;
    this.isConnected = false;
    this.lastKnownSpeaker = "Speaker A";
    this.client = null;
    this.closing = false;
  }

  async connect() {
    let jwt;
    try {
      jwt = await createSpeechmaticsJWT({
        type: 'rt',
        apiKey: this.apiKey,
        ttl: JWT_TTL_SECONDS,
      });
    } catch (err) {
      // SpeechmaticsJWTError carries a .type: Unauthorized | ValidationFailed | UnknownError
      const type = err?.type || 'UnknownError';
      const message =
        type === 'Unauthorized'
          ? 'Speechmatics auth failed: 403 unauthorized (check SPEECHMATICS_API_KEY)'
          : `Speechmatics auth failed (${type}): ${err?.message || err}`;
      throw new Error(message);
    }

    const client = new RealtimeClient({
      url: REALTIME_URL,
      appId: 'meeting-interpreter',
      connectionTimeout: 10_000,
    });
    this.client = client;

    client.addEventListener('receiveMessage', (event) => {
      this.handleServerMessage(event.data);
    });

    client.addEventListener('socketStateChange', (event) => {
      if (event.socketState === 'closed') {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        // Suppress the close event for an intentional shutdown.
        if (!this.closing && wasConnected) {
          this.emit('closed', { code: undefined, reason: 'socket closed' });
        }
      }
    });

    // Resolves once the server acknowledges with RecognitionStarted.
    await client.start(jwt, {
      audio_format: {
        type: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: SAMPLE_RATE,
      },
      transcription_config: {
        language: 'en',
        diarization: 'speaker',
        enable_partials: true,
        speaker_diarization_config: {
          max_speakers: MAX_SPEAKERS,
        },
      },
    });

    this.isConnected = true;
    this.emit('connected', { sessionId: 'speechmatics' });
  }

  handleServerMessage(data) {
    if (!data || typeof data.message !== 'string') return;

    switch (data.message) {
      case 'AddPartialTranscript': {
        const { text, speaker } = this.extractTranscript(data);
        if (text) this.emit('partial', { text, speaker });
        break;
      }
      case 'AddTranscript': {
        const { text, speaker, confidence } = this.extractTranscript(data);
        if (!text) break;
        this.emit('final', {
          text,
          speaker,
          start: data.metadata?.start_time,
          end: data.metadata?.end_time,
          confidence,
        });
        break;
      }
      case 'Error': {
        const message = data.reason || data.type || 'Speechmatics error';
        const fatal = data.type === 'not_authorised' || data.type === 'not_allowed';
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.emit('error', { message: `Speechmatics: ${message}`, fatal });
        // This flips isConnected to false unconditionally (sendAudio above is
        // now a permanent no-op), but only auth errors are marked `fatal` for
        // ProviderManager. For every other case it waits on a subsequent
        // 'closed' event instead — except the socketStateChange listener below
        // only emits 'closed' when `wasConnected` is still true at the time
        // the socket actually closes, and by then this handler has already
        // set it false. That race meant a non-auth server error (e.g. a quota
        // or session-limit error) could leave ProviderManager believing this
        // dead connection was still active for the rest of the session, with
        // audio going in and nothing ever coming back out. Emit 'closed'
        // ourselves so the manager always finds out and fails over.
        if (!this.closing && wasConnected) {
          this.emit('closed', { code: undefined, reason: `server error: ${message}` });
        }
        break;
      }
      case 'EndOfTranscript': {
        // Server acknowledged end of stream; nothing to do — close follows.
        break;
      }
      default:
        // AudioAdded, Info, Warning, etc. — ignore.
        break;
    }
  }

  /**
   * Pull the formatted text, the dominant speaker label, and the mean word
   * confidence out of an AddTranscript / AddPartialTranscript message.
   *
   * Confidence is part of the ISttProvider contract: the sanitizer drops
   * low-confidence turns, and a provider that omitted the field used to have
   * every one of its turns bypass that filter.
   */
  extractTranscript(data) {
    const text = String(data.metadata?.transcript || '').trim();

    // Speaker of the first word result; fall back to last known speaker.
    let rawSpeaker = null;
    let confidenceSum = 0;
    let confidenceCount = 0;

    if (Array.isArray(data.results)) {
      for (const result of data.results) {
        if (result.type !== 'word') continue;
        const alt = result.alternatives && result.alternatives[0];
        if (!alt) continue;
        if (!rawSpeaker && alt.speaker) rawSpeaker = alt.speaker;
        if (typeof alt.confidence === 'number' && Number.isFinite(alt.confidence)) {
          confidenceSum += alt.confidence;
          confidenceCount++;
        }
      }
    }

    const speaker = mapSpeaker(rawSpeaker, this.lastKnownSpeaker);
    if (rawSpeaker && /^S\d+$/.test(rawSpeaker)) {
      this.lastKnownSpeaker = speaker;
    }

    // No word-level confidence reported (rare, and possible for punctuation-only
    // results): treat as fully confident rather than silently dropping speech.
    const confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 1;

    return { text, speaker, confidence };
  }

  sendAudio(payload) {
    if (this.isConnected && this.client) {
      try {
        this.client.sendAudio(payload);
      } catch (err) {
        this.emit('error', {
          message: `Speechmatics sendAudio failed: ${err}`,
          fatal: false,
        });
      }
    }
  }

  async close() {
    this.closing = true;
    this.isConnected = false;
    try {
      if (this.client) {
        await this.client.stopRecognition();
      }
    } catch (_) {
      // Best-effort teardown; ignore errors during shutdown.
    }
  }
}

module.exports = { SpeechmaticsProvider };
