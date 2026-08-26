/**
 * PCM Stream Consumer — Node.js
 *
 * Reads framed PCM16 chunks from stdin (piped from the Rust audio capture process)
 * and validates stream integrity.
 *
 * Protocol:
 *   Each frame = 8-byte header + N-byte payload
 *   Header: 4 bytes magic ("PCM1" = 0x50434D31) + 4 bytes payload size (uint32 LE)
 *   Payload: raw PCM16 little-endian samples (16kHz, mono)
 *   Standard chunk: 4000 samples × 2 bytes = 8000 bytes payload
 *
 * Usage:
 *   cargo run -- --stream --duration 30 | node gateway/pcm-consumer.js
 *
 * This consumer:
 *   1. Parses the binary frame protocol
 *   2. Validates magic bytes and payload integrity
 *   3. Reports real-time statistics (chunks/sec, audio duration, data rate)
 *   4. Detects dropped chunks and timing anomalies
 */

const MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]); // "PCM1"
const HEADER_SIZE = 8;
const EXPECTED_PAYLOAD_SIZE = 8000; // 250ms at 16kHz mono PCM16
const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 250;

// ─── State ────────────────────────────────────────────────────────────────────

let buffer = Buffer.alloc(0);
let chunksReceived = 0;
let totalBytes = 0;
let totalSamples = 0;
let corruptedFrames = 0;
let shortChunks = 0;
let startTime = null;
let lastChunkTime = null;
let maxGapMs = 0;
let statsInterval = null;

// ─── Frame Parser ─────────────────────────────────────────────────────────────

