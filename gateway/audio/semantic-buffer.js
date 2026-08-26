const { log, metrics } = require('../infrastructure/logger.js');

const FLUSH_WORD_THRESHOLD = 25;   // was 15 — more words = fewer LLM calls
const HARD_MAX_CHUNK_WORDS = 60;   // was 40 — allow bigger batches
const MIN_CHUNK_WORDS = 6;         // was 4 — avoid tiny chunks
const FLUSH_WALL_MS = 8000;        // was 5000 — wait longer before forcing flush
const SILENCE_MS = 3000;           // was 2000 — wait 3s of silence before flush

class SemanticBuffer {
  constructor(onChunkReady) {
    this.onChunkReady = onChunkReady;
    this.speakerBuffers = new Map();
    this.lastFlushTime = Date.now();
    this.flushTimer = null;
    
    this.flushChain = Promise.resolve();
    this.flushActive = false;
    this.flushAgain = false;
    this.draining = false;
  }

  totalWordCount() {
    let n = 0;
    for (const buf of this.speakerBuffers.values()) n += buf.wordCount;
    return n;
  }

  accept(speaker, text) {
    let buf = this.speakerBuffers.get(speaker);
    if (!buf) {
      buf = { texts: [], wordCount: 0 };
      this.speakerBuffers.set(speaker, buf);
    }
    buf.texts.push(text);
    buf.wordCount += text.split(/\s+/).filter(Boolean).length;
    
    this.onTranscriptReceived();
  }

  splitIntoChunks(texts) {
    const full = texts.join(' ').trim();
    if (!full) return [];
    const pieces = [];
    let words = full.split(/\s+/);
    while (words.length > HARD_MAX_CHUNK_WORDS) {
      let cut = -1;
      for (let i = Math.min(HARD_MAX_CHUNK_WORDS, words.length) - 1; i >= MIN_CHUNK_WORDS; i--) {
        if (/[.?!]["')\]]?$/.test(words[i])) { cut = i; break; }
      }
      if (cut === -1) cut = HARD_MAX_CHUNK_WORDS - 1;
      pieces.push(words.slice(0, cut + 1).join(' '));
      words = words.slice(cut + 1);
    }
    if (words.length > 0) pieces.push(words.join(' '));
    return pieces;
  }

  onTranscriptReceived() {
    if (this.draining) return;
    const words = this.totalWordCount();
    if (words > FLUSH_WORD_THRESHOLD || Date.now() - this.lastFlushTime > FLUSH_WALL_MS) {
      if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      this.scheduleFlush('size');
    } else {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => { this.flushTimer = null; this.scheduleFlush('silence'); }, SILENCE_MS);
    }
  }

  scheduleFlush(reason) {
    if (this.flushActive) { this.flushAgain = true; return; }
    this.flushActive = true;
    this.flushChain = this.flushChain.then(async () => {
      try {
        await this.flushNow(reason);
      } catch (err) {
        log('error', 'sidecar', 'flush_failed', { reason, message: (err.message || '').slice(0, 200) });
      } finally {
        this.flushActive = false;
        if (this.flushAgain) {
          this.flushAgain = false;
          this.scheduleFlush('trailing');
        }
      }
    });
  }

  async flushNow(reason) {
    if (this.speakerBuffers.size === 0) return;

    for (const [speaker, buf] of [...this.speakerBuffers.entries()]) {
      if (reason === 'size' && buf.wordCount < MIN_CHUNK_WORDS) continue;
      this.speakerBuffers.delete(speaker);
      const pieces = this.splitIntoChunks(buf.texts);
      for (const chunkText of pieces) {
        if (!chunkText.trim()) continue;
        await this.onChunkReady(chunkText, speaker);
      }
    }
    this.lastFlushTime = Date.now();
  }

  async drain() {
    this.draining = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    await this.flushChain;
    await this.flushNow('shutdown');
  }
}

module.exports = { SemanticBuffer };
