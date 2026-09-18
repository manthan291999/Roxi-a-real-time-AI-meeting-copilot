# vendor/qdrant/

Native Qdrant binaries `QdrantVectorStore` (`src-tauri/src/adapters/vector_client.rs`)
spawns for Meeting Semantic Memory. Not committed — fetch with:

```bash
./scripts/fetch-qdrant.sh          # latest release
./scripts/fetch-qdrant.sh v1.19.1  # pinned version
```

`run.sh` also fetches `qdrant` automatically on first launch if it's missing.

## Why two binary names can exist here

- `qdrant` — the current, unqualified build `resolve_qdrant_binary()` prefers.
- `qdrant-aarch64-apple-darwin` / `qdrant-x86_64-apple-darwin` — older,
  triple-named builds kept only as a last-resort fallback candidate. They
  predate this vendoring cleanup and are known to panic against storage
  written by a newer Qdrant (see the doc comment on `resolve_qdrant_binary`
  in `vector_client.rs`). Don't rely on these; re-fetch a current build
  instead if `qdrant` is missing.

## Do not re-commit a binary here

These files used to be committed directly (73MB + ~105MB across three
platform builds) — that's what this vendoring exists to stop. If you bump
the Qdrant version, run the fetch script again rather than `git add`-ing the
new binary; it stays gitignored by the rule in the repo root `.gitignore`.
