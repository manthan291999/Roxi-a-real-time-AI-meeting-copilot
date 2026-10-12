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
 *   - 'speakerRevision' { revisions }
 *   - 'error'           { message, fatal }
 *   - 'closed'          { code, reason }
 */

const EventEmitter = require('events');
const { AssemblyAI } = require('assemblyai');

const SAMPLE_RATE = 16000;

/** AssemblyAI caps `prompt` at 1750 characters and `keyterms_prompt` at 100 entries. */
const MAX_PROMPT_CHARS = 1750;
const MAX_KEYTERMS = 100;

/**
 * Common words that are only capitalised because they start a sentence. Biasing
 * recognition toward these would be worse than useless, since they are words
 * the model already knows and would now over-predict. Only consulted for
 * single-word candidates — "Review" is noise, "Review Board" is a real name.
 */
const SENTENCE_STARTERS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'before', 'but', 'by', 'can', 'check', 'confirm', 'demo', 'discuss',
  'do', 'each', 'first', 'follow', 'for', 'from', 'get', 'go', 'has', 'have',
  'he', 'her', 'his', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just',
  'kickoff', 'last', 'let', 'make', 'meeting', 'more', 'my', 'need', 'new',
  'next', 'no', 'not', 'note', 'of', 'on', 'one', 'only', 'or', 'our', 'out',
  'over', 'plan', 'please', 'review', 'run', 'see', 'she', 'should', 'so',
  'some', 'standup', 'sync', 'take', 'talk', 'team', 'than', 'that', 'the',
  'their', 'then', 'there', 'these', 'they', 'this', 'to', 'today', 'up',
  'update', 'us', 'use', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

/**
 * Pull likely proper nouns and jargon out of the meeting context so they can be
 * sent as `keyterms_prompt`.
 *
 * Deliberately crude — this is a recognition bias, not a parse. A wrong term
 * costs a little accuracy on that word; a missing one costs the whole word. So
 * it over-collects: runs of capitalised words (people, companies, products) and
 * any token carrying an internal capital or a digit (camelCase, v2, S3, K8s).
 *
 * Exported for testing.
 */
