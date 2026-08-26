/**
 * AI Meeting Interpreter — Phase 3 Gateway
 *
 * Reads framed PCM16 chunks from stdin (piped from the Rust audio capture process)
 * and streams them to AssemblyAI for real-time transcription.
 *
 * Usage:
 *   cargo run -- --stream --duration 0 | node gateway/transcriber.js
 */

require('dotenv').config();
const { AssemblyAI } = require('assemblyai');

// --- Configuration ---
const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  console.error("❌ ERROR: ASSEMBLYAI_API_KEY is not set in gateway/.env");
  process.exit(1);
}

const SAMPLE_RATE = 16000;
const MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]); // "PCM1"
const HEADER_SIZE = 8;

// --- State ---
let buffer = Buffer.alloc(0);
let isConnected = false;
let currentTranscript = "";

// Initialize AssemblyAI client
const client = new AssemblyAI({ apiKey });
const rt = client.realtime.transcriber({
  sampleRate: SAMPLE_RATE,
  encoding: 'pcm_s16le',
  endUtteranceSilenceThreshold: 1000 // Force final transcripts after 1s of silence
});

// --- AssemblyAI Event Handlers ---

rt.on('open', ({ sessionId }) => {
  console.error(`[gateway] 🟢 Connected to AssemblyAI! Session ID: ${sessionId}`);
  isConnected = true;
});

rt.on('error', (error) => {
  console.error('[gateway] ❌ AssemblyAI Error:', error);
});

rt.on('close', (code, reason) => {
  console.error(`[gateway] 🔴 Connection closed: ${code} ${reason}`);
  isConnected = false;
  process.exit(code === 1000 ? 0 : 1);
});

rt.on('transcript', (transcript) => {
  if (!transcript.text) return;

  if (transcript.message_type === 'PartialTranscript') {
    // Print partial transcripts with a carriage return so they overwrite the current line.
    process.stdout.write(`\r\x1b[36m[Partial]\x1b[0m ${transcript.text}\x1b[K`);
  } else if (transcript.message_type === 'FinalTranscript') {
    // Print final transcripts on a new line and clear the partial state.
    process.stdout.write(`\r\x1b[32m[Final]\x1b[0m ${transcript.text}\x1b[K\n`);
  }
});

// --- Stream Parsing Logic ---

function processBuffer() {
  while (buffer.length >= HEADER_SIZE) {
    // 1. Validate magic bytes
    const magic = buffer.subarray(0, 4);
    if (!magic.equals(MAGIC)) {
      // Find next magic byte sequence to resync
      const idx = findMagic(buffer, 1);
      if (idx === -1) {
        // No magic found, keep last 3 bytes in case it's a partial magic sequence
        const keep = Math.min(buffer.length, 3);
        buffer = buffer.subarray(buffer.length - keep);
        return;
      }
      buffer = buffer.subarray(idx);
      continue;
    }

    // 2. Read payload size
    const payloadSize = buffer.readUInt32LE(4);
    if (payloadSize > 65536) {
      // Bad payload size, resync
      buffer = buffer.subarray(4);
      continue;
    }

    // 3. Wait for full frame
    const frameSize = HEADER_SIZE + payloadSize;
    if (buffer.length < frameSize) {
      return;
    }

    // 4. Extract payload and send to AssemblyAI
    const payload = buffer.subarray(HEADER_SIZE, frameSize);
    buffer = buffer.subarray(frameSize);

    if (isConnected) {
      rt.sendAudio(payload);
    }
  }
}

function findMagic(buf, startOffset) {
  for (let i = startOffset; i <= buf.length - 4; i++) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x43 &&
      buf[i + 2] === 0x4d &&
      buf[i + 3] === 0x31
    ) {
      return i;
    }
  }
  return -1;
}

// --- Main Entry Point ---

async function start() {
  console.error("[gateway] Connecting to AssemblyAI Real-Time API...");
  try {
    await rt.connect();
  } catch (error) {
    console.error("[gateway] ❌ Failed to connect:", error);
    process.exit(1);
  }

  process.stdin.resume();
  process.stdin.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    processBuffer();
  });

  process.stdin.on('end', async () => {
    console.error("\n[gateway] Stream ended.");
    if (isConnected) {
      await rt.close();
    }
    process.exit(0);
  });

  process.stdin.on('error', (err) => {
    console.error(`\n[gateway] ❌ stdin error: ${err.message}`);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.error("\n[gateway] Ctrl+C received.");
    if (isConnected) {
      await rt.close();
    }
    process.exit(0);
  });
}

start();
