/* LLM Usage Dashboard — vanilla JS single-page app (no build step). */
/* global Chart */

'use strict';

// --- Tiny helpers -------------------------------------------------------------

const $view = document.getElementById('view');
const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const fmt = {
  int: (n) => (n == null ? '—' : Number(n).toLocaleString('en-US')),
  usd: (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`),
  ms: (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('en-US')} ms`),
  ts: (iso) => {
    if (!iso) return '—';
    const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  },
  tshort: (iso) => {
    if (!iso) return '—';
    const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },
};

function badge(kind, text) { return `<span class="badge ${kind}">${esc(text)}</span>`; }

function emptyState(msg) {
  return `<div class="empty">${esc(msg)}<br><code>cd dashboard &amp;&amp; npm run seed</code> for demo data, or run a real meeting.</div>`;
}

// --- Chart management ----------------------------------------------------------

const charts = {};
function makeChart(id, config) {
  if (typeof Chart === 'undefined') return; // CDN blocked → tables still work
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  Chart.defaults.color = '#8b93a7';
  Chart.defaults.borderColor = 'rgba(36, 44, 63, 0.8)';
  charts[id] = new Chart(ctx, config);
}

// --- Router ---------------------------------------------------------------------

const routes = {
  overview: renderOverview,
  requests: renderRequests,
  detail: renderDetail,
  codemap: renderCodemap,
};

