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
        const { text, speaker } = this.extractTranscript(data);
        if (!text) break;
        this.emit('final', {
          text,
          speaker,
          start: data.metadata?.start_time,
          end: data.metadata?.end_time,
        });
        break;
      }
      case 'Error': {
        const message = data.reason || data.type || 'Speechmatics error';
        const fatal = data.type === 'not_authorised' || data.type === 'not_allowed';
        this.isConnected = false;
        this.emit('error', { message: `Speechmatics: ${message}`, fatal });
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
   * Pull the formatted text and the dominant speaker label out of an
   * AddTranscript / AddPartialTranscript message.
   */
  extractTranscript(data) {
    const text = String(data.metadata?.transcript || '').trim();

    // Speaker of the first word result; fall back to last known speaker.
    let rawSpeaker = null;
    if (Array.isArray(data.results)) {
      for (const result of data.results) {
        if (result.type !== 'word') continue;
        const alt = result.alternatives && result.alternatives[0];
        if (alt && alt.speaker) {
          rawSpeaker = alt.speaker;
          break;
        }
      }
    }

    const speaker = mapSpeaker(rawSpeaker, this.lastKnownSpeaker);
    if (rawSpeaker && /^S\d+$/.test(rawSpeaker)) {
      this.lastKnownSpeaker = speaker;
    }

    return { text, speaker };
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
