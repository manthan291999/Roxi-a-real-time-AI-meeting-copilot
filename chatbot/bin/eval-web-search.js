#!/usr/bin/env node
/* eslint-disable no-console -- this IS the report: the table goes to stdout
   so it can be piped, and per-case progress goes to stderr so it does not. */
/**
 * eval-web-search — does the model search when it should, and not when it
 * shouldn't?
 *
 * This is the only thing in the repo that measures the FEATURE rather than
 * the code. The decision to search lives inside the model, so no unit test
 * can answer the question; you need labelled questions and a tally.
 *
 * DELIBERATELY OUTSIDE `npm test`: it makes real API calls and needs the
 * network, so it must never run in CI or in the pre-commit hook.
 *
 * Usage:
 *   node bin/eval-web-search.js --dry                  list cases, call nothing
 *   node bin/eval-web-search.js --category=A,B         just those categories
 *   node bin/eval-web-search.js --ids=B1,C3            just those cases
 *   node bin/eval-web-search.js --limit=10             first N after filtering
 *   node bin/eval-web-search.js --skip-corpus          drop cases needing real meetings
 *   node bin/eval-web-search.js --out=report.json      where to write the report
 *
 * Read the output in this order:
 *   1. Recall — a miss means a confidently stale answer reached a user.
 *   2. Precision — a miss means you are paying for searches nobody needed.
 *   3. Per-category pass rate — one bad category is a prompt problem,
 *      three are a design problem.
 *   4. The two control cases (X1, X2) — if either fails, the mode plumbing
 *      is broken and every other number is meaningless.
 */

const fs = require('fs');
const path = require('path');
const { buildContainer } = require('../src/composition/container');

const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'web-routing-cases.json');

function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
  };
  const list = (name) => {
    const v = get(name);
    return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  return {
    dry: Boolean(get('dry')),
    categories: list('category'),
    ids: list('ids'),
    limit: Number.parseInt(get('limit'), 10) || 0,
    skipCorpus: Boolean(get('skip-corpus')),
    out: typeof get('out') === 'string' ? get('out') : 'web-search-eval.json',
  };
}

function selectCases(all, args) {
  let cases = all;
  if (args.categories) cases = cases.filter((c) => args.categories.includes(c.category));
  if (args.ids) cases = cases.filter((c) => args.ids.includes(c.id));
  if (args.skipCorpus) cases = cases.filter((c) => !c.needsCorpus);
  if (args.limit > 0) cases = cases.slice(0, args.limit);
  return cases;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * What the run cost, read back from the usage DB the gateway already writes.
 * Joined on tag and start time rather than tracked in-process, so the number
 * is the same one the dashboard will show.
 */
function readCost(usageDbPath, sinceIso) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(usageDbPath, { readonly: true });
    const row = db.prepare(`
      SELECT COUNT(*) AS calls,
             COALESCE(SUM(cost_usd), 0) AS cost,
             COALESCE(SUM(total_tokens), 0) AS tokens
      FROM llm_requests
      WHERE tag IN ('web_answer', 'generate_web') AND ts >= ?
    `).get(sinceIso);
    db.close();
    return row;
  } catch (err) {
    return { calls: null, cost: null, tokens: null, error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const cases = selectCases(fixture.cases, args);

  if (cases.length === 0) {
    console.error('No cases matched those filters.');
    process.exit(2);
  }

  if (args.dry) {
    console.log(`${cases.length} case(s) selected — no API calls made:\n`);
    for (const c of cases) {
      const corpus = c.needsCorpus ? ' [needs real meetings]' : '';
      console.log(`  ${c.id.padEnd(4)} ${c.category}  expectSearch=${String(c.expectSearch).padEnd(5)} ${c.mode}/${c.webMode}${corpus}`);
      console.log(`       ${c.question}`);
    }
    return;
  }

  const container = buildContainer();
  const startedIso = new Date().toISOString();
  console.error(`[eval] ${cases.length} case(s); each is a real API call.\n`);

  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    let payload = null;
    let error = null;
    try {
      payload = await container.useCase.run({
        question: c.question,
        threadId: `eval-${c.id}`,
        mode: c.mode,
        webMode: c.webMode,
      });
    } catch (err) {
      error = err.message;
    }
    const latencyMs = Date.now() - t0;

    const searched = Boolean(payload && payload.usedWebSearch);
    const internalCited = Boolean(
      payload && (payload.sources || []).some((s) => s.sourceType !== 'web')
    );
    const correct = !error
      && searched === c.expectSearch
      && (!c.expectInternalCitation || internalCited);

    results.push({
      ...c,
      searched,
      searchCalls: payload ? payload.webSearchCount : 0,
      internalCited,
      webCited: payload ? (payload.sources || []).filter((s) => s.sourceType === 'web').length : 0,
      route: payload ? payload.route : null,
      degradedNote: payload ? payload.degradedNote : null,
      latencyMs,
      correct,
      error,
    });

    const mark = error ? 'ERR ' : correct ? 'ok  ' : 'MISS';
    const why = error
      ? error.slice(0, 60)
      : `expected ${c.expectSearch ? 'search' : 'no search'}, got ${searched ? 'search' : 'none'}`;
    console.error(`  ${mark} ${c.id.padEnd(4)} ${String(latencyMs).padStart(6)}ms  ${correct ? '' : why}`);
  }

  container.shutdown();
  report(results, readCost(container.config.usageDbPath, startedIso), args.out, fixture);
}