function currentRoute() {
  const h = location.hash || '#/overview';
  const m = h.match(/^#\/([a-z]+)\/?(.*)$/);
  return { tab: m?.[1] || 'overview', arg: m?.[2] || '' };
}

async function route() {
  const { tab, arg } = currentRoute();
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === tab);
  });
  $view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await (routes[tab] || renderOverview)(arg);
  } catch (err) {
    $view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}<br>Is the dashboard server running?</div>`;
  }
}

let isLive = false;
let liveTimer = null;

function setLive(active) {
  isLive = active;
  const btn = document.getElementById('live-btn');
  if (!btn) return;
  if (isLive) {
    btn.textContent = '🟢 Live: 5s';
    btn.classList.add('active');
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(async () => {
      const { tab } = currentRoute();
      if (tab === 'overview') {
        // Soft refresh without wiping DOM loader
        const [summary, byAgent, timeline, histogram, sessions, cacheStats, prefixStats] = await Promise.all([
          api.get('/api/summary'),
          api.get('/api/by-agent'),
          api.get('/api/timeline'),
          api.get('/api/latency-histogram'),
          api.get('/api/sessions'),
          api.get('/api/cache-stats'),
          api.get('/api/prefix-stats'),
        ]);
        if (summary.dbAvailable && summary.requests > 0) {
          renderOverviewCharts(byAgent, timeline, histogram, cacheStats);
        }
      } else if (tab === 'requests') {
        await loadRequestRows();
      }
      refreshDbStatus();
    }, 5000);
  } else {
    btn.textContent = '🔴 Live: Off';
    btn.classList.remove('active');
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  }
}

window.addEventListener('hashchange', route);
document.getElementById('refresh-btn').addEventListener('click', route);
document.getElementById('live-btn').addEventListener('click', () => setLive(!isLive));

// --- DB status pill ----------------------------------------------------------------

async function refreshDbStatus() {
  const el = document.getElementById('db-status');
  try {
    const h = await api.get('/api/health');
    if (h.dbAvailable) { el.textContent = '● DB connected'; el.className = 'db-status ok'; }
    else { el.textContent = `● ${h.dbError || 'no DB'}`; el.className = 'db-status bad'; }
  } catch (_) {
    el.textContent = '● server unreachable'; el.className = 'db-status bad';
  }
}

// --- Tab 1: Overview -----------------------------------------------------------------

async function renderOverview() {
  const [summary, byAgent, timeline, histogram, sessions, cacheStats, prefixStats] = await Promise.all([
    api.get('/api/summary'),
    api.get('/api/by-agent'),
    api.get('/api/timeline'),
    api.get('/api/latency-histogram'),
    api.get('/api/sessions'),
    api.get('/api/cache-stats'),
    api.get('/api/prefix-stats'),
  ]);

  if (!summary.dbAvailable || summary.requests === 0) {
    $view.innerHTML = emptyState(summary.dbAvailable
      ? 'No LLM requests recorded yet.'
      : 'Usage database not found.');
    return;
  }

  const cards = `
    <div class="grid cards">
      <div class="card"><div class="k">Requests</div><div class="v">${fmt.int(summary.requests)}</div></div>
      <div class="card"><div class="k">OK / Failed</div>
        <div class="v"><span class="ok">${fmt.int(summary.ok)}</span> <small>/</small> <span class="${summary.failed ? 'bad' : ''}">${fmt.int(summary.failed)}</span></div></div>
      <div class="card"><div class="k">Input tokens</div><div class="v">${fmt.int(summary.prompt_tokens)}</div></div>
      <div class="card"><div class="k">Output tokens</div><div class="v">${fmt.int(summary.completion_tokens)}</div></div>
      <div class="card"><div class="k">Total cost</div><div class="v">${fmt.usd(summary.cost_usd)}</div></div>
      <div class="card"><div class="k">Avg latency</div><div class="v">${fmt.ms(summary.avg_latency_ms)}</div></div>
      <div class="card"><div class="k">P95 latency</div><div class="v">${fmt.ms(summary.p95_latency_ms)}</div></div>
    </div>`;

  const agentRows = byAgent.rows.map((r) => `
    <tr>
      <td>${badge(`src-${r.source}`, r.source)}</td>
      <td>${badge('tag', r.tag)}</td>
      <td class="num">${fmt.int(r.calls)}</td>
      <td class="num">${r.failed ? `<span class="bad">${fmt.int(r.failed)}</span>` : '0'}</td>
      <td class="num">${fmt.int(r.tokens_in)}</td>
      <td class="num">${fmt.int(r.tokens_out)}</td>
      <td class="num">${fmt.usd(r.cost_usd)}</td>
      <td class="num">${fmt.ms(r.avg_latency_ms)}</td>
    </tr>`).join('');

  const sessionRows = sessions.rows.map((s) => `
    <tr>
      <td class="num">${esc(s.pid)}</td>
      <td>${esc(s.sources)}</td>
      <td>${fmt.ts(s.started)}</td>
      <td>${fmt.ts(s.last_seen)}</td>
      <td class="num">${fmt.int(s.requests)}</td>
      <td class="num">${s.failed ? `<span class="bad">${fmt.int(s.failed)}</span>` : '0'}</td>
      <td class="num">${fmt.int(s.total_tokens)}</td>
      <td class="num">${fmt.usd(s.cost_usd)}</td>
    </tr>`).join('');

  const prefixRows = prefixStats.rows.map((p) => `
    <tr>
      <td><code>${esc(p.prefix_hash)}</code></td>
      <td class="num">${fmt.int(p.session_count)}</td>
      <td class="num">${fmt.int(p.total_cached_tokens)}</td>
      <td>${fmt.ts(p.first_seen)}</td>
      <td>${fmt.ts(p.last_seen)}</td>
    </tr>`).join('');

  $view.innerHTML = `
    ${cards}
    <div class="grid charts">
      <div class="panel"><h3>Tokens over time (${esc(timeline.bucket)})</h3><div class="chart-box"><canvas id="ch-tokens"></canvas></div></div>
      <div class="panel"><h3>Cumulative cost (USD)</h3><div class="chart-box"><canvas id="ch-cost"></canvas></div></div>
      <div class="panel"><h3>Calls per agent</h3><div class="chart-box"><canvas id="ch-agents"></canvas></div></div>
      <div class="panel"><h3>Latency distribution</h3><div class="chart-box"><canvas id="ch-latency"></canvas></div></div>
      <div class="panel" style="grid-column: 1 / -1"><h3>Cache Hit Rate (rolling 30d)</h3><div class="chart-box" style="height: 250px"><canvas id="ch-cache"></canvas></div></div>
    </div>
    <h2 class="section-title">Prefix Stability</h2>
    <div class="panel"><table>
      <thead><tr><th>Prefix Hash</th><th class="num">Sessions</th><th class="num">Cached Tokens</th><th>First Seen</th><th>Last Seen</th></tr></thead>
      <tbody>${prefixRows || '<tr><td colspan="5" class="muted">No prefix data</td></tr>'}</tbody>
    </table></div>
    <h2 class="section-title">Per-agent rollup</h2>
    <div class="panel"><table>
      <thead><tr><th>Source</th><th>Agent / Tag</th><th class="num">Calls</th><th class="num">Failed</th>
      <th class="num">Tokens in</th><th class="num">Tokens out</th><th class="num">Cost</th><th class="num">Avg latency</th></tr></thead>
      <tbody>${agentRows}</tbody>
    </table></div>
    <h2 class="section-title">Sessions (one sidecar process = one session)</h2>
    <div class="panel"><table>
      <thead><tr><th class="num">PID</th><th>Sources</th><th>Started</th><th>Last seen</th>
      <th class="num">Requests</th><th class="num">Failed</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
      <tbody>${sessionRows}</tbody>
    </table></div>`;

  renderOverviewCharts(byAgent, timeline, histogram, cacheStats);
}

function renderOverviewCharts(byAgent, timeline, histogram, cacheStats) {
  const labels = timeline.rows.map((r) => fmt.tshort(r.bucket));
  makeChart('ch-tokens', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'input', data: timeline.rows.map((r) => r.tokens_in), backgroundColor: 'rgba(76,194,255,0.55)', stack: 't' },
      { label: 'output', data: timeline.rows.map((r) => r.tokens_out), backgroundColor: 'rgba(124,92,255,0.65)', stack: 't' },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
  });

  let acc = 0;
  const cum = timeline.rows.map((r) => { acc += r.cost_usd; return acc; });
  makeChart('ch-cost', {
    type: 'line',
    data: { labels, datasets: [{ label: 'cumulative USD', data: cum,
      borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', fill: true, tension: 0.25, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });

  makeChart('ch-agents', {
    type: 'bar',
    data: { labels: byAgent.rows.map((r) => r.tag), datasets: [{
      label: 'calls', data: byAgent.rows.map((r) => r.calls),
      backgroundColor: byAgent.rows.map((r) => {
        if (r.source === 'gateway') return 'rgba(76,194,255,0.6)';
        if (r.source === 'rust') return 'rgba(251,146,60,0.6)';
        return 'rgba(124,92,255,0.6)';
      }),
    }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
  });

  makeChart('ch-latency', {
    type: 'bar',
    data: { labels: histogram.rows.map((r) => r.bucket), datasets: [{
      label: 'calls', data: histogram.rows.map((r) => r.calls), backgroundColor: 'rgba(251,191,36,0.55)' }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  const cacheModels = [...new Set(cacheStats.rows.map(r => r.model))];
  const cachePct = cacheModels.map(m => {
    const mRows = cacheStats.rows.filter(r => r.model === m);
    const cached = mRows.reduce((acc, r) => acc + r.cached_tokens, 0);
    const billed = mRows.reduce((acc, r) => acc + r.billed_tokens, 0);
    const pct = (billed + cached) > 0 ? (cached * 100.0 / (billed + cached)) : 0;
    return { model: m, cached, billed, pct: pct.toFixed(1) };
  });

  makeChart('ch-cache', {
    type: 'bar',
    data: {
      labels: cachePct.map(c => c.model),
      datasets: [
        { label: 'cached', data: cachePct.map(c => c.cached), backgroundColor: 'rgba(52,211,153,0.65)', stack: 'c' },
        { label: 'uncached', data: cachePct.map(c => c.billed), backgroundColor: 'rgba(251,146,60,0.65)', stack: 'c' }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true } },
      plugins: {
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const model = cachePct[ctx.dataIndex];
              return \`Hit rate: \${model.pct}%\`;
            }
          }
        }
      }
    }
  });
}

// --- Tab 2: Requests ---------------------------------------------------------------

const reqState = { source: '', status: '', tag: '', limit: 100, offset: 0 };

async function renderRequests() {
  const byAgent = await api.get('/api/by-agent');
  const tags = [...new Set(byAgent.rows.map((r) => r.tag))].sort();

  const opts = (list, sel) => ['<option value="">all</option>']
    .concat(list.map((v) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`)).join('');

  $view.innerHTML = `
    <div class="filters">
      <label>Source <select id="f-source">${opts(['gateway', 'chatbot', 'rust'], reqState.source)}</select></label>
      <label>Status <select id="f-status">${opts(['ok', 'failed'], reqState.status)}</select></label>
      <label>Agent / tag <select id="f-tag">${opts(tags, reqState.tag)}</select></label>
      <span class="muted" id="f-count"></span>
    </div>
    <div class="panel"><table>
      <thead><tr>
        <th class="num">ID</th><th>Time</th><th>Source</th><th>Agent / Tag</th><th>Model</th><th>Status</th>
        <th class="num">In</th><th class="num">Out</th><th class="num">Cost</th><th class="num">Latency</th><th class="num">Att.</th>
      </tr></thead>
      <tbody id="req-rows"><tr><td colspan="11" class="muted">Loading…</td></tr></tbody>
    </table>
    <div class="pager">
      <button id="pg-prev">← Prev</button>
      <span id="pg-info"></span>
      <button id="pg-next">Next →</button>
    </div></div>`;

  ['f-source', 'f-status', 'f-tag'].forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      reqState[id.slice(2)] = e.target.value;
      reqState.offset = 0;
      loadRequestRows();
    });
  });
  document.getElementById('pg-prev').addEventListener('click', () => {
    reqState.offset = Math.max(0, reqState.offset - reqState.limit); loadRequestRows();
  });
  document.getElementById('pg-next').addEventListener('click', () => {
    reqState.offset += reqState.limit; loadRequestRows();
  });

  await loadRequestRows();
}

