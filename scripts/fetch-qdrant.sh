#!/usr/bin/env bash
# Fetches (or re-fetches) the Qdrant binary for the current platform into
# vendor/qdrant/, instead of committing a new binary to git every time the
# vendored version bumps. Mirrors the download `run.sh` already does on
# first launch; this is the standalone version for a manual refresh.
#
# Usage: ./scripts/fetch-qdrant.sh [version]
#   version defaults to "latest". Example: ./scripts/fetch-qdrant.sh v1.19.1

set -euo pipefail

VERSION="${1:-latest}"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/qdrant"
ARCH="$(uname -m)"

case "$ARCH" in
  arm64|aarch64) TRIPLE="aarch64-apple-darwin" ;;
  x86_64)        TRIPLE="x86_64-apple-darwin" ;;
  *) echo "Unsupported architecture: $ARCH (this project only ships macOS builds)" >&2; exit 1 ;;
esac

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/qdrant/qdrant/releases/latest/download/qdrant-${TRIPLE}.tar.gz"
else
  URL="https://github.com/qdrant/qdrant/releases/download/${VERSION}/qdrant-${TRIPLE}.tar.gz"
fi

mkdir -p "$DEST_DIR"
echo "Fetching Qdrant ($VERSION, $TRIPLE) into $DEST_DIR ..."
curl -L "$URL" | tar -xz -C "$DEST_DIR"
chmod +x "$DEST_DIR/qdrant"
echo "Done. Binary at $DEST_DIR/qdrant — do not commit this file; it's gitignored-by-convention (see vendor/qdrant/README.md)."
