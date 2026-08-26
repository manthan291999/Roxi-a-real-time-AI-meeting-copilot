# Handle AssemblyAI Hallucinations and Translate to English

This plan outlines how to handle cases where AssemblyAI hallucinates or outputs non-English words, translating or filtering them into proper English before they are displayed or processed by the rest of the application.

> [!WARNING]
> ## Open Questions
> Your request is a bit ambiguous, so I want to make sure I understand exactly what you need before writing code:
> 
> 1. **Are participants speaking in a non-English language?** (i.e. AssemblyAI is correctly transcribing Spanish/Hindi/etc., and you want to translate it to English?)
> 2. **Or is AssemblyAI just hallucinating garbage text** when there is silence or background noise, and you want to detect and remove those hallucinations?
> 3. **Should we replace the original transcript completely** with the translated English text, or show it side-by-side in the UI?
> 
> *Please reply in the chat to clarify your intent!*

## Proposed Changes

### `gateway/agent.js`
We will add a new "preprocessing" agent step that intercepts the transcript chunks from AssemblyAI before they are saved or processed by the other AI agents (like the Context Manager or Analyst).

#### [MODIFY] `gateway/agent.js`
- **Add Translation/Filter Agent**: Create a new fast LLM agent (using `llama-3.1-8b-instant`) tasked with cleaning the transcript.
- **Update `processChunk`**: 
  - Send the raw chunk to this new agent first.
  - The agent will evaluate the chunk:
    - If it's a known AI hallucination (e.g. repeated phrases, hallucinated subtitles), return a flag to drop it.
    - If it contains non-English text, translate it to English.
    - If it's normal English, leave it alone.
  - The rest of the `processChunk` pipeline will use this clean, translated English text.

### `gateway/sidecar.js`
#### [MODIFY] `gateway/sidecar.js`
- Update the sidecar to await this preprocessing step (or handle the translation in the `processAndEmit` loop) so that the `Final` transcript event emitted to the frontend contains the corrected English text instead of the raw hallucination.

## Verification Plan

### Manual Verification
- Start a capture session and speak in a non-English language to verify it gets translated to English.
- Stay completely silent to see if background noise triggers hallucinations, and verify they are successfully filtered out and not shown in the UI.