function report(results, cost, outPath, fixture) {
  const tp = results.filter((r) => r.expectSearch && r.searched).length;
  const fp = results.filter((r) => !r.expectSearch && r.searched).length;
  const fn = results.filter((r) => r.expectSearch && !r.searched).length;
  const tn = results.filter((r) => !r.expectSearch && !r.searched).length;
  const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

  const precision = pct(tp, tp + fp);
  const recall = pct(tp, tp + fn);

  const searchedLat = results.filter((r) => r.searched).map((r) => r.latencyMs).sort((a, b) => a - b);
  const plainLat = results.filter((r) => !r.searched).map((r) => r.latencyMs).sort((a, b) => a - b);

  const line = (s) => console.log(s);
  line('');
  line('═══ Web search routing ═══════════════════════════════════════');
  line('');
  line(`  cases                 ${results.length}`);
  line(`  errors                ${results.filter((r) => r.error).length}`);
  line('');
  line('  confusion             searched   did not');
  line(`    should search        ${String(tp).padStart(8)}  ${String(fn).padStart(8)}`);
  line(`    should not           ${String(fp).padStart(8)}  ${String(tn).padStart(8)}`);
  line('');
  line(`  recall                ${recall === null ? 'n/a' : recall + '%'}   (missed searches -> stale answers)`);
  line(`  precision             ${precision === null ? 'n/a' : precision + '%'}   (needless searches -> wasted cost)`);
  line('');
  line('  per category');
  for (const cat of Object.keys(fixture.categories)) {
    const inCat = results.filter((r) => r.category === cat);
    if (inCat.length === 0) continue;
    const ok = inCat.filter((r) => r.correct).length;
    line(`    ${cat}  ${String(ok).padStart(2)}/${String(inCat.length).padEnd(2)}  ${String(pct(ok, inCat.length)).padStart(5)}%  ${fixture.categories[cat].split('—')[0].trim()}`);
  }
  const misses = results.filter((r) => !r.correct && !r.error);
  if (misses.length) {
    line('');
    line('  misses');
    for (const m of misses) {
      line(`    ${m.id.padEnd(4)} ${m.category}  expected ${m.expectSearch ? 'search' : 'no search'}, got ${m.searched ? 'search' : 'none'}`);
      line(`         ${m.question}`);
    }
  }
  line('');
  line('  latency');
  line(`    searched   p50 ${fmtMs(percentile(searchedLat, 50))}  p95 ${fmtMs(percentile(searchedLat, 95))}  n=${searchedLat.length}`);
  line(`    no search  p50 ${fmtMs(percentile(plainLat, 50))}  p95 ${fmtMs(percentile(plainLat, 95))}  n=${plainLat.length}`);
  line('');
  line('  cost (from llm_usage.db, token-priced only)');
  if (cost.error) {
    line(`    unavailable: ${cost.error}`);
  } else {
    line(`    calls ${cost.calls}   tokens ${cost.tokens}   $${Number(cost.cost).toFixed(4)}`);
    line('    NOTE: a hosted web-search call is billed PER CALL, separately from');
    line('    tokens, so this figure under-reports. Searches run this pass:');
    line(`    ${results.reduce((n, r) => n + (r.searchCalls || 0), 0)} — price them from your own account page.`);
  }
  line('');

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: { cases: results.length, tp, fp, fn, tn, precision, recall },
    latency: {
      searched: { p50: percentile(searchedLat, 50), p95: percentile(searchedLat, 95), n: searchedLat.length },
      notSearched: { p50: percentile(plainLat, 50), p95: percentile(plainLat, 95), n: plainLat.length },
    },
    cost,
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  line(`  report written to ${outPath}`);
  line('  Commit it beside the fixture so the next prompt change has a baseline.');
  line('');
}

function fmtMs(v) {
  return v === null ? '   n/a' : `${String(v).padStart(5)}ms`;
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
