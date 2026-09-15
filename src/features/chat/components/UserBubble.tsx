import React from 'react';
import { tokens, radius } from '../../../design-system';

/** The tail corner. Small, on the side the bubble is anchored to. */
const TAIL = 4;

/**
 * The user's own turn.
 *
 * Made of the same glass as the shell rather than painted on top of it. It
 * used to be a solid --t-signal block with white text, which was perfectly
 * legible and still wrong: it was the only opaque saturated shape in the app,
 * so it punched a hole through the material everything else is made of.
 *
 * Three things make it read as glass instead of as a tinted rectangle, and
 * they have to travel together — the recipe lives in tokens for that reason:
 * a low accent tint, a specular sheen in one corner, and a bevel bright along
 * the top edge and tinted along the bottom, which is where a real pane shows
 * its thickness.
 *
 * What it deliberately does NOT have is a backdrop-filter of its own. The
 * shell has already blurred this backdrop; blurring the blur changes nothing
 * on screen and costs a second full-window filter pass on a transparent,
 * always-on-top window. The gloss here is painted, not refracted.
 */
export const UserBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex w-full justify-end animate-fade-in">
    <div
      // break-words travels with overflow-hidden, never without it. The clip
      // is what keeps the sheen inside the rounded corners; on its own it
      // would also swallow a long URL in a message, which the old bubble at
      // least let overflow where you could see it.
      className="relative max-w-[85%] px-3.5 py-2.5 text-[14px] leading-relaxed overflow-hidden break-words"
      style={{
        // Written out rather than left to `rounded-br-sm`: an inline
        // borderRadius outranks any class, so the tail this bubble was
        // supposed to have has never actually rendered.
        borderRadius: `${radius.card}px ${radius.card}px ${TAIL}px ${radius.card}px`,
        background: tokens.bubbleUser,
        border: `1px solid ${tokens.bubbleUserLine}`,
        boxShadow: tokens.bubbleUserBevel,
        color: tokens.paper,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: tokens.bubbleUserSheen }}
      />
      {/* Above the sheen. Without the stacking context the highlight would
          wash over the first line of the message. */}
      <span className="relative">{content}</span>
    </div>
  </div>
);
