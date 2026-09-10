/**
 * AI Meeting Interpreter — Pure-JS MFCC Feature Extractor
 *
 * Extracts 13 Mel-Frequency Cepstral Coefficients from a PCM16 Int16Array.
 * Used by diarization-layer.js to build speaker voice embeddings.
 *
 * Pipeline per frame:
 *   PCM16 samples → Hamming window → Power spectrum (DFT) → Mel filterbanks → Log → DCT → 13 MFCCs
 *
 * Output: a 13-element Float32Array (mean-pooled over all frames).
 */

'use strict';

const NUM_COEFFS   = 13;
const FRAME_SIZE   = 512;    // samples per frame  (~32ms @ 16kHz)
const FRAME_STEP   = 256;    // hop size           (~50% overlap)
const NUM_FILTERS  = 26;     // Mel filterbanks
const SAMPLE_RATE  = 16000;  // Hz (AssemblyAI / Speechmatics both use 16kHz)
const MIN_HZ       = 300;    // speech fundamental range
const MAX_HZ       = 3400;

// --- Helpers -------------------------------------------------------------------

function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1); }

/** Build Hamming window coefficients (cached). */
const hammingCache = new Map();
function hammingWindow(n) {
  if (hammingCache.has(n)) return hammingCache.get(n);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  hammingCache.set(n, w);
  return w;
}

/**
 * Real-valued DFT via naive O(N²) sum (N=512 — acceptable for diarization,
 * not for real-time audio processing). Returns power spectrum (length N/2+1).
 */
function powerSpectrum(frame) {
  const N = frame.length;
  const half = Math.floor(N / 2) + 1;
  const power = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    let re = 0, im = 0;
    const step = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += frame[n] * Math.cos(step * n);
      im -= frame[n] * Math.sin(step * n);
    }
    power[k] = (re * re + im * im) / N;
  }
  return power;
}

/** Build Mel filterbank matrix (cached). */
let _melMatrix = null;
function getMelMatrix() {
  if (_melMatrix) return _melMatrix;
  const half = Math.floor(FRAME_SIZE / 2) + 1;
  const melMin = hzToMel(MIN_HZ);
  const melMax = hzToMel(MAX_HZ);
  // NUM_FILTERS + 2 equally-spaced Mel points
  const melPoints = new Float32Array(NUM_FILTERS + 2);
  for (let i = 0; i < melPoints.length; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (NUM_FILTERS + 1);
  }
  // Convert to FFT bin indices
  const binPoints = melPoints.map(m => Math.floor((melToHz(m) / (SAMPLE_RATE / 2)) * (half - 1)));

  _melMatrix = [];
  for (let m = 1; m <= NUM_FILTERS; m++) {
    const filter = new Float32Array(half);
    for (let k = binPoints[m - 1]; k <= binPoints[m]; k++) {
      filter[k] = (k - binPoints[m - 1]) / (binPoints[m] - binPoints[m - 1] + 1e-10);
    }
    for (let k = binPoints[m]; k <= binPoints[m + 1]; k++) {
      filter[k] = (binPoints[m + 1] - k) / (binPoints[m + 1] - binPoints[m] + 1e-10);
    }
    _melMatrix.push(filter);
  }
  return _melMatrix;
}

/** DCT-II of a length-N array, returning first NUM_COEFFS coefficients. */
function dct(x) {
  const N = x.length;
  const out = new Float32Array(NUM_COEFFS);
  for (let k = 0; k < NUM_COEFFS; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += x[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
    }
    out[k] = sum;
  }
  return out;
}

// --- Public API ----------------------------------------------------------------

/**
 * Extract mean MFCC vector from a PCM16 buffer (Int16Array or Buffer).
 *
 * @param {Int16Array|Buffer} pcm16  Raw PCM16 audio samples at SAMPLE_RATE Hz
 * @returns {Float32Array}           13-element MFCC vector, or null if too short
 */
function extractMFCC(pcm16) {
  // Normalise to Float32 in [-1, 1]
  let samples;
  if (pcm16 instanceof Int16Array) {
    samples = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) samples[i] = pcm16[i] / 32768;
  } else if (Buffer.isBuffer(pcm16)) {
    const len = Math.floor(pcm16.length / 2);
    samples = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      samples[i] = pcm16.readInt16LE(i * 2) / 32768;
    }
  } else {
    return null;
  }

  if (samples.length < FRAME_SIZE) return null; // too short to extract features

  const hamming = hammingWindow(FRAME_SIZE);
  const melMatrix = getMelMatrix();
  const accumulator = new Float32Array(NUM_COEFFS);
  let frameCount = 0;

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += FRAME_STEP) {
    // Apply Hamming window
    const frame = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) frame[i] = samples[start + i] * hamming[i];

    // Power spectrum
    const power = powerSpectrum(frame);

    // Mel filterbank energies
    const melEnergies = new Float32Array(NUM_FILTERS);
    for (let m = 0; m < NUM_FILTERS; m++) {
      let energy = 0;
      for (let k = 0; k < power.length; k++) energy += melMatrix[m][k] * power[k];
      melEnergies[m] = Math.log(energy + 1e-10);
    }

    // DCT → MFCCs
    const coeffs = dct(melEnergies);
    for (let c = 0; c < NUM_COEFFS; c++) accumulator[c] += coeffs[c];
    frameCount++;
  }

  if (frameCount === 0) return null;
  for (let c = 0; c < NUM_COEFFS; c++) accumulator[c] /= frameCount;
  return accumulator;
}

/**
 * Cosine similarity between two Float32Arrays of equal length.
 *
 * A length mismatch (e.g. a speaker_embeddings row persisted under a
 * previous NUM_COEFFS) silently produced NaN/garbage comparisons rather than
 * a clean "no match" — NaN losing every `>` comparison happened to make this
 * safe today, but only by accident. Guard it explicitly so schema drift can
 * never turn into wrong voice matches or a thrown exception.
 * @returns {number} value in [-1, 1]; higher = more similar
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom < 1e-10 ? 0 : dot / denom;
}

module.exports = { extractMFCC, cosineSimilarity, NUM_COEFFS };
