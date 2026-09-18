import { describe, expect, it } from 'vitest';
import { toSuggestCard } from '../suggestCardMapper';
import { SuggestAnswerWire } from '../../wire';

const baseWire: SuggestAnswerWire = {
  text: 'Ship on Friday',
  speaker: 'Alice',
};

describe('toSuggestCard', () => {
  it('maps the wire shape onto the domain card', () => {
    const card = toSuggestCard(baseWire, 1700000000000);

    expect(card.text).toBe('Ship on Friday');
    expect(card.speaker).toBe('Alice');
    expect(card.timestamp).toBe(1700000000000);
    expect(card.replyType).toBeUndefined();
    expect(card.contextItems).toEqual([]);
    expect(card.bullets).toBeUndefined();
  });

  it('derives a stable id from speaker + text, so a re-emitted suggestion collapses instead of duplicating', () => {
    const first = toSuggestCard(baseWire, 1);
    const second = toSuggestCard(baseWire, 999999); // same speaker/text, different timestamp

    expect(first.id).toBe(second.id);
  });

  it('gives two different suggestions two different ids', () => {
    const a = toSuggestCard({ text: 'Ship on Friday', speaker: 'Alice' });
    const b = toSuggestCard({ text: 'Ship on Monday', speaker: 'Alice' });

    expect(a.id).not.toBe(b.id);
  });

  it('keeps only tags the UI knows how to style, in a stable order', () => {
    const card = toSuggestCard({
      ...baseWire,
      context_items: [
        {
          text: 'the API contract',
          tags: ['risk', 'made-up-tag', 'technical', 'TECHNICAL'],
        },
      ],
    });

    // KNOWN_TAGS order is ['technical', 'decision', 'risk', 'clarification'],
    // not the order the LLM happened to emit them in.
    expect(card.contextItems[0].tags).toEqual(['technical', 'risk']);
  });

  it('defaults missing context-item fields rather than propagating undefined', () => {
    const card = toSuggestCard({
      ...baseWire,
      context_items: [{}],
    });

    expect(card.contextItems[0]).toEqual({
      text: '',
      confidence: 0,
      isVerbatim: false,
      isTechnical: false,
      tags: [],
    });
  });

  it('only sets bullets when the wire actually carries them', () => {
    const withBullets = toSuggestCard({
      ...baseWire,
      bullets: [{ text: 'Reply A', isBest: true }],
    });
    const withoutBullets = toSuggestCard(baseWire);

    expect(withBullets.bullets).toEqual([{ text: 'Reply A', isBest: true }]);
    expect(withoutBullets.bullets).toBeUndefined();
  });

  it('falls back text/speaker to safe defaults when the wire omits them', () => {
    const card = toSuggestCard({ text: undefined as unknown as string, speaker: undefined as unknown as string });
    expect(card.text).toBe('');
    expect(card.speaker).toBe('Unknown');
  });
});
