import React, { useCallback, useEffect, useRef, useState } from 'react';
import { tokens, durations, easing } from '../tokens';
import { CopyIcon, CheckIcon } from '../icons';

/** How long the confirmed state holds before reverting to the idle icon. */
const CONFIRM_MS = 1600;

/**
 * Clipboard write plus the "Copied" confirmation window.
 *
 * Extracted from CodeBlock, which had the only copy affordance in the app and
 * now shares this. The timer lives in a ref and is cleared on unmount: a card
 * can be removed (or the meeting can end) inside the confirmation window, and
 * a setState landing after that is a React warning nobody can act on.
 *
 * Failure is deliberately silent. `navigator.clipboard` can be unavailable or
 * refused by the webview, and every surface using this is still selectable by
 * hand, so an error toast would report a problem the user cannot fix.
 */
export function useCopyToClipboard(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), CONFIRM_MS);
    } catch {
      /* See the note above: unavailable clipboard is not an actionable error. */
    }
  }, []);

  return { copied, copy };
}

interface CopyButtonProps {
  /** Resolved at click time, so a caller can pass the text a card holds *now*. */
  text: string | (() => string);
  /**
   * 'label' shows the word beside the glyph (card footers, where there is
   * room and the action deserves naming). 'icon' is glyph-only, for dense
   * rows like a context snippet where the label would outweigh the content.
   */
  variant?: 'icon' | 'label';
  /** What is being copied, for the accessible name: "Copy suggested reply". */
  subject?: string;
  className?: string;
}

/**
 * The one copy affordance. Every surface that offers "take this text with you"
 * uses it, so the confirmation behaviour and the success colour stay identical
 * across the context rows, the suggestion cards and anywhere added later.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  variant = 'icon',
  subject = 'text',
  className = '',
}) => {
  const { copied, copy } = useCopyToClipboard();

  const handleClick = (event: React.MouseEvent) => {
    // Context rows and cards may themselves become clickable later; copying
    // must never also trigger the surface underneath it.
    event.stopPropagation();
    void copy(typeof text === 'function' ? text() : text);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? 'Copied' : `Copy ${subject}`}
      title={copied ? 'Copied' : `Copy ${subject}`}
      className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${className}`}
      style={{
        color: copied ? tokens.decision : tokens.mute,
        outlineColor: tokens.focusRing,
        transition: `color ${durations.fast}ms ${easing.calm}, background-color ${durations.fast}ms ${easing.calm}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tokens.overlayHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
      {variant === 'label' && (
        <span className="text-[11px] font-medium">{copied ? 'Copied' : 'Copy'}</span>
      )}
    </button>
  );
};
