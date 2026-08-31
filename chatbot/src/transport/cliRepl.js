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
      const who = s.speaker ? ` · ${s.speaker}` : '';
      console.log(`  ${C.green}•${C.reset} Meeting #${s.meetingId} · ${s.date || 'n/a'} · ${s.sourceTable}${who}`);
      console.log(`    ${C.dim}"${truncate(s.snippet, 140)}"${C.reset}`);
    }
  }
  if (payload.followUps?.length) {
    console.log(`\n${C.dim}Suggested follow-ups:${C.reset}`);
    payload.followUps.forEach((f, i) => console.log(`  ${C.magenta}${i + 1}.${C.reset} ${f}`));
  }
  console.log(`${C.dim}[route=${payload.route} · attempts=${payload.attempts}${payload.degradedNote ? ` · degraded: ${payload.degradedNote}` : ''}]${C.reset}\n`);
}

function truncate(text, n) {
  return text && text.length > n ? text.slice(0, n - 1) + '…' : text || '';
}

/** One-shot question. */
async function askOnce(container, question, threadId = 'cli') {
  const payload = await container.useCase.run({
    question,
    threadId,
    onNode: (node) => process.stderr.write(`${C.dim}[node] ${node}${C.reset}\n`),
  });
  printPayload(payload);
  return payload;
}

/** Interactive multi-turn REPL (single thread, real conversational memory). */
async function startRepl(container) {
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
      const payload = await container.useCase.run({ question: q, threadId, history });
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
