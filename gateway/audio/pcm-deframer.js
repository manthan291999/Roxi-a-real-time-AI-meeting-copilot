const MAGIC = Buffer.from([0x50, 0x43, 0x4d, 0x31]);
const HEADER_SIZE = 8;

class PcmDeframer {
  constructor(audioSink) {
    this.audioSink = audioSink;
    this.buffer = Buffer.alloc(0);
  }

  append(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.parseFrames();
  }

  parseFrames() {
    while (this.buffer.length >= HEADER_SIZE) {
      const magic = this.buffer.subarray(0, 4);
      if (!magic.equals(MAGIC)) {
        const idx = this.scanForMagicBytes(this.buffer, 1);
        if (idx === -1) {
          const keep = Math.min(this.buffer.length, 3);
          this.buffer = this.buffer.subarray(this.buffer.length - keep);
          return;
        }
        this.buffer = this.buffer.subarray(idx);
        continue;
      }

      const payloadSize = this.buffer.readUInt32LE(4);
      if (payloadSize > 65536) {
        this.buffer = this.buffer.subarray(4);
        continue;
      }

      const frameSize = HEADER_SIZE + payloadSize;
      if (this.buffer.length < frameSize) {
        return;
      }

      const payload = this.buffer.subarray(HEADER_SIZE, frameSize);
      this.buffer = this.buffer.subarray(frameSize);

      this.audioSink.sendAudio(payload);
    }
  }

  scanForMagicBytes(buf, startOffset) {
    for (let i = startOffset; i <= buf.length - 4; i++) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x43 && buf[i + 2] === 0x4d && buf[i + 3] === 0x31) {
        return i;
      }
    }
    return -1;
  }
}

module.exports = { PcmDeframer };
