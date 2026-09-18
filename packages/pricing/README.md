# packages/pricing/

`model-prices.json` is the **single** source of truth for per-model USD
pricing (per 1,000,000 tokens), read by three previously-independent copies:

- `dashboard/lib/schema.js`
- `chatbot/src/infrastructure/usage/UsageRecorder.js`
- `src-tauri/src/agents/adapters/usage_store.rs` (embedded at compile time via `include_str!`)

Before this file existed, each of the three hand-maintained its own copy of
the same table, kept in sync only by a comment ("PRICING SYNC: keep
identical to..."). They had already drifted: the Rust copy had `gpt-4o-mini`
and `gpt-4o` entries the two JS copies lacked, so the dashboard and chatbot
usage totals were silently falling back to the `default` rate for every
`gpt-4o-mini` call — the model most of the agent pipeline actually runs on
(see `CLAUDE.md`'s model-tier table). This file's `gpt-4o-mini`/`gpt-4o`
entries fix that; it is not a no-op refactor.

**When you add or reprice a model**: edit this one file. Nothing else needs
to change — all three readers pick it up automatically (Rust needs a
rebuild, since it's compiled in; the two Node readers pick it up at their
next process start).
