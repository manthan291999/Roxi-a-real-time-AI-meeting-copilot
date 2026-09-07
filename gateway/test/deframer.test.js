/**
 * The deframer sits in the audio hot path and now carries two frame types, so a
 * malformed control frame must never disturb audio. These cover interleaving,
 * split frames, and deliberate corruption.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { PcmDeframer, MAGIC_PCM, MAGIC_CTL } = require('../audio/pcm-deframer.js');

function frame(magic, payload) {
  const header = Buffer.alloc(8);
  magic.copy(header, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

const pcmFrame = (bytes) => frame(MAGIC_PCM, Buffer.from(bytes));
const ctlFrame = (obj) => frame(MAGIC_CTL, Buffer.from(JSON.stringify(obj), 'utf8'));

function harness() {
  const audio = [];
  const commands = [];
  const deframer = new PcmDeframer(
    { sendAudio: (p) => audio.push(p) },
    { handle: (c) => commands.push(c) }
  );
  return { deframer, audio, commands };
}

test('parses a single audio frame', () => {
  const { deframer, audio } = harness();
  deframer.append(pcmFrame([1, 2, 3, 4]));
  assert.strictEqual(audio.length, 1);
  assert.deepStrictEqual([...audio[0]], [1, 2, 3, 4]);
});

test('routes interleaved audio and control frames to the right sinks', () => {
  const { deframer, audio, commands } = harness();
  deframer.append(
    Buffer.concat([
      pcmFrame([1, 1]),
      ctlFrame({ command: 'renameSpeaker', sttLabel: 'Speaker A', displayName: 'Alice' }),
      pcmFrame([2, 2]),
    ])
  );
  assert.strictEqual(audio.length, 2);
  assert.strictEqual(commands.length, 1);
  assert.strictEqual(commands[0].displayName, 'Alice');
});

test('reassembles a frame split across chunk boundaries', () => {
  const { deframer, audio } = harness();
  const full = pcmFrame([9, 8, 7, 6, 5, 4]);
  deframer.append(full.subarray(0, 3));
  deframer.append(full.subarray(3, 10));
  assert.strictEqual(audio.length, 0, 'must wait for the complete payload');
  deframer.append(full.subarray(10));
  assert.strictEqual(audio.length, 1);
  assert.deepStrictEqual([...audio[0]], [9, 8, 7, 6, 5, 4]);
});

test('resyncs past leading garbage', () => {
  const { deframer, audio } = harness();
  deframer.append(Buffer.concat([Buffer.from([0xde, 0xad, 0xbe, 0xef]), pcmFrame([1, 2])]));
  assert.strictEqual(audio.length, 1);
  assert.deepStrictEqual([...audio[0]], [1, 2]);
});

test('a malformed control frame does not disturb surrounding audio', () => {
  const { deframer, audio, commands } = harness();
  const badJson = frame(MAGIC_CTL, Buffer.from('{not valid json', 'utf8'));
  deframer.append(Buffer.concat([pcmFrame([1]), badJson, pcmFrame([2])]));
  assert.strictEqual(commands.length, 0, 'unparseable command is dropped');
  assert.strictEqual(audio.length, 2, 'both audio frames still delivered');
});

test('a throwing control handler does not disturb surrounding audio', () => {
  const audio = [];
  const deframer = new PcmDeframer(
    { sendAudio: (p) => audio.push(p) },
    { handle: () => { throw new Error('handler blew up'); } }
  );
  deframer.append(
    Buffer.concat([pcmFrame([1]), ctlFrame({ command: 'persistChunk' }), pcmFrame([2])])
  );
  assert.strictEqual(audio.length, 2, 'audio survives a failing command');
});

test('rejects an oversized payload length and resyncs', () => {
  const { deframer, audio } = harness();
  const bogus = Buffer.alloc(8);
  MAGIC_PCM.copy(bogus, 0);
  bogus.writeUInt32LE(999999, 4); // beyond MAX_PAYLOAD
  deframer.append(Buffer.concat([bogus, pcmFrame([7, 7])]));
  assert.strictEqual(audio.length, 1);
  assert.deepStrictEqual([...audio[0]], [7, 7]);
});

test('tolerates control frames when no handler is installed', () => {
  const audio = [];
  const deframer = new PcmDeframer({ sendAudio: (p) => audio.push(p) });
  deframer.append(Buffer.concat([ctlFrame({ command: 'renameSpeaker' }), pcmFrame([3])]));
  assert.strictEqual(audio.length, 1, 'control frame consumed, audio unaffected');
});
