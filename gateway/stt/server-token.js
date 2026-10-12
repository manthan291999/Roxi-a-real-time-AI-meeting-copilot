'use strict';

/**
 * Replace server credentials with a short-lived AssemblyAI token. Direct
 * provider keys remain available only for explicit local development.
 */
async function resolveServerBackedStt(stt, fetchImpl = globalThis.fetch) {
  if (stt.assemblyaiKey || stt.speechmaticsKey) return stt;
  const response = await fetchImpl(`${stt.roxiApiUrl}/v1/stt/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stt.roxiAccessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Roxi STT token request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (payload.provider !== 'assemblyai' || !payload.token) {
    throw new Error('Roxi API returned an invalid STT token response');
  }
  return Object.freeze({ ...stt, assemblyaiToken: payload.token });
}

module.exports = { resolveServerBackedStt };
