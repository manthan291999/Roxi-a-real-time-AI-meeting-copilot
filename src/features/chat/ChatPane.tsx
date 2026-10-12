import React, { useRef, useEffect } from 'react';
import { ChatThreadId } from '../../shared/types';
import { useChatThreadContext } from './ChatThreadProvider';
import { ChatInput } from './ChatInput';
import { RoxiAnswerCard } from './components/RoxiAnswerCard';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { UserBubble } from './components/UserBubble';
import { tokens, radius, Toggle, SparkleIcon, ArrowRightIcon } from '../../design-system';
import { useDocumentLibrary } from '../library/useDocumentLibrary';
import { DocumentTray } from './components/documents/DocumentTray';

interface ChatPaneProps {
  /** Which thread this pane is a view of. */
  threadId: ChatThreadId;
  emptyHint?: string;
  /**
   * Snapshot of recent live-meeting lines, taken at ask-time. Only the "ask"
   * thread gets one (from App.tsx) — the history browser answers questions
   * about a past meeting, where "what's happening right now" doesn't apply.
   */
  getLiveContext?: () => string;
  /** Starter questions shown as buttons while the thread is empty. Each is sent as written. */
  suggestions?: string[];
}

/**
 * One chat thread, rendered. Composition only — every rule lives in
 * useChatThread, so the Ask tab and the history browser share this pane
 * instead of the two near-identical copies they used to have.
 */
export const ChatPane: React.FC<ChatPaneProps> = ({
  threadId,
  emptyHint = 'Ask a question about the meeting…',
  getLiveContext,
  suggestions = [],
}) => {
  const { messages, isLoading, thinkingNode, askQuestion, mode, setMode } =
    useChatThreadContext(threadId);
  const isDirect = mode === 'direct';
  const { documents, progressMap, addDocument, deleteDocument } = useDocumentLibrary(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasDocuments = documents.length > 0 || Object.keys(progressMap).length > 0;

  const send = (question: string) => askQuestion(question, getLiveContext?.());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, thinkingNode, documents, progressMap]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="m-auto w-full max-w-[420px] flex flex-col items-center gap-2 py-6 text-center">
            <span
              aria-hidden="true"
              className="w-11 h-11 mb-1 rounded-[12px] flex items-center justify-center border"
              style={{ background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
            >
              <SparkleIcon className="w-5 h-5" />
            </span>
            <p className="text-[15px] font-semibold" style={{ color: tokens.paper }}>
              {isDirect
                ? 'Ask anything'
                : hasDocuments
                  ? 'Ask about your documents or meetings'
                  : emptyHint}
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: tokens.mute }}>
              {isDirect
                ? 'Knowledge is off, so your meetings and documents are not searched. Turn it back on to answer from them.'
                : hasDocuments
                  ? 'Roxi answers from your transcripts and the files you attached, and cites where each answer came from.'
                  : 'Roxi answers from your transcripts and cites the meeting each answer came from. Attach a PDF or TXT with the paperclip for extra context.'}
            </p>
            {suggestions.length > 0 && (
              <div className="mt-3 w-full flex flex-col gap-1.5">
                {suggestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => send(question)}
                    disabled={isLoading}
                    className="group h-10 w-full flex items-center gap-2 px-3.5 border text-left text-[13px] transition-[background-color,transform] duration-150 hover:enabled:bg-[var(--t-overlay-hover)] active:enabled:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
                    style={{ borderRadius: radius.control, background: tokens.card, borderColor: tokens.hairline, color: tokens.paper }}
                  >
                    <span className="flex-1 truncate">{question}</span>
                    <ArrowRightIcon
                      className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                      style={{ color: tokens.mute }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === 'assistant' ? (
              <RoxiAnswerCard key={i} message={msg} onFollowUpClick={send} />
            ) : (
              <UserBubble key={i} content={msg.content} />
            ),
          )
        )}

        {isLoading && <ThinkingIndicator nodeName={thinkingNode} />}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      <div className="flex flex-col shrink-0 w-full relative z-10">
        <DocumentTray
          documents={documents}
          progressMap={progressMap}
          onDelete={deleteDocument}
        />
        {/* Disabled while a question is in flight: the answer on its way was
            asked in the mode shown here, and letting the switch drift mid-ask
            would make the label lie about the reply it is about to render. */}
        <div className="px-4 py-2.5 border-t" style={{ borderColor: tokens.hairlineSoft }}>
          <Toggle
            id={`chat-knowledge-${threadId}`}
            checked={!isDirect}
            onChange={(on) => setMode(on ? 'rag' : 'direct')}
            label="Knowledge"
            hint={
              isDirect
                ? 'Use the AI model only - meetings and documents won\'t be searched'
                : 'Search your meetings and documents for relevant answers'
            }
            disabled={isLoading}
          />
        </div>
        <ChatInput onSend={send} isLoading={isLoading} onUpload={addDocument} />
      </div>
    </div>
  );
};