async function loadRequestRows() {
  const p = new URLSearchParams({ limit: reqState.limit, offset: reqState.offset });
  if (reqState.source) p.set('source', reqState.source);
  if (reqState.status) p.set('status', reqState.status);
  if (reqState.tag) p.set('tag', reqState.tag);

  const data = await api.get(`/api/requests?${p}`);
  const tbody = document.getElementById('req-rows');
  if (!data.dbAvailable || data.rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="muted">No matching requests.</td></tr>';
  } else {
    tbody.innerHTML = data.rows.map((r) => `
      <tr class="clickable" data-id="${r.id}">
        <td class="num">${r.id}</td>
        <td>${fmt.ts(r.ts)}</td>
        <td>${badge(`src-${r.source}`, r.source)}</td>
        <td>${badge('tag', r.tag || '—')}</td>
        <td>${esc(r.model || '—')}</td>
        <td>${badge(r.status, r.status === 'ok' ? 'ok' : `failed${r.error_code ? ` · ${r.error_code}` : ''}`)}</td>
        <td class="num">${fmt.int(r.prompt_tokens)}</td>
        <td class="num">${fmt.int(r.completion_tokens)}</td>
        <td class="num">${fmt.usd(r.cost_usd)}</td>
        <td class="num">${fmt.ms(r.latency_ms)}</td>
        <td class="num">${r.attempts}</td>
      </tr>`).join('');
    tbody.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => { location.hash = `#/detail/${tr.dataset.id}`; });
    });
  }
  document.getElementById('f-count').textContent = `${fmt.int(data.total)} matching`;
  document.getElementById('pg-info').textContent =
    `${data.total ? reqState.offset + 1 : 0}–${Math.min(reqState.offset + reqState.limit, data.total)} of ${data.total}`;
  document.getElementById('pg-prev').disabled = reqState.offset === 0;
  document.getElementById('pg-next').disabled = reqState.offset + reqState.limit >= data.total;
}