function extractKeyterms(context) {
  if (!context) return [];

  const terms = new Map(); // lowercased -> first-seen original casing
  const add = (raw) => {
    // A run that begins a sentence picks up its first word for free — "The
    // Review Board" is really "Review Board". Strip exactly one such word: only
    // the first is capitalised by position, and stripping further eats the name
    // itself ("Review Board" would become "Board").
    const words = raw.trim().split(/\s+/);
    if (words.length > 1 && SENTENCE_STARTERS.has(words[0].toLowerCase())) words.shift();

    const term = words.join(' ');
    // Single letters and very long runs are noise, not terms.
    if (term.length < 2 || term.length > 60) return;
    const key = term.toLowerCase();
    // What remains is kept if it is multi-word — capitalisation carrying across
    // a word boundary is a much stronger signal than it is on a lone word.
    if (words.length === 1 && SENTENCE_STARTERS.has(key)) return;
    if (!terms.has(key)) terms.set(key, term);
  };

  // Runs of capitalised words: "Project Aurora", "Krishaweb", "Jane Okafor".
  for (const m of context.matchAll(/\b[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*/g)) add(m[0]);
  // Tokens with an internal capital or a digit: "useCaptureFlow", "GPT-4o", "S3".
  for (const m of context.matchAll(/\b[A-Za-z][\w'-]*[A-Z0-9][\w'-]*/g)) add(m[0]);

  return Array.from(terms.values()).slice(0, MAX_KEYTERMS);
}

/**
 * Build the `prompt` value: a short natural-language description of the call.
 *
 * The Universal-3.5-Pro `prompt` is a domain hint, not an instruction, so the
 * user's raw context is the best thing to send — only the role is added, since
 * knowing who is speaking helps the model resolve first-person phrasing.
 */
function buildPrompt(context, role) {
  const parts = [];
  if (role) parts.push(`The user in this meeting is the ${role}.`);
  if (context) parts.push(context);
  const prompt = parts.join(' ').trim();
  return prompt ? prompt.slice(0, MAX_PROMPT_CHARS) : null;
}

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
  /**
   * @param {string}   apiKey
   * @param {string[]} languages  language codes to bias toward (`language_codes`)
   * @param {Object}   [options]
   * @param {number}   [options.minTurnSilence]  ms of silence before an end-of-turn check
   * @param {number}   [options.maxTurnSilence]  ms of silence that forces a turn to end
   * @param {number}   [options.maxSpeakers]     diarization cap, 1-10
   * @param {string}   [options.mode]            'balanced' | 'max_accuracy' | 'min_latency'
   * @param {?string}  [options.voiceFocus]      'near-field' | 'far-field', or null for off
   * @param {string}   [options.context]         the meeting context from the intake modal
   * @param {?string}  [options.role]            the user's role in this meeting
   */
  constructor(credential, languages = ['en'], options = {}) {
    super();
    this.name = 'assemblyai';
    if (typeof credential === 'string') credential = { kind: 'apiKey', value: credential };
    this.apiKey = credential?.kind === 'apiKey' ? credential.value : null;
    this.token = credential?.kind === 'token' ? credential.value : null;
    this.languages = languages;
    this.isConnected = false;
    this.lastKnownSpeaker = "Speaker A";
    this.rt = null;

    this.minTurnSilence = options.minTurnSilence ?? 400;
    this.maxTurnSilence = options.maxTurnSilence ?? 1500;
    this.maxSpeakers = options.maxSpeakers ?? 10;
    this.mode = options.mode ?? 'balanced';
    this.voiceFocus = options.voiceFocus ?? null;

    // The intake modal's context is the only description of the meeting this
    // process has, and Universal-3.5-Pro takes both forms of it: `prompt` for
    // the general domain, `keyterms_prompt` for the specific names it should
    // expect to hear. Computed once here rather than per reconnect.
    this.prompt = buildPrompt(options.context, options.role);
    this.keyterms = extractKeyterms(options.context);
  }

  async connect() {
    const client = new AssemblyAI({ apiKey: this.apiKey || '' });
    // Universal-3.5-Pro notes (see the Universal -> U3.5-Pro migration guide):
    //   - `formatTurns` is gone: formatting is always on, and the model emits a
    //     single already-formatted turn per end_of_turn rather than the
    //     unformatted-then-formatted pair older models sent.
    //   - `endOfTurnConfidenceThreshold` is gone: turn detection is now
    //     punctuation-based, not confidence-based.
    // Both were still being sent and silently ignored by the server.
    const rt = client.streaming.transcriber({
      ...(this.token && { token: this.token }),
      sampleRate: SAMPLE_RATE,
      encoding: 'pcm_s16le',
      speechModel: 'universal-3-5-pro',
      languageCodes: this.languages,
      speakerLabels: true,
      maxSpeakers: this.maxSpeakers,
      minTurnSilence: this.minTurnSilence,
      maxTurnSilence: this.maxTurnSilence,
      mode: this.mode,
      ...(this.prompt && { prompt: this.prompt }),
      ...(this.keyterms.length > 0 && { keytermsPrompt: this.keyterms }),
      ...(this.voiceFocus && { voiceFocus: this.voiceFocus }),
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

    // 'speakerRevision', not 'speaker_revision': the SDK's `on()` is a bare
    // `this.listeners[event] = listener` and it dispatches to
    // `listeners.speakerRevision`, so the snake_case name registered a key
    // nothing ever read and every retroactive speaker correction was dropped.
    rt.on('speakerRevision', (event) => {
      // SpeakerRevisionEvent is { type, revisions: [...] } — plural, and an array.
      // Each entry names one earlier turn by `turn_order` and the label it
      // should have had; turns whose label did not change are omitted.
      const revisions = (event?.revisions || [])
        .filter((r) => r && typeof r.turn_order === 'number' && r.speaker_label)
        .map((r) => ({
          turnOrder: r.turn_order,
          // Normalized here, not downstream, so a revision's label is directly
          // comparable to the one the matching 'final' already carried.
          speaker: normalizeSpeaker(r.speaker_label),
        }));
      if (revisions.length > 0) {
        this.emit('speakerRevision', { revisions });
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
      // Timings come off the words, not the turn: TurnEvent has no top-level
      // start/end, so reading turn.start/turn.end sent `undefined` downstream
      // for every final.
      const words = Array.isArray(turn.words) ? turn.words : [];
      this.emit('final', {
        text,
        speaker,
        start: words.length > 0 ? words[0].start : undefined,
        end: words.length > 0 ? words[words.length - 1].end : undefined,
        confidence: meanConfidence(turn.words),
        // Carried so a later SpeakerRevision can be matched back to this turn —
        // revisions identify the turns they correct by turn_order and nothing else.
        turnOrder: turn.turn_order,
      });
    }
  }

  sendAudio(payload) {
    if (!this.isConnected || !this.rt) return;
    try {
      this.rt.sendAudio(payload);
    } catch (err) {
      // A send failing is not fatal on its own — the socket may already be
      // closing while ProviderManager fails over. Report it and let the manager
      // decide, rather than throwing out of the stdin data handler.
      this.emit('error', { message: err?.message || String(err), fatal: false });
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

module.exports = { AssemblyAIProvider, extractKeyterms, buildPrompt };
