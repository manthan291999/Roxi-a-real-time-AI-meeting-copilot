/**
 * Unit tests: webPolicy — the pure mode-to-tool-availability rule.
 *
 * The property that matters most is the last block: an unset mode must be
 * OFF, because that is what keeps every pre-existing routing decision (and
 * every pre-existing test) identical after this feature landed.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeWebMode, decideWebTools } = require('../src/application/graph/webPolicy');
const { WEB_MODES } = require('../src/application/graph/constants');

test('auto offers the tool and leaves the choice to the model', () => {
  assert.deepStrictEqual(decideWebTools(WEB_MODES.AUTO), {
    enabled: true, toolChoice: 'auto', mandatory: false,
  });
});

test('always forces a search and marks the turn mandatory', () => {
  assert.deepStrictEqual(decideWebTools(WEB_MODES.ALWAYS), {
    enabled: true, toolChoice: 'required', mandatory: true,
  });
});

test('never sends no tool at all — enforcement is structural', () => {
  assert.deepStrictEqual(decideWebTools(WEB_MODES.NEVER), {
    enabled: false, toolChoice: 'none', mandatory: false,
  });
});

test('mandatory is only ever true for always', () => {
  // It decides whether a failure may degrade to an unsourced answer, so a
  // false positive here would let 'auto' refuse and 'always' mislead.
  assert.strictEqual(decideWebTools(WEB_MODES.AUTO).mandatory, false);
  assert.strictEqual(decideWebTools(WEB_MODES.NEVER).mandatory, false);
  assert.strictEqual(decideWebTools(WEB_MODES.ALWAYS).mandatory, true);
});

test('anything unrecognised is off, not on', () => {
  // The cheap, private path. A typo or a stale client must never silently
  // change what a turn costs or where the question travels.
  for (const bad of [undefined, null, '', 'AUTO', 'Always', 'yes', 'true', 1, 0, {}, []]) {
    assert.strictEqual(normalizeWebMode(bad), WEB_MODES.NEVER, `normalize ${JSON.stringify(bad)}`);
    assert.strictEqual(decideWebTools(bad).enabled, false, `decide ${JSON.stringify(bad)}`);
  }
});

test('known modes pass through normalization unchanged', () => {
  assert.strictEqual(normalizeWebMode('auto'), 'auto');
  assert.strictEqual(normalizeWebMode('always'), 'always');
  assert.strictEqual(normalizeWebMode('never'), 'never');
});