// --- Tab 3: Request Detail -----------------------------------------------------------

async function renderDetail(id) {
  if (!id) {
    $view.innerHTML = '<div class="empty">Pick a request from the 📋 Requests tab to inspect it.</div>';
    return;
  }
  const [data, codemap] = await Promise.all([
    api.get(`/api/requests/${encodeURIComponent(id)}`),
    api.get('/api/codemap').catch(() => null),
  ]);

  if (!data.dbAvailable || !data.request) {
    $view.innerHTML = `<div class="empty">Request #${esc(id)} not found.</div>`;
    return;
  }
  const r = data.request;

  // Locate the call site in the code map (match by source + tag).
  let hit = null;
  if (codemap?.llm?.callSites) {
    hit = codemap.llm.callSites.find((c) => c.source === r.source && c.tag === r.tag) || null;
  }

  const cell = (k, v) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
  const kv = `
    <div class="kv">
      ${cell('Time', esc(fmt.ts(r.ts)))}
      ${cell('Source', badge(`src-${r.source}`, r.source))}
      ${cell('Agent / tag', badge('tag', r.tag || '—'))}
      ${cell('Model', esc(r.model || '—'))}
      ${cell('Provider → endpoint', esc(`${r.provider || '?'} → ${r.endpoint || '?'}`))}
      ${cell('Status', badge(r.status, r.status))}
      ${cell('Attempts', esc(r.attempts))}
      ${cell('Latency (incl. retries)', esc(fmt.ms(r.latency_ms)))}
      ${cell('Input tokens', esc(fmt.int(r.prompt_tokens)))}
      ${cell('Output tokens', esc(fmt.int(r.completion_tokens)))}
      ${cell('Total tokens', esc(fmt.int(r.total_tokens)))}
      ${cell('Cost', esc(fmt.usd(r.cost_usd)))}
      ${cell('expect_json', esc(r.expect_json ? 'true' : 'false'))}
      ${cell('max_tokens', esc(r.max_tokens ?? '—'))}
      ${cell('timeout_ms', esc(r.timeout_ms ?? '—'))}
      ${cell('Session (pid)', esc(r.pid))}
    </div>`;

  const errorBox = r.status === 'failed' ? `
    <div class="error-box"><strong>${esc(r.error_code || 'error')}</strong> — ${esc(r.error_message || 'no message recorded')}</div>` : '';

  const hitBox = hit ? `
    <div class="codemap-hit">
      📍 <strong>Call site:</strong> <span class="file">${esc(hit.file)}</span>
      <div class="muted">${esc(hit.invokedBy || '')}</div>
      <div style="margin-top:6px">${esc(hit.purpose || '')}</div>
      ${hit.config ? `<div class="muted" style="margin-top:6px">config: timeoutMs=${hit.config.timeoutMs} · retries=${hit.config.retries} · maxTokens=${hit.config.maxTokens} · tier=${hit.config.tier}</div>` : ''}
    </div>` : '';

  let messagesHtml = '';
  if (Array.isArray(r.parsed_messages)) {
    messagesHtml = r.parsed_messages.map((m) => `
      <div class="message">
        <div class="role ${m.role === 'user' ? 'user' : ''}">${esc(m.role || '?')}</div>
        <pre>${esc(typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2))}</pre>
      </div>`).join('');
  } else if (typeof r.parsed_messages === 'string') {
    messagesHtml = `<div class="message"><div class="role">raw (truncated)</div><pre>${esc(r.parsed_messages)}</pre></div>`;
  } else {
    messagesHtml = '<p class="muted">Payload not stored (LLM_TRACK_PAYLOADS=0 or recording predates payload capture).</p>';
  }

  $view.innerHTML = `
    <div class="detail-head">
      <h2>Request #${esc(r.id)}</h2>
      <a href="#/requests" class="muted">← back to requests</a>
    </div>
    ${errorBox}
    ${hitBox}
    ${kv}
    <h2 class="section-title">Request payload (messages sent to the LLM)</h2>
    ${messagesHtml}
    <h2 class="section-title">Response preview</h2>
    <div class="message"><div class="role">assistant</div><pre>${esc(r.response_preview || '(none recorded — failed call or payloads disabled)')}</pre></div>`;
}

