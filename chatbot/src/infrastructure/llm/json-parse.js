/**
 * json-parse — lenient JSON object extraction from LLM output.
 *
 * Models occasionally wrap JSON in code fences or add prose; this helper
 * recovers the first balanced object so nodes degrade gracefully instead of
 * crashing the graph.
 */

/**
 * @param {string} text raw LLM output
 * @returns {Object|null} parsed object, or null when unrecoverable
 */
function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // 1. Direct parse.
  try { return JSON.parse(trimmed); } catch (_) { /* continue */ }

  // 2. Strip markdown code fences (```json ... ```).
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) { /* continue */ }
  }

  // 3. Slice the first balanced {...} block.
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

module.exports = { parseJsonLoose };
