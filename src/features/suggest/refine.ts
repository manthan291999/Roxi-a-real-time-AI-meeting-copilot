import { SuggestCardType } from '../../shared/types';

/**
 * One refinement the user can apply to a suggested reply.
 *
 * `instruction` is what the model is told to do. It is spelled out rather than
 * reusing `label` because the chip has to stay short ("Shorter") while the
 * instruction has to be unambiguous ("Cut it to one sentence...") — a two-word
 * instruction produces a two-word interpretation.
 */
export interface RefinePreset {
  id: string;
  label: string;
  instruction: string;
}

/** Add an entry to offer another one-click refinement. */
export const REFINE_PRESETS: RefinePreset[] = [
  {
    id: 'shorter',
    label: 'Make it shorter',
    instruction:
      'Make it noticeably shorter — one sentence if the meaning survives. Cut hedging and filler, keep every concrete commitment, number and name.',
  },
  {
    id: 'formal',
    label: 'More formal',
    instruction:
      'Make it more formal and professional. Remove contractions and casual phrasing, keep it warm rather than stiff, and do not make it longer than it already is.',
  },
];

/**
 * The refine request sent to the chat sidecar in 'direct' mode.
 *
 * Deliberately not a question: the model is handed the exact text to rewrite
 * and told to return nothing else. The meeting line the suggestion answers is
 * included as context because "make it shorter" without it invites the model
 * to cut the very clause that made the reply an answer.
 *
 * Pure, so the wording can be tested and tuned without a running sidecar.
 */
export function buildRefinePrompt(card: SuggestCardType, instruction: string): string {
  const heardLine = card.contextItems[0]?.text?.trim();

  return [
    'Rewrite the reply below. This is a text-editing task, not a question.',
    '',
    heardLine ? `The other person said: "${heardLine}"` : null,
    '',
    'Current reply:',
    `"""${currentReplyText(card)}"""`,
    '',
    `How to change it: ${instruction}`,
    '',
    'Rules:',
    '- Return ONLY the rewritten reply, as plain prose the user can say out loud.',
    '- Keep it in the first person, as something the user says themselves.',
    '- Preserve the original intent and any commitment it makes. Do not invent new facts, names, numbers or promises.',
    '- No preamble, no explanation, no quotation marks around it, no bullet points, no markdown headings.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * The text a card currently reads as.
 *
 * A card is either prose (`text`) or structured bullets, and the bullet form
 * is what the pipeline usually emits — refining only `text` would silently
 * rewrite something the user never saw. Bullets are flattened in display
 * order so the rewrite is of the whole visible reply.
 */
export function currentReplyText(card: SuggestCardType): string {
  if (card.bullets && card.bullets.length > 0) {
    return card.bullets.map((bullet) => bullet.text.trim()).filter(Boolean).join(' ');
  }
  return card.text.trim();
}

/**
 * Strips what a model adds back despite being told not to.
 *
 * Even a tightly constrained rewrite prompt comes back wrapped in quotes or
 * prefixed with "Sure — here's a shorter version:" often enough that showing
 * it raw would put that preamble in front of someone mid-meeting. Cheap to
 * run, and a no-op on a well-formed answer.
 */
export function cleanRefinedText(raw: string): string {
  let text = raw.trim();

  // A leading "Here's the shorter version:" style preamble, only when it ends
  // in a colon on the FIRST line and more text follows it — a reply that
  // legitimately contains a colon mid-sentence is untouched.
  const preamble = text.match(/^[^\n]{0,60}:\s*\n+([\s\S]+)$/);
  if (preamble) text = preamble[1].trim();

  // Symmetric wrapping quotes the prompt asked it to omit.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }

  // A single leading bullet marker — the model turning one sentence into a
  // one-item list. Multi-line bullet output is left alone; that is a real
  // list and mangling it would lose content.
  if (!text.includes('\n')) text = text.replace(/^[-*•]\s+/, '');

  return text;
}