// --- Tab 4: API Call Map -------------------------------------------------------------

async function renderCodemap() {
  const cm = await api.get('/api/codemap');
  const llm = cm.llm || {};
  const sites = llm.callSites || [];
  const gatewaySites = sites.filter((s) => s.source === 'gateway');
  const chatbotSites = sites.filter((s) => s.source === 'chatbot');

  const siteRows = (list) => list.map((s) => `
    <tr>
      <td>${badge('tag', s.tag)}</td>
      <td class="wrap"><span class="file" style="font-family:var(--mono);color:var(--accent)">${esc(s.file)}</span></td>
      <td class="wrap">${esc(s.purpose)}</td>
      <td class="wrap muted">${esc(s.invokedBy)}</td>
      <td>${s.expectJson ? 'JSON' : 'text'}</td>
      <td class="num">${s.config?.timeoutMs ?? '—'}</td>
      <td class="num">${s.config?.retries ?? '—'}</td>
      <td class="num">${s.config?.maxTokens ?? '—'}</td>
      <td>${esc(s.config?.tier || '—')}</td>
    </tr>`).join('');

  const chokeRows = (llm.chokePoints || []).map((c) => `
    <tr>
      <td>${badge(`src-${c.source}`, c.source)}</td>
      <td><span style="font-family:var(--mono);color:var(--accent)">${esc(c.file)}</span> → <code>${esc(c.function)}</code></td>
      <td class="wrap">${esc(c.description)}</td>
      <td class="wrap muted">${esc(c.recordedBy || '')}</td>
    </tr>`).join('');

  const otherRows = (cm.otherApis || []).map((a) => `
    <tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.kind)}</td>
      <td><span style="font-family:var(--mono);color:var(--accent)">${esc(a.file)}</span></td>
      <td class="wrap">${esc(a.protocol)}</td>
      <td><code>${esc(a.auth)}</code></td>
      <td class="wrap muted">${esc(a.note)}</td>
    </tr>`).join('');

  const priceRows = Object.entries(cm.pricing || {}).map(([model, p]) => `
    <tr>
      <td><code>${esc(model)}</code></td>
      <td class="num">$${p.input} / 1M</td>
      <td class="num">$${p.output} / 1M</td>
    </tr>`).join('');

  $view.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <h3>${esc(cm.meta?.title || 'API Call Map')}</h3>
      <p class="muted" style="margin:0">${esc(cm.meta?.notes || '')}</p>
      <p class="muted" style="margin:8px 0 0">
        Provider: <code>${esc(llm.provider || '')}</code> · Endpoint: <code>${esc(llm.endpoint || '')}</code> ·
        Default model: <code>${esc(llm.defaultModel || '')}</code>
      </p>
      <p class="muted" style="margin:8px 0 0">${esc(llm.modelNote || '')}</p>
    </div>

    <h2 class="section-title">Choke points (every LLM call passes through one of these)</h2>
    <div class="panel"><table>
      <thead><tr><th>Source</th><th>File / function</th><th>Behaviour</th><th>Recorded by</th></tr></thead>
      <tbody>${chokeRows}</tbody>
    </table></div>

    <h2 class="section-title">Gateway call sites (capture pipeline)</h2>
    <div class="panel"><table>
      <thead><tr><th>Tag</th><th>File</th><th>What the prompt does</th><th>Invoked by</th><th>Output</th>
      <th class="num">Timeout ms</th><th class="num">Retries</th><th class="num">Max tokens</th><th>Tier</th></tr></thead>
      <tbody>${siteRows(gatewaySites)}</tbody>
    </table></div>

    <h2 class="section-title">Chatbot call sites (Ask Roxi — LangGraph RAG)</h2>
    <div class="panel"><table>
      <thead><tr><th>Tag</th><th>File</th><th>What the prompt does</th><th>Invoked by</th><th>Output</th>
      <th class="num">Timeout ms</th><th class="num">Retries</th><th class="num">Max tokens</th><th>Tier</th></tr></thead>
      <tbody>${siteRows(chatbotSites)}</tbody>
    </table></div>

    <h2 class="section-title">Non-LLM external APIs (not token-tracked)</h2>
    <div class="panel"><table>
      <thead><tr><th>Service</th><th>Kind</th><th>File</th><th>Protocol</th><th>Auth</th><th>Notes</th></tr></thead>
      <tbody>${otherRows}</tbody>
    </table></div>

    <h2 class="section-title">Model pricing (USD per 1M tokens — from billing-tracker.js)</h2>
    <div class="panel"><table>
      <thead><tr><th>Model</th><th class="num">Input</th><th class="num">Output</th></tr></thead>
      <tbody>${priceRows}</tbody>
    </table></div>
    <p class="muted">Authored: ${esc(cm.meta?.lastUpdated || '')} · ${esc(cm.meta?.authoredFrom || '')}</p>`;
}

// --- Boot ------------------------------------------------------------------------------

refreshDbStatus();
setInterval(refreshDbStatus, 30000);
route();




