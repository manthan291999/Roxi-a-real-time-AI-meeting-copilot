import { useEffect, useRef, useContext } from 'react'
import { RCard } from '../../types'
import { CopyButton, PaneLabel, EmptySlate, SpeakerChip } from '../../components/Shared'
import { ServicesContext } from '../../context/ServicesContext'

export function RepliesPane({ cards }: { cards: RCard[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  const services = useContext(ServicesContext)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [cards])

  return (
    <div className="flex flex-col h-full" style={{ width: '30%' }}>
      <PaneLabel count={cards.filter(c => c.type === 'reply' || !c.type).length} showLegend>Suggested Replies</PaneLabel>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto hide-scroll px-3 py-3 scroll-fade">
          {cards.length === 0 ? (
            <EmptySlate>Suggested replies, decisions, and action items will appear here once the conversation has enough context.</EmptySlate>
          ) : (
            <div className="space-y-2 pb-10">
              {cards.map((c) => {
                if (c.type === 'decision') {
                  const hasSpeaker = !!c.speaker;
                  const idx = hasSpeaker ? c.speakerIdx! : 0;
                  return (
                    <div
                      key={c.id}
                      className="bg-blue-50 rounded-lg border border-blue-100 p-3 animate-slide-in-right relative group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#1B4FCC] flex-shrink-0" />
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-blue-500">Decision</span>
                        </div>
                        {hasSpeaker && <SpeakerChip name={c.speaker!} idx={idx} />}
                      </div>
                      <p className="text-[13px] text-gray-700 leading-relaxed">{c.text}</p>
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50/90 rounded backdrop-blur-sm">
                        <CopyButton text={c.text} />
                      </div>
                    </div>
                  )
                }
                if (c.type === 'action') {
                  const hasAssignee = !!c.assignee;
                  const idx = hasAssignee && services ? services.speakerRepo.resolveIndex(c.assignee!) : 0;
                  return (
                    <div
                      key={c.id}
                      className="bg-white rounded-lg border border-gray-100 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-slide-in-right relative group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 text-gray-400 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="2" width="12" height="12" rx="2" />
                            <path d="M5 8l2 2 4-3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-gray-400">Action Item</span>
                        </div>
                        {hasAssignee && <SpeakerChip name={c.assignee!} idx={idx} />}
                      </div>
                      <p className="text-[13px] text-gray-700 leading-snug">{c.text}</p>
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded backdrop-blur-sm">
                        <CopyButton text={c.text} />
                      </div>
                    </div>
                  )
                }
                // ANSWER card — Green
                if (c.type === 'answer') {
                  const hasSpeaker = !!c.speaker;
                  const idx = hasSpeaker ? c.speakerIdx! : 0;
                  return (
                    <div key={c.id} className="bg-emerald-50 rounded-lg border border-emerald-200 p-3 animate-slide-in-right relative group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px]">✅</span>
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-emerald-600">Answer</span>
                        </div>
                        {hasSpeaker && <SpeakerChip name={c.speaker!} idx={idx} />}
                      </div>
                      <p className="text-[13px] text-gray-700 leading-relaxed">{c.text}</p>
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-emerald-50/90 rounded backdrop-blur-sm">
                        <CopyButton text={c.text} />
                      </div>
                    </div>
                  );
                }
                // QUESTION card — Blue
                if (c.type === 'question') {
                  const hasSpeaker = !!c.speaker;
                  const idx = hasSpeaker ? c.speakerIdx! : 0;
                  return (
                    <div key={c.id} className="bg-blue-50 rounded-lg border border-blue-200 p-3 animate-slide-in-right relative group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px]">❓</span>
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-blue-600">Question</span>
                        </div>
                        {hasSpeaker && <SpeakerChip name={c.speaker!} idx={idx} />}
                      </div>
                      <p className="text-[13px] text-gray-700 leading-relaxed">{c.text}</p>
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50/90 rounded backdrop-blur-sm">
                        <CopyButton text={c.text} />
                      </div>
                    </div>
                  );
                }
                // default: reply
                const hasSpeaker = !!c.speaker;
                const idx = hasSpeaker ? c.speakerIdx! : 0;
                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-lg border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-slide-in-right group overflow-hidden"
                  >
                    {hasSpeaker && (
                      <div className="bg-blue-50/50 px-3 py-1.5 border-b border-gray-100 flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400">Reply To</span>
                        <SpeakerChip name={c.speaker!} idx={idx} />
                      </div>
                    )}
                    <div className="p-3 relative">
                      <p className="text-[13px] text-gray-700 leading-relaxed pr-6">{c.text}</p>
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded backdrop-blur-sm">
                        <CopyButton text={c.text} />
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