function processBuffer() {
  while (buffer.length >= HEADER_SIZE) {
    // Check magic bytes.
    const magic = buffer.subarray(0, 4);
    if (!magic.equals(MAGIC)) {
      // Try to resync: scan for next magic bytes.
      const idx = findMagic(buffer, 1);
      if (idx === -1) {
        // No magic found — discard all but last 3 bytes (partial magic).
        const keep = Math.min(buffer.length, 3);
        buffer = buffer.subarray(buffer.length - keep);
        corruptedFrames++;
        return;
      }
      // Skip to next magic.
      console.error(
        `[consumer] ⚠️  Frame sync lost, skipped ${idx} bytes`
      );
      buffer = buffer.subarray(idx);
      corruptedFrames++;
      continue;
    }

    // Read payload size.
    const payloadSize = buffer.readUInt32LE(4);

    // Validate payload size is reasonable (max 64KB).
    if (payloadSize > 65536) {
      console.error(
        `[consumer] ⚠️  Unreasonable payload size: ${payloadSize}, resyncing`
      );
      buffer = buffer.subarray(4); // Skip past bad magic match.
      corruptedFrames++;
      continue;
    }

    // Check if we have the full frame.
    const frameSize = HEADER_SIZE + payloadSize;
    if (buffer.length < frameSize) {
      // Wait for more data.
      return;
    }

    // Extract payload.
    const payload = buffer.subarray(HEADER_SIZE, frameSize);
    buffer = buffer.subarray(frameSize);

    // Process the chunk.
    handleChunk(payload, payloadSize);
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

// ─── Chunk Handler ────────────────────────────────────────────────────────────

function handleChunk(payload, payloadSize) {
  const now = Date.now();

  if (startTime === null) {
    startTime = now;
    console.error("[consumer] 🎙️  First chunk received — stream is live");
  }

  // Track timing gaps between chunks.
  if (lastChunkTime !== null) {
    const gapMs = now - lastChunkTime;
    if (gapMs > maxGapMs) maxGapMs = gapMs;

    // Warn if gap exceeds 2× expected interval (500ms).
    if (gapMs > CHUNK_DURATION_MS * 2) {
      console.error(
        `[consumer] ⚠️  Large gap between chunks: ${gapMs}ms (expected ~${CHUNK_DURATION_MS}ms)`
      );
    }
  }
  lastChunkTime = now;

  // Track short chunks (final flush chunk at end of session).
  if (payloadSize !== EXPECTED_PAYLOAD_SIZE) {
    shortChunks++;
  }

  const numSamples = payloadSize / 2;
  chunksReceived++;
  totalBytes += payloadSize;
  totalSamples += numSamples;

  // Calculate RMS level for this chunk (simple energy indicator).
  let sumSquares = 0;
  for (let i = 0; i < payload.length - 1; i += 2) {
    const sample = payload.readInt16LE(i);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / numSamples);
  const dbLevel = rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;

  // Visual level indicator.
  const level =
    dbLevel > -20 ? "█████" : dbLevel > -35 ? "███  " : dbLevel > -50 ? "██   " : dbLevel > -70 ? "█    " : "·    ";

  // Print per-chunk info (every 4th chunk = once per second).
  if (chunksReceived % 4 === 0) {
    const elapsedSec = ((now - startTime) / 1000).toFixed(1);
    const audioDuration = (totalSamples / SAMPLE_RATE).toFixed(1);
    process.stderr.write(
      `\r[consumer] chunks: ${chunksReceived} | audio: ${audioDuration}s | elapsed: ${elapsedSec}s | level: ${level} ${dbLevel.toFixed(0)}dB  `
    );
  }
}

// ─── Stats Reporter ───────────────────────────────────────────────────────────

function printStats() {
  if (chunksReceived === 0) return;

  const elapsed = (Date.now() - startTime) / 1000;
  const audioDuration = totalSamples / SAMPLE_RATE;
  const dataRateKBs = totalBytes / elapsed / 1024;
  const expectedChunks = Math.floor(elapsed / (CHUNK_DURATION_MS / 1000));
  const chunkLoss =
    expectedChunks > 0
      ? (((expectedChunks - chunksReceived) / expectedChunks) * 100).toFixed(2)
      : "0.00";

  console.error(`\n[consumer] ──── Stats ────`);
  console.error(`  Chunks received:   ${chunksReceived}`);
  console.error(`  Chunks expected:   ~${expectedChunks}`);
  console.error(`  Chunk loss:        ${chunkLoss}%`);
  console.error(`  Short chunks:      ${shortChunks}`);
  console.error(`  Corrupted frames:  ${corruptedFrames}`);
  console.error(`  Audio duration:    ${audioDuration.toFixed(2)}s`);
  console.error(`  Wall-clock time:   ${elapsed.toFixed(2)}s`);
  console.error(`  Data rate:         ${dataRateKBs.toFixed(1)} KB/s`);
  console.error(`  Max chunk gap:     ${maxGapMs}ms`);
  console.error(`  Total data:        ${(totalBytes / 1024).toFixed(1)} KB`);
  console.error(`[consumer] ──────────────\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Set stdin to binary mode.
process.stdin.resume();

process.stdin.on("data", (data) => {
  buffer = Buffer.concat([buffer, data]);
  processBuffer();
});

process.stdin.on("end", () => {
  // Process any remaining buffered data.
  processBuffer();
  printStats();
  console.error("[consumer] ✅ Stream ended.");
  process.exit(0);
});

process.stdin.on("error", (err) => {
  console.error(`[consumer] ❌ stdin error: ${err.message}`);
  printStats();
  process.exit(1);
});

// Print periodic stats every 30 seconds.
statsInterval = setInterval(printStats, 30000);

// Clean shutdown.
process.on("SIGINT", () => {
  console.error("\n[consumer] Ctrl+C received.");
  printStats();
  clearInterval(statsInterval);
  process.exit(0);
});

console.error("[consumer] Waiting for PCM stream on stdin...");
console.error(
  `[consumer] Expected format: ${HEADER_SIZE}B header + ${EXPECTED_PAYLOAD_SIZE}B payload per chunk (${CHUNK_DURATION_MS}ms)`
);
