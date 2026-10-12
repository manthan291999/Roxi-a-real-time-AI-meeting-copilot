#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const version = arg('--version', (process.env.CI_COMMIT_TAG || packageJson.version).replace(/^v/, ''));
const input = resolve(root, arg('--input', 'src-tauri/target/release/bundle'));
const output = resolve(root, arg('--output', join('release', `Roxi-${version}`)));

if (!existsSync(input)) throw new Error(`Release artifact input does not exist: ${input}`);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const mapping = {
  '.dmg': 'macos',
  '.exe': 'windows',
  '.msi': 'windows',
  '.AppImage': 'linux',
  '.deb': 'linux',
};
const artifacts = walk(input).filter((path) => mapping[extname(path)]);
if (artifacts.length === 0) throw new Error(`No installers found below ${input}`);

rmSync(output, { recursive: true, force: true });
for (const os of ['macos', 'windows', 'linux']) mkdirSync(join(output, os), { recursive: true });

const manifest = { version, generatedAt: new Date().toISOString(), artifacts: [] };
for (const source of artifacts) {
  const os = mapping[extname(source)];
  const destination = join(output, os, basename(source));
  cpSync(source, destination);
  const bytes = readFileSync(destination);
  manifest.artifacts.push({
    os,
    file: relative(output, destination).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
manifest.artifacts.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(output, 'checksums-sha256.txt'),
  `${manifest.artifacts.map(({ sha256, file }) => `${sha256}  ${file}`).join('\n')}\n`,
);
writeFileSync(join(output, 'README-INSTALL.txt'), `Roxi ${version}\n\nmacOS\n  Open the DMG, drag Roxi to Applications, and allow microphone access.\n\nWindows\n  Run the setup EXE (recommended) or use the MSI for managed deployment.\n  Allow microphone access when Windows asks.\n\nLinux\n  Ubuntu/Debian: install the DEB. Other supported glibc systems may use the AppImage.\n  PipeWire and WebKitGTK are required.\n\nServer\n  These installers use the Roxi server URL embedded as public release configuration.\n  Provider and database secrets are never included in the desktop installers.\n\nVerification\n  Compare installer SHA-256 values with checksums-sha256.txt.\n`);
process.stdout.write(`Assembled ${manifest.artifacts.length} installers in ${output}\n`);
