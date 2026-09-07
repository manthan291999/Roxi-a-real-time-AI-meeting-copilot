/**
 * Guards the Rust↔Node wire contract.
 *
 * Every type the gateway can emit must have a matching arm in
 * src-tauri/src/sidecar/event_router.rs. Without this test the two sides drift
 * silently: the router's fallback arm is `_ => {}`, so an unrecognized message
 * is discarded with no error. That had already happened — the gateway emitted a
 * `Connected` message for which no arm existed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { EventType } = require('../infrastructure/stdout-protocol.js');

const ROUTER = path.join(__dirname, '..', '..', 'src-tauri', 'src', 'sidecar', 'event_router.rs');

/** Match arms of the form `"Name" => {` in the router. */
function routerArms() {
  const source = fs.readFileSync(ROUTER, 'utf8');
  return new Set([...source.matchAll(/^\s*"([A-Za-z]+)"\s*=>/gm)].map((m) => m[1]));
}

test('every emitted event type has a handler in event_router.rs', () => {
  const arms = routerArms();
  const unhandled = Object.values(EventType).filter((t) => !arms.has(t));
  assert.deepStrictEqual(
    unhandled,
    [],
    `Gateway emits types the Rust router will silently drop: ${unhandled.join(', ')}`
  );
});

test('emit() refuses an unregistered type', () => {
  const { emit } = require('../infrastructure/stdout-protocol.js');
  const written = [];
  const realStdout = process.stdout.write;
  const realStderr = process.stderr.write;
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  process.stderr.write = () => true;
  try {
    emit('NotARealType', { text: 'x' });
  } finally {
    process.stdout.write = realStdout;
    process.stderr.write = realStderr;
  }
  assert.strictEqual(written.length, 0, 'an unregistered type must not reach stdout');
});

test('typed emitters produce parseable single-line JSON', () => {
  const { emitFinal } = require('../infrastructure/stdout-protocol.js');
  const written = [];
  const realStdout = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  try {
    emitFinal('hello there', 'Alice', 'Speaker A', 1.0, 2.0);
  } finally {
    process.stdout.write = realStdout;
  }
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0].endsWith('\n'), true, 'messages must be newline-delimited');
  const parsed = JSON.parse(written[0]);
  assert.strictEqual(parsed.type, 'Final');
  assert.strictEqual(parsed.text, 'hello there');
  assert.strictEqual(parsed.speaker, 'Alice');
  assert.strictEqual(parsed.sttLabel, 'Speaker A');
});
