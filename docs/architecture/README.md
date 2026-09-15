# Architecture Deep Dives — Index

This folder holds focused, file-by-file architecture documents for each major subsystem of Roxi. Start with the higher-level documents first, then come here for depth on the specific area you're touching.

## Reading order

1. **[`../../README.md`](../../README.md)** — project overview, status, quick start, configuration. Start here if you're new to the repo.
2. **[`../../brain.md`](../../brain.md)** — the canonical, machine-verified reference: every file, every command/event, every environment variable, and the ADRs behind the load-bearing decisions. The single source of truth when a claim in any other document is ambiguous or seems stale.
3. **[`../SYSTEM-ARCHITECTURE.md`](../SYSTEM-ARCHITECTURE.md)** — process topology and end-to-end data flow, with diagrams. The map that shows how the four runtimes fit together before you dive into any one of them.
4. The deep dives below — one per subsystem, each assuming you've read #3.

## Deep dives

| Document | Covers |
|---|---|
| [`agent-pipeline.md`](agent-pipeline.md) | `src-tauri/src/agents/` — the `Agent`/`LlmClient` traits, `ChunkGraph`, complexity-based routing, model tiering, and the context-brief compiler that grounds every agent call in cached, project-specific context. |
| [`ask-roxi-rag.md`](ask-roxi-rag.md) | `chatbot/src/` — hybrid retrieval over meetings and documents (Reciprocal Rank Fusion), the model-decided web-search path (`WebSearchGateway`, `webPolicy`, `webCitations`), citation-ref assignment, and document indexing. |
| [`data-persistence.md`](data-persistence.md) | The three independent SQLite databases, who writes each one, why they're never joined at the query level, and the forward-only migration discipline both writers follow. |
| [`frontend.md`](frontend.md) | `src/` — the single-window React app, dependency injection over Tauri, the feature-folder layout, the design system, and the native (not CSS) window-transparency mechanism. |
| [`security-config.md`](security-config.md) | Environment/configuration model, secret handling, the standing code-audit findings and which are still true, and the cost/abuse-control budgets that bound every LLM-backed feature. |

## What changed recently (context for all five documents)

As of this revision, the codebase has moved meaningfully past what earlier documentation described:

- The macOS "stealth" overlay subsystem (fixed-size always-on-top window, no Dock icon, fullscreen float, screen-capture shield) has been **removed from the codebase entirely** — not disabled, deleted. The app is now a normal resizable, Dock-visible window with native (not CSS) vibrancy.
- Model tiering moved to `application/agent_registry.rs`, and both the "fast" and "premium" tiers currently resolve to the same model (`gpt-4o-mini`) as a deliberate, cost-driven interim state.
- A previously undocumented **context-brief compiler** compiles a cacheable, per-agent system-prompt prefix once per meeting, replacing repeated re-transmission of grounding context on every transcript chunk.
- A previously undocumented **project/session domain** organizes meetings into projects and gives each capture a lightweight identity before the underlying meeting row exists.
- Ask Roxi grew a **web search** capability — the model decides per turn whether to search, gated only by configuration, with no UI toggle.

Each deep dive covers its slice of this in full; `brain.md`'s "Known Gaps & Stale Claims" table and changelog are the authoritative record of exactly what moved and when.
