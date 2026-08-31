/**
 * smoke-recorder.js — validates the LLM usage recording layer WITHOUT a live
 * meeting or API key. Exercises BOTH writers against throwaway temp DBs, then
 * reads the rows back and prints them.
 *
 *   gateway/infrastructure/usage-store.js        (capture pipeline writer)
 *   chatbot/src/infrastructure/usage/UsageRecorder.js  (chatbot writer)
 *
 * Usage:  node dashboard/scripts/smoke-recorder.js
 * Exit code 0 = both writers persisted rows correctly; 1 = something failed.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'dashboard', 'node_modules', 'better-sqlite3'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-usage-smoke-'));
const gwDb = path.join(tmp, 'gw.db');
const cbDb = path.join(tmp, 'cb.db');
let failures = 0;

function check(label, cond) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
}

// --- 1. Gateway writer --------------------------------------------------------
console.log('\n[1] gateway/infrastructure/usage-store.js');
process.env.LLM_USAGE_DB = gwDb; // usage-store reads this at require time
const store = require(path.join(ROOT, 'gateway', 'infrastructure', 'usage-store.js'));
store.record({
  source: 'gateway', tag: 'analyst', provider: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna',
  expectJson: true, maxTokens: 512, timeoutMs: 20000, status: 'ok',
  attempts: 1, latencyMs: 1234, usage: { prompt_tokens: 700, completion_tokens: 120 },
  messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
  responsePreview: '{"decisions":[]}',
});
store.record({
  source: 'gateway', tag: 'risk', status: 'failed', errorCode: 429,
  errorMessage: 'rate limited', attempts: 3, latencyMs: 9000, model: 'gpt-5.6-luna',
});
store.close();

const gw = new Database(gwDb, { readonly: true });
const gwRows = gw.prepare('SELECT * FROM llm_requests ORDER BY id').all();
gw.close();
check('wrote 2 rows', gwRows.length === 2);
check('ok row has tokens + cost', gwRows[0].prompt_tokens === 700 && gwRows[0].total_tokens === 820 && gwRows[0].cost_usd > 0);
check('ok row stored payload', typeof gwRows[0].request_messages === 'string' && gwRows[0].request_messages.includes('hello'));
check('failed row captured error', gwRows[1].status === 'failed' && gwRows[1].error_code === '429');

// --- 2. Chatbot writer --------------------------------------------------------
console.log('\n[2] chatbot/src/infrastructure/usage/UsageRecorder.js');
const { UsageRecorder } = require(path.join(ROOT, 'chatbot', 'src', 'infrastructure', 'usage', 'UsageRecorder.js'));
const rec = new UsageRecorder({ dbPath: cbDb });
rec.record({
  source: 'chatbot', tag: 'generate', model: 'gpt-5.6-luna', expectJson: true,
  maxTokens: 1200, timeoutMs: 30000, status: 'ok', attempts: 1, latencyMs: 2500,
  usage: { prompt_tokens: 1500, completion_tokens: 300 },
  messages: [{ role: 'user', content: 'what did we decide?' }], responsePreview: 'answer',
});
rec.record({ tag: 'clarify', model: 'gpt-5.6-luna', status: 'failed', errorCode: 'network', errorMessage: 'timeout', attempts: 1, latencyMs: 30000 });
rec.close();

const cb = new Database(cbDb, { readonly: true });
const cbRows = cb.prepare('SELECT * FROM llm_requests ORDER BY id').all();
cb.close();
check('wrote 2 rows', cbRows.length === 2);
check('defaults source=chatbot', cbRows[1].source === 'chatbot');
check('ok row has tokens + cost', cbRows[0].completion_tokens === 300 && cbRows[0].cost_usd > 0);
check('failed row captured error', cbRows[1].status === 'failed' && cbRows[1].error_code === 'network');

// --- 3. Shared schema compatibility ------------------------------------------
console.log('\n[3] schema compatibility (both writers → same table shape)');
const gwCols = new Database(gwDb, { readonly: true }).prepare('PRAGMA table_info(llm_requests)').all().map((c) => c.name).join(',');
const cbCols = new Database(cbDb, { readonly: true }).prepare('PRAGMA table_info(llm_requests)').all().map((c) => c.name).join(',');
check('identical column sets', gwCols === cbCols);

// --- Cleanup ------------------------------------------------------------------
fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nSMOKE OK — recording layer works ✅\n' : `\nSMOKE FAILED — ${failures} check(s) failed ❌\n`);
process.exit(failures === 0 ? 0 : 1);
