#!/usr/bin/env bash
# Stages everything the packaged Roxi.app needs outside its Rust binary into
# src-tauri/resources-bundle/, which tauri.release.conf.json ships as
# Contents/Resources/roxi/ (read back by src-tauri/src/bundle_env.rs):
#
#   gateway/  chatbot/  packages/   Node sidecars with production node_modules
#   node/node                       Node runtime, same version as the one that
#                                   built better-sqlite3 (native ABI must match)
#   qdrant/qdrant                   vector store binary
#   roxi.env                        allowlisted keys from the root .env
#
# Usage: scripts/bundle-sidecars.sh   (run by `npm run release:mac`)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/resources-bundle"
CACHE="$ROOT/vendor/node"
ARCH="arm64"

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
NODE_VERSION="$(node -v)"

[ -f "$ROOT/.env" ] || { echo "Missing $ROOT/.env (the release keys come from it)" >&2; exit 1; }
[ -x "$ROOT/vendor/qdrant/qdrant" ] || { echo "Missing vendor/qdrant/qdrant — run scripts/fetch-qdrant.sh" >&2; exit 1; }

echo "==> Staging into $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/node" "$OUT/qdrant"

stage_sidecar() {
  local name="$1"
  rsync -a \
    --exclude node_modules --exclude test --exclude '.env' \
    --exclude '*.db' --exclude '*.db-shm' --exclude '*.db-wal' \
    --exclude qdrant_storage --exclude trial.json --exclude data \
    --exclude pnpm-lock.yaml \
    "$ROOT/$name/" "$OUT/$name/"
  echo "==> npm ci --omit=dev ($name)"
  (cd "$OUT/$name" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  # Tauri's resource copier does not follow symlinks; nothing at runtime uses .bin.
  find "$OUT/$name/node_modules" -name .bin -type d -prune -exec rm -rf {} +
}
stage_sidecar gateway
stage_sidecar chatbot
rsync -a "$ROOT/packages/" "$OUT/packages/"

echo "==> Node $NODE_VERSION ($ARCH)"
TARBALL="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/$TARBALL" ]; then
  curl -fL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$CACHE/$TARBALL.part"
  mv "$CACHE/$TARBALL.part" "$CACHE/$TARBALL"
fi
tar -xzf "$CACHE/$TARBALL" -C "$OUT/node" --strip-components=2 "node-$NODE_VERSION-darwin-$ARCH/bin/node"
chmod +x "$OUT/node/node"

echo "==> Qdrant"
cp "$ROOT/vendor/qdrant/qdrant" "$OUT/qdrant/qdrant"
chmod +x "$OUT/qdrant/qdrant"

echo "==> roxi.env (allowlisted keys only)"
# Keys and tuning only. Supabase, the cloud API, database URLs and owner/admin
# emails are left out: without them the app runs in local-only mode.
grep -E '^(OPENAI_API_KEY|ASSEMBLYAI_API_KEY|SPEECHMATICS_API_KEY|STT_[A-Z_]+|LLM_BUDGET_[A-Z]+|ANOMALY_[A-Z_]+|CHATBOT_(MODEL|LLM_ADAPTER|EMBED_MODEL|WEB_SEARCH_MODE)|EPISODIC_RETENTION_DAYS)=' \
  "$ROOT/.env" > "$OUT/roxi.env" || true
grep -q '^OPENAI_API_KEY=.\+' "$OUT/roxi.env" || { echo "OPENAI_API_KEY is empty in .env" >&2; exit 1; }
grep -qE '^(ASSEMBLYAI|SPEECHMATICS)_API_KEY=.+' "$OUT/roxi.env" || { echo "No STT key in .env" >&2; exit 1; }

echo "==> Ad-hoc signing nested executables"
# Apple Silicon refuses to run unsigned Mach-O code. The Node binary keeps its
# own Developer ID signature; everything else gets an ad-hoc one.
while IFS= read -r -d '' f; do
  if file "$f" | grep -q 'Mach-O' && ! codesign -v "$f" 2>/dev/null; then
    codesign --force --sign - "$f"
  fi
done < <(find "$OUT" -type f \( -name '*.node' -o -name '*.dylib' -o -path '*/qdrant/qdrant' \) -print0)

echo "==> Done ($(du -sh "$OUT" | cut -f1))"
