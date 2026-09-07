#!/usr/bin/env node
/**
 * PCM Stream Diagnostics
 *
 * Reads the framed audio stream from stdin and reports throughput, gaps, and
 * signal level. A development aid, not part of the running app.
 *
 *   cargo run -- --stream --duration 30 | node gateway/tools/pcm-consumer.js
 *
 * Frame parsing is delegated to the production deframer rather than duplicated
 * here — this file used to carry its own near-identical copy, so a protocol
 * change had to be made in two places and could silently diverge.
 */

'use strict';

const { PcmDeframer } = require('../audio/pcm-deframer.js');

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 250;
const EXPECTED_PAYLOAD_SIZE = 8000; // 250ms at 16kHz mono PCM16

const stats = {
  chunks: 0,
  bytes: 0,
  samples: 0,
  shortChunks: 0,
  startTime: null,
  lastChunkTime: null,
  maxGapMs: 0,
};

/** Mean signal level of a PCM16 chunk, in dBFS. */
function chunkLevelDb(payload) {
  const sampleCount = Math.floor(payload.length / 2);
  if (sampleCount === 0) return -Infinity;
  let sumSquares = 0;
  for (let i = 0; i + 1 < payload.length; i += 2) {
    const sample = payload.readInt16LE(i);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;
}

function levelBar(db) {
  if (db > -20) return '#####';
  if (db > -35) return '###  ';
  if (db > -50) return '##   ';
  if (db > -70) return '#    ';
  return '.    ';
}

function onChunk(payload) {
  const now = Date.now();

  if (stats.startTime === null) {
    stats.startTime = now;
    console.error('[consumer] First chunk received — stream is live');
  }

  if (stats.lastChunkTime !== null) {
    const gapMs = now - stats.lastChunkTime;
    if (gapMs > stats.maxGapMs) stats.maxGapMs = gapMs;
    if (gapMs > CHUNK_DURATION_MS * 2) {
      console.error(
        `[consumer] Large gap between chunks: ${gapMs}ms (expected ~${CHUNK_DURATION_MS}ms)`
      );
    }
  }
  stats.lastChunkTime = now;

  if (payload.length !== EXPECTED_PAYLOAD_SIZE) stats.shortChunks++;
  stats.chunks++;
  stats.bytes += payload.length;
  stats.samples += payload.length / 2;

  if (stats.chunks % 4 === 0) {
    const db = chunkLevelDb(payload);
    const elapsedSec = ((now - stats.startTime) / 1000).toFixed(1);
    const audioSec = (stats.samples / SAMPLE_RATE).toFixed(1);
    process.stderr.write(
      `\r[consumer] chunks: ${stats.chunks} | audio: ${audioSec}s | ` +
        `elapsed: ${elapsedSec}s | level: ${levelBar(db)} ${db.toFixed(0)}dB  `
    );
  }
}

function printStats() {
  if (stats.chunks === 0) return;
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const expected = Math.floor(elapsed / (CHUNK_DURATION_MS / 1000));
  const loss = expected > 0 ? (((expected - stats.chunks) / expected) * 100).toFixed(2) : '0.00';

  console.error('\n[consumer] ---- Stats ----');
  console.error(`  Chunks received:   ${stats.chunks}`);
  console.error(`  Chunks expected:   ~${expected}`);
  console.error(`  Chunk loss:        ${loss}%`);
  console.error(`  Short chunks:      ${stats.shortChunks}`);
  console.error(`  Audio duration:    ${(stats.samples / SAMPLE_RATE).toFixed(2)}s`);
  console.error(`  Wall-clock time:   ${elapsed.toFixed(2)}s`);
  console.error(`  Data rate:         ${(stats.bytes / elapsed / 1024).toFixed(1)} KB/s`);
  console.error(`  Max chunk gap:     ${stats.maxGapMs}ms`);
  console.error(`  Total data:        ${(stats.bytes / 1024).toFixed(1)} KB`);
  console.error('[consumer] ---------------\n');
}

const deframer = new PcmDeframer(
  { sendAudio: onChunk },
  { handle: (cmd) => console.error(`[consumer] control frame: ${cmd.command}`) }
);

process.stdin.resume();
process.stdin.on('data', (data) => deframer.append(data));
process.stdin.on('end', () => {
  printStats();
  console.error('[consumer] Stream ended.');
  process.exit(0);
});
process.stdin.on('error', (err) => {
  console.error(`[consumer] stdin error: ${err.message}`);
  printStats();
  process.exit(1);
});

const statsInterval = setInterval(printStats, 30000);
if (statsInterval.unref) statsInterval.unref();

process.on('SIGINT', () => {
  console.error('\n[consumer] Ctrl+C received.');
  printStats();
  process.exit(0);
});

console.error('[consumer] Waiting for PCM stream on stdin...');
