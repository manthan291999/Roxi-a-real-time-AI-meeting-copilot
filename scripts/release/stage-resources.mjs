#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..', '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const output = resolve(root, argument('--output', join('src-tauri', 'resources-bundle')));
const nodeVersion = process.env.ROXI_NODE_VERSION || process.version;
const qdrantVersion = process.env.ROXI_QDRANT_VERSION || 'v1.19.1';

const target = (() => {
  return argument('--target', `${process.platform}-${process.arch}`);
})();

const targets = {
  'darwin-arm64': {
    node: `node-${nodeVersion}-darwin-arm64.tar.gz`,
    qdrant: 'qdrant-aarch64-apple-darwin.tar.gz',
    executable: 'node',
    qdrantExecutable: 'qdrant',
  },
  'darwin-x64': {
    node: `node-${nodeVersion}-darwin-x64.tar.gz`,
    qdrant: 'qdrant-x86_64-apple-darwin.tar.gz',
    executable: 'node',
    qdrantExecutable: 'qdrant',
  },
  'win32-x64': {
    node: `node-${nodeVersion}-win-x64.zip`,
    qdrant: 'qdrant-x86_64-pc-windows-msvc.zip',
    executable: 'node.exe',
    qdrantExecutable: 'qdrant.exe',
  },
  'linux-x64': {
    node: `node-${nodeVersion}-linux-x64.tar.xz`,
    qdrant: 'qdrant-x86_64-unknown-linux-gnu.tar.gz',
    executable: 'node',
    qdrantExecutable: 'qdrant',
  },
};

const spec = targets[target];
if (!spec) throw new Error(`Unsupported release target: ${target}`);
if (target !== `${process.platform}-${process.arch}`) {
  throw new Error(`Resources with native npm modules must be staged on ${target}; current host is ${process.platform}-${process.arch}`);
}

const apiUrl = (process.env.ROXI_API_URL || '').trim();
if (!apiUrl) throw new Error('ROXI_API_URL is required for a release bundle');
const environment = (process.env.ROXI_ENVIRONMENT || 'production').trim();
if (environment === 'production' && (!apiUrl.startsWith('https://') || /localhost|127\.0\.0\.1/i.test(apiUrl))) {
  throw new Error('Production ROXI_API_URL must be a public HTTPS URL');
}

for (const secret of ['OPENAI_API_KEY', 'ASSEMBLYAI_API_KEY', 'SPEECHMATICS_API_KEY', 'DATABASE_URL', 'SUPABASE_JWT_SECRET']) {
  if (process.env[secret]) {
    process.stderr.write(`warning: ${secret} is set in the build environment; it will not be copied into the desktop bundle\n`);
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    // Windows command shims such as npm.cmd are batch files, not PE
    // executables, and require cmd.exe when launched from Node.
    shell: process.platform === 'win32',
    ...options,
  });
}

function copyRuntime(name) {
  const source = join(root, name);
  const destination = join(output, name);
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const rel = relative(source, path);
      if (!rel) return true;
      const parts = rel.split(/[\\/]/);
      return !parts.some((part) => ['node_modules', 'test', 'data', 'qdrant_storage'].includes(part))
        && !/\.(db|db-shm|db-wal)$/.test(path)
        && !basename(path).startsWith('.env')
        && basename(path) !== 'trial.json';
    },
  });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: destination });
  if (existsSync(join(destination, 'node_modules', 'better-sqlite3'))) {
    // Some npm installations enforce install-script approval and skip the
    // native build during `npm ci`. Rebuild explicitly, then verify with the
    // exact Node runtime that will be shipped below.
    run(npm, ['rebuild', 'better-sqlite3', '--foreground-scripts'], { cwd: destination });
  }
}

