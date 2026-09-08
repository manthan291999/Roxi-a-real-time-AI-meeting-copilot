import React, { useRef, useEffect } from 'react';
import { ChatThreadId } from '../../shared/types';
import { useChatThreadContext } from './ChatThreadProvider';
import { ChatInput } from './ChatInput';
import { RoxiAnswerCard } from './components/RoxiAnswerCard';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { UserBubble } from './components/UserBubble';
import { tokens } from '../../design-system';
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
}) => {
  const { messages, isLoading, thinkingNode, askQuestion } = useChatThreadContext(threadId);
  const { documents, progressMap, addDocument, deleteDocument } = useDocumentLibrary(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = (question: string) => askQuestion(question, getLiveContext?.());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, thinkingNode, documents, progressMap]);

  return (
    <div className="flex flex-col h-full" style={{ background: tokens.panel }}>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div
            className="h-full flex flex-col items-center justify-center italic text-[14px] text-center"
            style={{ color: tokens.muteDim }}
          >
            {documents.length > 0 || Object.keys(progressMap).length > 0 
              ? "Ask a question about your uploaded documents or the meeting…" 
              : emptyHint}
            <br />
            {documents.length === 0 && Object.keys(progressMap).length === 0 && (
              <span className="text-xs mt-2 opacity-80 not-italic">
                Add context from a PDF or TXT file using the attachment button to get better answers.
              </span>
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
        <ChatInput onSend={send} isLoading={isLoading} onUpload={addDocument} />
      </div>
    </div>
  );
};
