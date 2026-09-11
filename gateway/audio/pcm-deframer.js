/**
 * AI Meeting Interpreter — Stdin Frame Deframer
 *
 * Parses the binary frame protocol the Rust host writes to this process's
 * stdin. Two frame types share the stream:
 *
 *   PCM1 | uint32 payloadSize | PCM16LE audio      → audio sink
 *   CTL1 | uint32 payloadSize | UTF-8 JSON command → control handler
 *
 * Both use an 8-byte header, so a single scan handles both and an unrecognized
 * or corrupt header resyncs by scanning forward for either magic. Control
 * frames are rare and small; audio frames are ~3.2KB every 100ms.
 *
 * The audio path must never be blocked by a malformed control frame, so JSON
 * parse failures are reported and skipped rather than thrown.
 */

'use strict';

const { log } = require('../infrastructure/logger.js');

const MAGIC_PCM = Buffer.from([0x50, 0x43, 0x4d, 0x31]); // "PCM1"
const MAGIC_CTL = Buffer.from([0x43, 0x54, 0x4c, 0x31]); // "CTL1"
const HEADER_SIZE = 8;
const MAX_PAYLOAD = 65536;

class PcmDeframer {
  /**
   * @param {{sendAudio: (payload: Buffer) => void}} audioSink
   * @param {{handle: (command: Object) => void}} [controlHandler]
   *   Omit to ignore control frames (they are still parsed and skipped safely).
   */
  constructor(audioSink, controlHandler = null) {
    this.audioSink = audioSink;
    this.controlHandler = controlHandler;
    this.buffer = Buffer.alloc(0);
  }

  append(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.parseFrames();
  }

  parseFrames() {
    while (this.buffer.length >= HEADER_SIZE) {
      const kind = this.frameKindAt(0);

      if (!kind) {
        // Not a known magic: resync to the next one anywhere in the buffer.
        const idx = this.scanForMagic(1);
        if (idx === -1) {
          // Keep a possible partial magic straddling the chunk boundary.
          const keep = Math.min(this.buffer.length, 3);
          this.buffer = this.buffer.subarray(this.buffer.length - keep);
          return;
        }
        this.buffer = this.buffer.subarray(idx);
        continue;
      }

      const payloadSize = this.buffer.readUInt32LE(4);
      if (payloadSize > MAX_PAYLOAD) {
        // Almost certainly a false magic match inside audio data — step past it.
        this.buffer = this.buffer.subarray(4);
        continue;
      }

      const frameSize = HEADER_SIZE + payloadSize;
      if (this.buffer.length < frameSize) return; // await the rest of the frame

      const payload = this.buffer.subarray(HEADER_SIZE, frameSize);
      this.buffer = this.buffer.subarray(frameSize);

      if (kind === 'pcm') {
        this.audioSink.sendAudio(payload);
      } else {
        this.dispatchControl(payload);
      }
    }
  }

  dispatchControl(payload) {
    if (!this.controlHandler) return;
    let command;
    try {
      command = JSON.parse(payload.toString('utf8'));
    } catch (err) {
      log('warn', 'deframer', 'control_frame_parse_failed', { message: err.message });
      return;
    }
    try {
      this.controlHandler.handle(command);
    } catch (err) {
      // A failing command must not take down the audio pipeline.
      log('error', 'deframer', 'control_handler_failed', { message: err.message });
    }
  }

  /** @returns {'pcm'|'ctl'|null} */
  frameKindAt(offset) {
    if (this.buffer.length - offset < 4) return null;
    const slice = this.buffer.subarray(offset, offset + 4);
    if (slice.equals(MAGIC_PCM)) return 'pcm';
    if (slice.equals(MAGIC_CTL)) return 'ctl';
    return null;
  }

  /** Index of the next frame magic at or after `startOffset`, or -1. */
  scanForMagic(startOffset) {
    for (let i = startOffset; i <= this.buffer.length - 4; i++) {
      if (this.frameKindAt(i)) return i;
    }
    return -1;
  }
}

module.exports = { PcmDeframer, MAGIC_PCM, MAGIC_CTL, HEADER_SIZE, MAX_PAYLOAD };
