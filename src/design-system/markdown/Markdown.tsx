import React, { useMemo } from 'react';
import { tokens, radius } from '../tokens';
import { CodeBlock } from './CodeBlock';
import { parseBlocks, parseInline, Block, ListNode, Inline } from './parse';

interface MarkdownProps {
  source: string;
  /**
   * Transform a run of plain text before it renders.
   *
   * This is the seam that keeps the design system free of chat concepts: the
   * answer card passes its citation resolver here, so `[M64]` becomes a
   * meeting name and `[W1]` a source chip, while this component knows only
   * that some consumer wants a say over text runs. Formatted runs (bold,
   * code, links) deliberately bypass it — a citation token inside a code
   * span is code, not a citation.
   */
  renderText?: (text: string, key: string) => React.ReactNode;
  /**
   * Open a link. Without it a link renders as its label only, because a
   * webview cannot open `target="_blank"` on its own and a dead link that
   * looks live is worse than plain text.
   */
  onLinkClick?: (href: string) => void;
  className?: string;
}

/**
 * Renders the light markdown the model is asked to produce.
 *
 * Before this existed the answer pane split on newlines and inserted `<br>`,
 * so every answer showed its own syntax: literal asterisks around bold runs,
 * dashes instead of bullets, and backticks around commands.
 *
 * Output is React elements throughout. Nothing here builds an HTML string, so
 * there is no `dangerouslySetInnerHTML` and no sanitiser to keep current.
 */
export const Markdown: React.FC<MarkdownProps> = ({
  source,
  renderText,
  onLinkClick,
  className = '',
}) => {
  const blocks = useMemo(() => parseBlocks(source), [source]);

  return (
    <div className={`roxi-md flex flex-col gap-2.5 min-w-0 ${className}`}>
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          path={`b${i}`}
          renderText={renderText}
          onLinkClick={onLinkClick}
        />
      ))}
    </div>
  );
};

const BlockView: React.FC<{
  block: Block;
  path: string;
  renderText?: MarkdownProps['renderText'];
  onLinkClick?: MarkdownProps['onLinkClick'];
}> = ({ block, path, renderText, onLinkClick }) => {
  if (block.kind === 'code') return <CodeBlock text={block.text} lang={block.lang} />;

  if (block.kind === 'rule') {
    return <hr className="border-0 border-t my-1" style={{ borderColor: tokens.hairlineSoft }} />;
  }

  if (block.kind === 'heading') {
    // The prompts tell the model not to use headings, and it mostly obeys.
    // When it does not, this renders as an emphasised line rather than a
    // display size: a 20px heading inside a 330px answer column would
    // outweigh the answer it introduces.
    return (
      <div className="text-[14px] font-semibold leading-snug" style={{ color: tokens.paper }}>
        <InlineView text={block.text} path={`${path}h`} renderText={renderText} onLinkClick={onLinkClick} />
      </div>
    );
  }

  if (block.kind === 'list') {
    return <ListView list={block.list} path={`${path}l`} renderText={renderText} onLinkClick={onLinkClick} />;
  }

  return (
    <p className="m-0 leading-relaxed">
      {block.lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          <InlineView text={line} path={`${path}p${i}`} renderText={renderText} onLinkClick={onLinkClick} />
        </React.Fragment>
      ))}
    </p>
  );
};

const ListView: React.FC<{
  list: ListNode;
  path: string;
  renderText?: MarkdownProps['renderText'];
  onLinkClick?: MarkdownProps['onLinkClick'];
}> = ({ list, path, renderText, onLinkClick }) => {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag className="m-0 flex flex-col gap-1.5" start={list.ordered ? list.start : undefined}>
      {list.items.map((item, i) => (
        <li key={i} className="leading-relaxed">
          <InlineView text={item.inline} path={`${path}i${i}`} renderText={renderText} onLinkClick={onLinkClick} />
          {item.children && (
            <ListView list={item.children} path={`${path}i${i}c`} renderText={renderText} onLinkClick={onLinkClick} />
          )}
        </li>
      ))}
    </Tag>
  );
};

const InlineView: React.FC<{
  text: string;
  path: string;
  renderText?: MarkdownProps['renderText'];
  onLinkClick?: MarkdownProps['onLinkClick'];
}> = ({ text, path, renderText, onLinkClick }) => {
  const runs = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {runs.map((run, i) => (
        <RunView
          key={i}
          run={run}
          rkey={`${path}r${i}`}
          renderText={renderText}
          onLinkClick={onLinkClick}
        />
      ))}
    </>
  );
};

const RunView: React.FC<{
  run: Inline;
  rkey: string;
  renderText?: MarkdownProps['renderText'];
  onLinkClick?: MarkdownProps['onLinkClick'];
}> = ({ run, rkey, renderText, onLinkClick }) => {
  switch (run.t) {
    case 'bold':
      return <strong style={{ fontWeight: 600, color: tokens.paper }}>{run.v}</strong>;
    case 'italic':
      return <em>{run.v}</em>;
    case 'code':
      return (
        <code
          className="font-mono text-[0.86em] px-[0.32em] py-[0.1em] break-words"
          style={{
            background: tokens.codeBg,
            border: `1px solid ${tokens.codeLine}`,
            borderRadius: 4,
            color: tokens.paper,
          }}
        >
          {run.v}
        </code>
      );
    case 'link':
      if (!onLinkClick) return <>{run.v}</>;
      return (
        <button
          type="button"
          onClick={() => onLinkClick(run.href)}
          title={run.href}
          className="underline underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
          style={{ color: tokens.signal, borderRadius: radius.chip, textDecorationThickness: 1 }}
        >
          {run.v}
        </button>
      );
    default:
      return <>{renderText ? renderText(run.v, rkey) : run.v}</>;
  }
};
