# Ask Roxi — Meeting History Chatbot (LangGraph Adaptive-RAG)

A self-contained chatbot that answers questions about your project from **recorded meeting history**. It searches all meetings (transcripts, summaries, decisions, action items, risks), answers with **cited sources**, and **asks clarifying questions** when your query is vague.

Built as a **LangGraph state graph** with a hexagonal (ports & adapters) architecture — every folder decoupled per SOLID principles.

## Quick start

```bash
cd chatbot
npm install

# Build the search index from the meeting DB (no API key needed)
npm run rebuild-index -- --verify

# Ask a question (uses OPENAI_API_KEY from gateway/.env automatically)
npm run ask "What did we decide about the database?"

# Interactive multi-turn chat
npm run repl

# Run the test suite (36 tests, zero API cost)
npm test
```

## The LangGraph topology (Adaptive / Corrective RAG)

```
START → analyze_query → retrieve (FTS5) → grade_documents → 〈decide〉
                                                              ├─ no evidence + attempts left → rewrite_query ↺ retrieve
                                                              ├─ nothing after all attempts  → respond_no_data → END
                                                              ├─ ambiguous question          → clarify → END
                                                              └─ good evidence               → generate → END
```

| Node | Type | Purpose |
|---|---|---|
| `analyze_query` | LLM | Extract search keywords, detect ambiguity (keyword fallback if LLM fails) |
| `retrieve` | FTS5 | BM25-ranked search over the chatbot-owned index (no LLM cost) |
| `grade_documents` | LLM | Relevance gate — anti-hallucination (keeps top hits if LLM fails) |
| `rewrite_query` | LLM | Broaden keywords; loop capped at 2 rewrites |
| `clarify` | LLM | Show what was found + ask ONE clarifying question with options |
| `generate` | LLM | Grounded answer with `[M#]` citations (evidence digest if LLM fails) |
| `respond_no_data` | deterministic | Honest "not found" — or recent-topic options for vague questions |

Multi-turn memory via LangGraph `MemorySaver` (thread-scoped) + explicit history rehydration.

## Architecture (SOLID / hexagonal)

```
chatbot/
├── sidecar.js                  # entry: stdio protocol server (spawned by Rust/Tauri)
├── bin/
│   ├── ask.js                  # entry: CLI harness (one-shot or --repl)
│   └── rebuild-index.js        # entry: index maintenance (no API key needed)
├── data/                       # chatbot-owned FTS index DB (gitignored)
├── src/
│   ├── domain/                 # contracts only — zero dependencies
│   │   ├── ports/              # Retriever, MeetingStore, LlmGateway, BudgetGuard, ChatLogger
│   │   └── errors.js           # typed domain errors
│   ├── application/            # orchestration (depends on ports, never adapters)
│   │   ├── nodes/              # one file per graph node (SRP)
│   │   ├── graph/              # state schema, constants, routing, evidence, buildChatGraph
│   │   └── useCases/           # AnswerQuestionUseCase (transport-agnostic entry)
│   ├── infrastructure/         # adapters implementing ports
│   │   ├── persistence/        # SqliteMeetingStore (read-only), FtsIndexBuilder, FtsRetriever, ftsQuery
│   │   ├── llm/                # OpenAiLlmGateway (primary), LangchainLlmGateway (alt), prompts, json-parse
│   │   ├── budget/             # CallCountBudgetGuard (soft/hard call caps)
│   │   └── logging/            # JsonLineLogger (stderr — stdout is protocol-only)
│   ├── transport/              # I/O boundaries: stdioSidecar (Rust), cliRepl (terminal)
│   ├── composition/container.js# DI wiring — the only place knowing all concretes
│   └── config/envConfig.js     # the only place reading process.env
└── test/                       # node:test suite incl. full-graph tests with a FakeLlm
```

**Decoupling guarantees**

- The meeting DB (`gateway/meeting_history.db`) is opened **read-only**; the chatbot builds its **own** FTS5 index in `data/chat_index.db` — zero writes to capture-pipeline data, zero WAL conflicts during live capture.
- The LLM never writes raw FTS syntax — keywords are sanitized by `ftsQuery.js` (injection/syntax guard).
- Every node degrades gracefully when the LLM is unavailable (keyword fallbacks, evidence digests) — the graph never hard-fails.
- Swapping the LLM, search engine, or transport = one adapter file + one line in `container.js`.

## stdio protocol (for the Tauri/Rust bridge)

```
stdin  → {"type":"Ask","question":"...","threadId":"...","history":[{"role","content"}]}
         {"type":"RebuildIndex","force":false}
         {"type":"Shutdown"}
stdout ← {"type":"Ready"}
         {"type":"ChatThinking","node":"retrieve"}
         {"type":"ChatReply","payload":{"answer","sources":[{meetingId,date,speaker,snippet,sourceTable}],"clarifyingQuestion","followUps":[],"route","attempts","degradedNote"}}
         {"type":"IndexRebuilt","stats":{...}}
         {"type":"Error","message","code"}
         {"type":"Bye"}
```

Logs go to **stderr** as JSON lines (stdout is reserved for the protocol).

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | from `gateway/.env` | LLM auth (shared, never duplicated) |
| `CHATBOT_MODEL` | `gpt-5.6-luna` | model id (temperature is never sent — model quirk) |
| `CHATBOT_LLM_ADAPTER` | `openai` | `openai` (direct SDK) or `langchain` (ChatOpenAI) |
| `CHATBOT_MEETING_DB` | `../gateway/meeting_history.db` | meeting DB path (read-only) |
| `CHATBOT_INDEX_DB` | `./data/chat_index.db` | chatbot-owned index path |
| `CHATBOT_LLM_BUDGET_SOFT/HARD` | `60` / `80` | per-process LLM call budget |
| `CHATBOT_INDEX_MAX_AGE_MS` | `1800000` | rebuild index when older than this |
| `CHATBOT_LOG_LEVEL` | `info` | debug\|info\|warn\|error |

Own overrides go in `chatbot/.env` (gitignored); `gateway/.env` fills gaps only.
