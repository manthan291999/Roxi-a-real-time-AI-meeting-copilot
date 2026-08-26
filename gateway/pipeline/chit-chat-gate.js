/**
 * AI Meeting Interpreter — Zero-Cost Chit-Chat Gate
 * 
 * Determines if a chunk of text is just filler or chit-chat that should
 * bypass the LLM pipeline completely. Uses fast rule-based evaluation.
 */

const FILLER_EXACT_MATCHES = new Set([
  'yeah', 'yeah sure', 'okay', 'ok', 'okay great', 'great', 
  'thanks', 'thank you', 'thanks everyone', 'see you', 'see ya', 
  'bye', 'goodbye', 'mm-hmm', 'mm hmm', 'uh-huh', 
  'right', 'right right', 'of course', 'absolutely', 'sure', 
  'sounds good', 'make sense', 'makes sense', 'agreed', 'i agree'
]);

// Phrases that strongly indicate chit-chat or social pleasantries
const CHIT_CHAT_PATTERNS = [
  /^how'?s it going/i,
  /^how are you/i,
  /^how'?s the weather/i,
  /^did you see the (game|match|show)/i,
  /^have a good (day|weekend|night)/i,
  /^see you (later|tomorrow|next week)/i,
  /^can you hear me/i,
  /^you'?re on mute/i,
  /^is everyone here/i,
  /^let'?s get started/i,
  /^i'?ll share my screen/i,
  /^can you see my screen/i
];

/**
 * Evaluates if a given transcript chunk is chit-chat.
 * @param {string} text The chunk text to evaluate
 * @returns {boolean} True if it is chit-chat/filler, false otherwise.
 */
function isChitChat(text) {
  if (!text) return true;

  // Clean the text for comparison (remove punctuation, lower case)
  const cleaned = text.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  
  if (!cleaned) return true;

  // Very short, non-descriptive chunks are often filler
  if (cleaned.length < 3) return true;

  // Check exact matches for common short filler phrases
  if (FILLER_EXACT_MATCHES.has(cleaned)) {
    return true;
  }

  // Check regex patterns for social pleasantries
  for (const pattern of CHIT_CHAT_PATTERNS) {
    if (pattern.test(cleaned)) {
      return true;
    }
  }

  // Check if it's less than 4 words and contains typical agreement/filler words
  const words = cleaned.split(/\s+/);
  if (words.length <= 4) {
    const allFillerWords = words.every(w => FILLER_EXACT_MATCHES.has(w) || w === 'i' || w === 'do' || w === 'yes' || w === 'no' || w === 'well');
    if (allFillerWords) {
      return true;
    }
  }

  return false;
}

module.exports = { isChitChat };