async function download(url, destination) {
  process.stdout.write(`Downloading ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function extract(archive, destination) {
  mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32' && archive.endsWith('.zip')) {
    run('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', archive, '-DestinationPath', destination, '-Force']);
  } else {
    run('tar', ['-xf', archive, '-C', destination]);
  }
}

function findFile(directory, filename) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const found = findFile(path, filename);
      if (found) return found;
    } else if (entry === filename) {
      return path;
    }
  }
  return undefined;
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
copyRuntime('gateway');
copyRuntime('chatbot');
cpSync(join(root, 'packages'), join(output, 'packages'), { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'roxi-release-'));
try {
  const nodeArchive = join(work, spec.node);
  await download(`https://nodejs.org/dist/${nodeVersion}/${spec.node}`, nodeArchive);
  const nodeExtract = join(work, 'node');
  extract(nodeArchive, nodeExtract);
  const nodeBinary = findFile(nodeExtract, spec.executable);
  if (!nodeBinary) throw new Error(`Could not find ${spec.executable} in the Node archive`);
  mkdirSync(join(output, 'node'), { recursive: true });
  cpSync(nodeBinary, join(output, 'node', spec.executable));

  const qdrantArchive = join(work, spec.qdrant);
  const qdrantBase = `https://github.com/qdrant/qdrant/releases/download/${qdrantVersion}`;
  await download(`${qdrantBase}/${spec.qdrant}`, qdrantArchive);
  const qdrantExtract = join(work, 'qdrant');
  extract(qdrantArchive, qdrantExtract);
  const qdrantBinary = findFile(qdrantExtract, spec.qdrantExecutable);
  if (!qdrantBinary) throw new Error(`Could not find ${spec.qdrantExecutable} in the Qdrant archive`);
  mkdirSync(join(output, 'qdrant'), { recursive: true });
  cpSync(qdrantBinary, join(output, 'qdrant', spec.qdrantExecutable));
  if (process.platform !== 'win32') {
    run('chmod', ['+x', join(output, 'node', spec.executable), join(output, 'qdrant', spec.qdrantExecutable)]);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const runtimeConfig = {
  environment,
  apiUrl,
  supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  releaseChannel: (process.env.ROXI_RELEASE_CHANNEL || 'stable').trim(),
  directProviderAccess: false,
};
writeFileSync(join(output, 'runtime-config.json'), `${JSON.stringify(runtimeConfig, null, 2)}\n`);

const forbiddenSecretValue = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/;
for (const path of listFiles(output).filter((path) => statSync(path).size < 5_000_000)) {
  const rel = relative(output, path).replaceAll('\\', '/');
  if (/(^|\/)\.env(?:\.|$)/.test(rel)) throw new Error(`Environment file must not be bundled: ${rel}`);
  if (forbiddenSecretValue.test(readFileSync(path, 'utf8'))) throw new Error(`Possible provider secret found in ${rel}`);
}

if (process.platform === 'darwin') {
  const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
  for (const path of listFiles(output)) {
    let description = '';
    try {
      description = execFileSync('file', [path], { encoding: 'utf8' });
    } catch {
      continue;
    }
    if (!description.includes('Mach-O')) continue;
    if (!process.env.APPLE_SIGNING_IDENTITY) {
      try {
        execFileSync('codesign', ['--verify', path], { stdio: 'ignore' });
        continue; // Preserve a valid upstream signature (notably Node).
      } catch {
        // Unsigned native dependency: add the local ad-hoc signature.
      }
    }
    const signArgs = identity === '-'
      ? ['--force', '--timestamp=none', '--sign', identity, path]
      : ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, path];
    run('codesign', signArgs);
  }
}

const manifest = {
  target,
  nodeVersion,
  qdrantVersion,
  generatedAt: new Date().toISOString(),
  files: Object.fromEntries(listFiles(output).map((path) => [relative(output, path).replaceAll('\\', '/'), hashFile(path)])),
};
writeFileSync(join(output, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Staged ${Object.keys(manifest.files).length} files in ${output}\n`);
