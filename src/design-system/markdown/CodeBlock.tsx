import React from 'react';
import { tokens, radius, durations, easing } from '../tokens';
import { CopyIcon, CheckIcon } from '../icons';
import { useCopyToClipboard } from '../components/CopyButton';

interface CodeBlockProps {
  text: string;
  /** Language tag off the fence, e.g. 'bash'. Empty when the model omitted it. */
  lang?: string;
}

/**
 * A fenced code block from a model answer.
 *
 * The header strip exists for the copy button, not for decoration: the
 * prompts ask the model to put commands and config in fenced blocks, which
 * means most blocks here are something the person is about to run. Retyping a
 * command out of a floating always-on-top panel is the worst version of that.
 *
 * Scrolls horizontally rather than wrapping. A wrapped shell command reads as
 * two commands, and this panel is only ~330px wide inside the answer column.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({ text, lang = '' }) => {
  // Shared with every other copy affordance (context rows, suggestion cards)
  // so the confirmation window and its colour stay identical across them.
  const { copied, copy } = useCopyToClipboard();

  return (
    <div
      className="w-full min-w-0 overflow-hidden"
      style={{
        borderRadius: radius.chip,
        background: tokens.codeBlock,
        border: `1px solid ${tokens.codeLine}`,
      }}
    >
      <div
        className="flex items-center justify-between gap-2 pl-2.5 pr-1 py-1 border-b"
        style={{ background: tokens.codeHead, borderColor: tokens.codeLine }}
      >
        <span
          className="font-mono text-[10px] tracking-wide truncate"
          style={{ color: tokens.muteDim }}
        >
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={() => void copy(text)}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="shrink-0 flex items-center gap-1 px-1.5 py-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
          style={{
            color: copied ? tokens.decision : tokens.mute,
            outlineColor: tokens.focusRing,
            transition: `color ${durations.fast}ms ${easing.calm}`,
          }}
        >
          {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
          <span className="text-[10px] font-medium">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <pre className="overflow-x-auto custom-scrollbar px-2.5 py-2 m-0">
        <code
          className="font-mono text-[12px] leading-[1.6] whitespace-pre"
          style={{ color: tokens.paper }}
        >
          {text}
        </code>
      </pre>
    </div>
  );
};
