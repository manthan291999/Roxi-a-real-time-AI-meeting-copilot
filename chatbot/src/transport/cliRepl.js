/**
 * cliRepl — human-friendly transport for the terminal (dev/demo harness).
 * Same use case as the stdio sidecar; different presentation only.
 */

const readline = require('readline');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', red: '\x1b[31m',
};

function printPayload(payload) {
  console.log();
  console.log(`${C.cyan}${C.bold}Roxi:${C.reset} ${payload.answer}`);

  if (payload.clarifyingQuestion) {
    console.log(`${C.yellow}${C.bold}❓ ${payload.clarifyingQuestion}${C.reset}`);
  }
  if (payload.sources?.length) {
    console.log(`\n${C.dim}Sources (${payload.sources.length}):${C.reset}`);
    for (const s of payload.sources) {
      console.log(`  ${C.green}•${C.reset} ${describeSource(s)}`);
      if (s.snippet) console.log(`    ${C.dim}"${truncate(s.snippet, 140)}"${C.reset}`);
    }
  }
  if (payload.followUps?.length) {
    console.log(`\n${C.dim}Suggested follow-ups:${C.reset}`);
    payload.followUps.forEach((f, i) => console.log(`  ${C.magenta}${i + 1}.${C.reset} ${f}`));
  }
  const web = payload.usedWebSearch
    ? ` · web=${payload.webSearchCount} search${payload.webSearchCount === 1 ? '' : 'es'}`
    : payload.webMode && payload.webMode !== 'never' ? ` · web=${payload.webMode}, not used` : '';
  console.log(`${C.dim}[route=${payload.route} · attempts=${payload.attempts}${web}${payload.degradedNote ? ` · degraded: ${payload.degradedNote}` : ''}]${C.reset}\n`);
}

/**
 * One line describing a source card, whichever corpus it came from. The
 * previous version assumed every source was a meeting, so a document, a
 * glossary term or a web result printed as "Meeting #undefined".
 */
function describeSource(s) {
  const ref = s.ref ? `[${s.ref}] ` : '';
  switch (s.sourceType) {
    case 'web':
      return `${ref}${s.title || 'Web'} — ${s.url}`;
    case 'document':
      return `${ref}${s.fileName || 'document'}${s.pageNumber != null ? ` · page ${s.pageNumber}` : ''}`;
    case 'live':
      return `${ref}Live transcript${s.speaker ? ` · ${s.speaker}` : ''}`;
    case 'semantic':
      return `${ref}Glossary`;
    default: {
      const who = s.speaker ? ` · ${s.speaker}` : '';
      const name = s.meetingName ? `"${s.meetingName}" (#${s.meetingId})` : `Meeting #${s.meetingId}`;
      return `${ref}${name} · ${s.date || 'n/a'} · ${s.sourceTable}${who}`;
    }
  }
}

function truncate(text, n) {
  return text && text.length > n ? text.slice(0, n - 1) + '…' : text || '';
}

/**
 * One-shot question.
 *
 * `webMode` is passed through rather than defaulted here, so omitting it
 * means "use the configured default" exactly as it does over stdio.
 */
async function askOnce(container, question, threadId = 'cli', opts = {}) {
  const payload = await container.useCase.run({
    question,
    threadId,
    mode: opts.mode,
    webMode: opts.webMode,
    onNode: (node) => process.stderr.write(`${C.dim}[node] ${node}${C.reset}\n`),
  });
  printPayload(payload);
  return payload;
}

/** Interactive multi-turn REPL (single thread, real conversational memory). */
async function startRepl(container, opts = {}) {
  const threadId = `cli-${Date.now()}`;
  const history = [];
  console.log(`${C.bold}Ask Roxi — meeting history chat${C.reset} ${C.dim}(thread ${threadId}; type "exit" to quit)${C.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise((res) => rl.question(`${C.bold}You:${C.reset} `, res));

  for (;;) {
    const q = (await prompt()).trim();
    if (!q) continue;
    if (/^(exit|quit)$/i.test(q)) break;
    try {
      const payload = await container.useCase.run({
        question: q, threadId, history, mode: opts.mode, webMode: opts.webMode,
      });
      printPayload(payload);
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: payload.answer });
    } catch (err) {
      console.log(`${C.red}Error:${C.reset} ${err.message}\n`);
    }
  }
  rl.close();
  container.shutdown();
}

module.exports = { askOnce, startRepl, printPayload };
