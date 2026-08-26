# AssemblyAI Hallucination Mitigation — Implementation Plan

## What This Solves

AssemblyAI hallucinations come in two forms:
1. **Noise hallucinations** — random garbage text when there is silence or background noise (e.g. _"Thank you for watching!", "Subscribe for more content", "Subtitles by..."_).
2. **Non-English words** — foreign language text injected into an English meeting due to model drift.

The solution is a **pre-processing firewall** that intercepts every final transcript event **before** it reaches the semantic buffer or any agent — so clean, verified English text is the only thing the rest of the pipeline ever sees.

---

## Proposed Changes

### Phase 1 — Rule-Based Fast Rejection (Zero API Cost)
> **New File**: `gateway/stt/transcript-sanitizer.js`

A pure function module with no external dependencies. Catches the most common hallucinations instantly without any LLM call:
- **Repetition detector**: Rejects chunks with the same phrase repeated 3+ times.
- **Known hallucination blocklist**: A curated set of common AssemblyAI noise phrases (_"Thanks for watching", "Subtitles by", "Subscribe"_, etc.).
- **Minimum word threshold**: Drops chunks under 2 words.
- **Confidence gate**: Rejects chunks where AssemblyAI word-level confidence avg is below `0.4`.

---

### Phase 2 — Word-Level Confidence Filtering (AssemblyAI Provider)
> **Modify**: `gateway/providers/assemblyai.js`

AssemblyAI's `turn` event includes per-word confidence scores in `turn.words`. We will:
- Calculate the **average confidence** of all words in the turn.
- Pass this score alongside the transcript text to the sanitizer.
- Drop any final turn with average confidence below `0.40`.

---

### Phase 3 — LLM Semantic Cleaner Agent (New Agent)
> **New File**: `gateway/agents/transcript-cleaner.js`
> **Modify**: `gateway/config/agent-config.js`
> **Modify**: `gateway/pipeline/chunk-runner.js`

A lightweight, fast LLM agent (`llama-3.1-8b-instant`, 2000ms timeout, 0 retries — must be fast) that runs **before** `analyseChunk`. The agent receives the raw transcript text and responds with a JSON object:

```json
{
  "action": "keep" | "drop" | "translate",
  "text": "cleaned or translated English text",
  "reason": "explanation for logging"
}
```

Rules given to the LLM:
- `"drop"` if the text is a hallucination (subtitle credits, noise artifacts, filler).
- `"translate"` if the text contains non-English words → returns translated English.
- `"keep"` if the text is clean English → returns it unchanged.

---

### Phase 4 — Wire Into Pipeline (No Logic Change to Other Files)
> **Modify**: `gateway/pipeline/chunk-runner.js`

The `runChunk` function becomes the **single integration point**. It calls the sanitizer (Phase 1+2 result) first, then the LLM cleaner (Phase 3), and only calls `analyseChunk` if both pass. This keeps all other files completely untouched.

```
runChunk(text, speaker)
  → sanitizeTranscript(text, confidence)   ← Phase 1: sync, instant
      ✗ drop  → log + return               ← exits early, no LLM calls
      ✓ pass
  → cleanTranscript(text)                  ← Phase 3: LLM agent, fast
      ✗ drop  → log + return
      ✓ keep/translate → cleanedText
  → analyseChunk(cleanedText, speaker)     ← existing pipeline, unchanged
  → persist + broadcast
```

---

## Files Changed

| File | Action | Why |
|---|---|---|
| `gateway/stt/transcript-sanitizer.js` | **NEW** | Rule-based, zero-cost fast rejection |
| `gateway/agents/transcript-cleaner.js` | **NEW** | LLM semantic cleaning agent |
| `gateway/config/agent-config.js` | **MODIFY** | Add `transcript_cleaner` config entry |
| `gateway/providers/assemblyai.js` | **MODIFY** | Pass word-level confidence with `final` event |
| `gateway/pipeline/chunk-runner.js` | **MODIFY** | Insert sanitizer + cleaner before `analyseChunk` |

> [!IMPORTANT]
> All other files (`agent-orchestrator.js`, `semantic-buffer.js`, `sidecar.js`, agents, etc.) are **NOT touched**. The firewall is inserted at a single decoupled point: `chunk-runner.js`.

---

## Verification Plan

1. Speak silence into the mic → no transcript should appear in UI.
2. Play background music → no hallucinated subtitles.
3. Say a phrase in Hindi/Spanish → it arrives in the UI as English.
4. Say a clear English sentence → passes through unchanged.
