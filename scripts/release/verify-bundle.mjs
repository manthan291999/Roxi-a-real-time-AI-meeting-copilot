#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundleArg = process.argv.indexOf('--bundle');
const bundle = resolve(root, bundleArg >= 0 ? process.argv[bundleArg + 1] : join('src-tauri', 'resources-bundle'));
const executable = process.platform === 'win32' ? '.exe' : '';
const required = [
  'runtime-config.json',
  'bundle-manifest.json',
  join('node', `node${executable}`),
  join('qdrant', `qdrant${executable}`),
  join('gateway', 'sidecar.js'),
  join('chatbot', 'sidecar.js'),
];

for (const path of required) {
  if (!existsSync(join(bundle, path))) throw new Error(`Missing bundled resource: ${path}`);
}
const config = JSON.parse(readFileSync(join(bundle, 'runtime-config.json'), 'utf8'));
if (config.environment === 'production' && (!config.apiUrl.startsWith('https://') || config.directProviderAccess)) {
  throw new Error('Unsafe production runtime configuration');
}
const version = spawnSync(join(bundle, 'node', `node${executable}`), ['--version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error(`Bundled Node failed: ${version.stderr}`);
for (const runtime of ['gateway', 'chatbot']) {
  const native = spawnSync(
    join(bundle, 'node', `node${executable}`),
    ['-e', "require('better-sqlite3'); process.stdout.write('ok')"],
    { cwd: join(bundle, runtime), encoding: 'utf8' },
  );
  if (native.status !== 0 || native.stdout !== 'ok') {
    throw new Error(`${runtime} native modules do not load under bundled Node: ${native.stderr}`);
  }
}
process.stdout.write(`Bundle verified with Node ${version.stdout.trim()}\n`);
