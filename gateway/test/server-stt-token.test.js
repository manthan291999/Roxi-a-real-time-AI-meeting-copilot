'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config/index.js');
const { buildChain } = require('../stt/provider-registry.js');
const { resolveServerBackedStt } = require('../stt/server-token.js');

test('server auth is a valid production STT configuration', () => {
  const cfg = config.load({
    env: { ROXI_API_URL: 'https://api.roxi.test', ROXI_ACCESS_TOKEN: 'user-token' },
    argv: [],
  });
  assert.deepEqual(config.validate(cfg), { ok: true });
});

test('exchanges the user token and builds an AssemblyAI token provider', async () => {
  const stt = {
    roxiApiUrl: 'https://api.roxi.test',
    roxiAccessToken: 'user-token',
    assemblyaiKey: null,
    speechmaticsKey: null,
    languages: ['en'],
  };
  const resolved = await resolveServerBackedStt(stt, async (url, request) => {
    assert.equal(url, 'https://api.roxi.test/v1/stt/token');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer user-token');
    return {
      ok: true,
      async json() { return { provider: 'assemblyai', token: 'temporary-token' }; },
    };
  });
  assert.equal(resolved.assemblyaiToken, 'temporary-token');
  assert.equal(buildChain(resolved)[0].name, 'assemblyai');
});

test('never calls the server in explicit direct-provider development mode', async () => {
  const stt = { assemblyaiKey: 'development-key', speechmaticsKey: null };
  const resolved = await resolveServerBackedStt(stt, async () => {
    throw new Error('must not be called');
  });
  assert.equal(resolved, stt);
});
