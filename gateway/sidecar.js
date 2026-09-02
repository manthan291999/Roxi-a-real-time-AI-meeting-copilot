// Load from the single global .env at the project root (one level above gateway/).
// Falls back to gateway/.env if root one is missing (backwards compat).
const path = require('path');
const ROOT_ENV = path.join(__dirname, '..', '.env');
const LOCAL_ENV = path.join(__dirname, '.env');
require('dotenv').config({ path: require('fs').existsSync(ROOT_ENV) ? ROOT_ENV : LOCAL_ENV });

const { setUserProfile } = require('./state/meeting-state.js');
const db = require('./db/index.js');
const { ProviderManager } = require('./stt/provider-manager.js');
const { AssemblyAIProvider } = require('./providers/assemblyai.js');
const { SpeechmaticsProvider } = require('./providers/speechmatics.js');
const { validateTranscriptEvent } = require('./infrastructure/validate.js');
const { log } = require('./infrastructure/logger.js');
const { DiarizationLayer } = require('./stt/diarization-layer.js');
const { PcmDeframer } = require('./audio/pcm-deframer.js');
const { shutdown } = require('./lifecycle/shutdown.js');
const sanitizer = require('./stt/transcript-sanitizer.js');


let meetingContext = '';
const ctxIdx = process.argv.indexOf('--context');
if (ctxIdx !== -1 && process.argv[ctxIdx + 1]) {
  meetingContext = process.argv[ctxIdx + 1];
  log('info', 'sidecar', 'meeting_context_set', { preview: meetingContext.slice(0, 80) });
}

const ROLE_PROFILES = {
  pm:         { role: 'Project Manager',      expertise_level: 'business', technical_depth: 'low',    experience_years: 5 },
  tech_lead:  { role: 'Technical Lead',       expertise_level: 'expert',   technical_depth: 'high',   experience_years: 8 },
  client:     { role: 'Client / Stakeholder', expertise_level: 'business', technical_depth: 'low',    experience_years: 3 },
  designer:   { role: 'Designer',             expertise_level: 'medium',   technical_depth: 'medium', experience_years: 4 },
  executive:  { role: 'Executive',            expertise_level: 'business', technical_depth: 'low',    experience_years: 10 },
};

const roleIdx = process.argv.indexOf('--role');
if (roleIdx !== -1 && process.argv[roleIdx + 1]) {
  const roleKey = process.argv[roleIdx + 1];
  const profile = ROLE_PROFILES[roleKey] || ROLE_PROFILES['tech_lead'];
  setUserProfile(profile);
  log('info', 'sidecar', 'user_profile_set', { role: profile.role });
}

const assemblyaiKey  = process.env.ASSEMBLYAI_API_KEY;
const speechmaticsKey = process.env.SPEECHMATICS_API_KEY;

const missing = [];
if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
if (!assemblyaiKey && !speechmaticsKey) {
  missing.push('ASSEMBLYAI_API_KEY or SPEECHMATICS_API_KEY');
}
if (missing.length > 0) {
  console.log(JSON.stringify({ type: 'Error', message: `Missing required env vars: ${missing.join(', ')}` }));
  process.exit(1);
}

let diarization = null;

const chain = [];
if (assemblyaiKey) {
  chain.push({ name: 'assemblyai', create: () => new AssemblyAIProvider(assemblyaiKey) });
}
if (speechmaticsKey) {
  chain.push({ name: 'speechmatics', create: () => new SpeechmaticsProvider(speechmaticsKey) });
}

const manager = new ProviderManager(chain);
const deframer = new PcmDeframer(manager);

manager.on('status', ({ provider, state }) => {
  console.log(JSON.stringify({ type: 'ProviderStatus', provider, state }));
  if (state === 'active') {
    console.log(JSON.stringify({ type: 'Connected', sessionId: provider }));
  }
  log('info', 'sidecar', 'provider_status', { provider, state });
});

manager.on('partial', ({ text, speaker: sttLabel }) => {
  const displayName = diarization ? diarization.resolveLabel(sttLabel) : sttLabel;
  console.log(JSON.stringify({ type: 'Partial', text, speaker: displayName, sttLabel }));
});

manager.on('final', (evt) => {
  const v = validateTranscriptEvent(evt);
  if (!v.ok) {
    log('warn', 'sidecar', 'invalid_transcript_event', { reason: v.reason });
    return;
  }
  const { text, speaker: sttLabel, confidence } = v;

  const sanitized = sanitizer.sanitize(text, confidence || 1.0);
  if (!sanitized.ok) {
    log('info', 'sidecar', 'chunk_dropped_sanitizer', { reason: sanitized.reason, text });
    return;
  }
  
  const displayName = diarization ? diarization.resolveLabel(sttLabel) : sttLabel;

  console.log(JSON.stringify({ type: 'Final', text: sanitized.text, speaker: displayName, sttLabel, start: evt.start, end: evt.end }));

  if (diarization) diarization.buildEmbedding(sttLabel);

  db.saveTranscript(displayName, sanitized.text);
  // Disabled: Node.js agent pipeline replaced by Rust-native agent pipeline.
  // semanticBuffer.accept(displayName, sanitized.text);
});

manager.on('speakerRevision', ({ revision }) => {
  console.log(JSON.stringify({ type: 'SpeakerRevision', revision }));
});

manager.on('providerError', ({ provider, message }) => {
  log('warn', 'sidecar', 'stt_provider_error', { provider, message: (message || '').slice(0, 200) });
});

manager.on('error', ({ message }) => {
  console.log(JSON.stringify({ type: 'Error', message }));
  log('error', 'sidecar', 'stt_error', { message: (message || '').slice(0, 200) });
});

manager.on('exhausted', () => {
  shutdown('stt_exhausted', 'exhausted', manager);
});

async function start() {
  try {
    await db.initDB(meetingContext);
    diarization = new DiarizationLayer(db);
  } catch (err) {
    console.log(JSON.stringify({ type: 'Error', message: `Database init failed: ${err.message}` }));
    log('error', 'sidecar', 'db_init_failed', { message: (err.message || '').slice(0, 300) });
    process.exit(1);
  }

  process.stdin.resume();
  process.stdin.on('data', (data) => deframer.append(data));
  process.stdin.on('end', () => shutdown('stdin_end', 'ended', manager));
  process.on('SIGTERM', () => shutdown('sigterm', 'ended', manager));
  process.on('SIGINT', () => shutdown('sigint', 'ended', manager));

  await manager.start();
}

start();
