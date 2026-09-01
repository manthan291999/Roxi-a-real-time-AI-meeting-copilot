import { useEffect, useRef, useState } from 'react'
import { useChat, NODE_LABELS, ChatMessageVM } from './useChat'
import { ChatSource } from '../../interfaces/IChatService'

const EXAMPLE_QUESTIONS = [
  'What did we decide about the database?',
  'What risks or issues did we discuss?',
  'Summarize the latest meeting',
  'What action items are open?',
]

/** Render answer text with clickable [M#] citation markers. */
function AnswerText({ text, onOpenMeeting }: { text: string; onOpenMeeting: (id: number) => void }) {
  const parts = text.split(/(\[M\d+\])/g)
  return (
    <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const m = part.match(/^\[M(\d+)\]$/)
        if (m) {
          const id = Number(m[1])
          return (
            <button
              key={i}
              onClick={() => onOpenMeeting(id)}
              className="inline-flex items-center px-1 py-0 mx-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-semibold hover:bg-blue-100 transition-colors align-baseline"
              title={`Open meeting #${id} in History`}
            >
              M{id}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

function SourceCard({ source, onOpenMeeting }: { source: ChatSource; onOpenMeeting: (id: number) => void }) {
  return (
    <button
      onClick={() => onOpenMeeting(source.meetingId)}
      className="w-full text-left p-2.5 rounded-lg border border-white/40 bg-white/15 hover:border-blue-200 hover:bg-blue-50/40 transition-colors group"
      title="Open this meeting in History"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold">
          Meeting #{source.meetingId}
        </span>
        {source.date && (
          <span className="text-[10px] text-gray-400">
            {new Date(source.date.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        {source.speaker && <span className="text-[10px] text-gray-400">· {source.speaker}</span>}
        <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-gray-300 group-hover:text-blue-400">
          {source.sourceTable}
        </span>
      </div>
      <p className="text-[11.5px] text-gray-500 leading-snug line-clamp-2">“{source.snippet}”</p>
    </button>
  )
}

function ThinkingDots({ node }: { node?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span className="text-[11px] text-gray-400">{NODE_LABELS[node || ''] || 'Thinking…'}</span>
    </div>
  )
}

function MessageBubble({ msg, onOpenMeeting, onFollowUp }: {
  msg: ChatMessageVM
  onOpenMeeting: (id: number) => void
  onFollowUp: (q: string) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-[#1B4FCC] text-white text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm">
          {msg.text}
        </div>
      </div>
    )
  }

  const isThinking = Boolean(msg.thinkingNode) && !msg.text && !msg.error

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[92%] space-y-2">
        <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white/25 border border-white/40">
          {isThinking && <ThinkingDots node={msg.thinkingNode} />}
          {msg.error && (
            <p className="text-[13px] text-red-600 leading-relaxed">⚠ {msg.error}</p>
          )}
          {msg.text && <AnswerText text={msg.text} onOpenMeeting={onOpenMeeting} />}
          {msg.clarifyingQuestion && (
            <div className="mt-2 pt-2 border-t border-amber-200/60">
              <p className="text-[13px] font-medium text-amber-800 leading-snug">❓ {msg.clarifyingQuestion}</p>
            </div>
          )}
        </div>

        {msg.sources && msg.sources.length > 0 && (
          <div className="space-y-1.5 pl-1">
            <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-gray-400">
              Sources · {msg.sources.length}
            </p>
            {msg.sources.map((s, i) => (
              <SourceCard key={`${s.meetingId}-${s.sourceTable}-${i}`} source={s} onOpenMeeting={onOpenMeeting} />
            ))}
          </div>
        )}

        {msg.followUps && msg.followUps.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {msg.followUps.map((f, i) => (
              <button
                key={i}
                onClick={() => onFollowUp(f)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors"
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


export function ChatPanel({ onClose, onOpenMeeting }: {
  onClose: () => void
  onOpenMeeting: (meetingId: number) => void
}) {
  const { messages, thinking, send, clear } = useChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (q?: string) => {
    const question = (q ?? input).trim()
    if (!question || thinking) return
    setInput('')
    send(question)
    inputRef.current?.focus()
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/10 animate-fade-in cursor-pointer" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="w-[680px] max-w-[92vw] h-full glass-modal shadow-2xl flex flex-col animate-history-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.5 8a5.5 5.5 0 0 1-5.5 5.5c-1 0-2-.27-2.83-.75L2.5 13.5l.75-2.67A5.5 5.5 0 1 1 13.5 8z" strokeLinejoin="round" />
              <path d="M5.5 8h.01M8 8h.01M10.5 8h.01" strokeLinecap="round" strokeWidth="2" />
            </svg>
            <span className="font-semibold text-sm text-gray-900">Ask Roxi</span>
            <span className="text-[10px] text-gray-400 font-medium px-1.5 py-0.5 rounded bg-gray-100">meeting memory</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clear}
                className="px-2 py-1.5 rounded-md text-[11px] font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Start a new conversation"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto hide-scroll px-5 py-4 space-y-4 bg-white/5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13.5 8a5.5 5.5 0 0 1-5.5 5.5c-1 0-2-.27-2.83-.75L2.5 13.5l.75-2.67A5.5 5.5 0 1 1 13.5 8z" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">Ask anything about your meetings</p>
              <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                Roxi searches every recorded meeting — transcripts, decisions, risks and action items —
                and answers with sources. Vague questions get a clarifying question back.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-2 max-w-md">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="px-3 py-1.5 rounded-full text-[11.5px] font-medium text-gray-600 bg-white/25 border border-white/40 hover:border-blue-200 hover:text-blue-700 hover:bg-blue-50/50 transition-colors shadow-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onOpenMeeting={onOpenMeeting} onFollowUp={submit} />
            ))
          )}
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-5 py-3.5 border-t border-white/40 bg-white/15">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder={thinking ? 'Roxi is answering…' : 'Ask about decisions, issues, topics…'}
              disabled={thinking}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white/20 text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300 focus:bg-white/30 transition-all disabled:opacity-60"
            />
            <button
              onClick={() => submit()}
              disabled={thinking || !input.trim()}
              className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#1B4FCC] hover:bg-[#1644B8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              Ask
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-gray-300 text-center">
            Answers come only from your recorded meetings — sources are cited below each reply.
          </p>
        </div>
      </div>
    </div>
  )
}
