import { useState, useRef, useEffect } from 'react'
import { SCard, TCard, Significance } from '../../types'
import { SPEAKER_COLORS } from '../../constants'
import { SpeakerChip, SigBadge, CopyButton, PaneLabel, EmptySlate } from '../../components/Shared'

function CardItem({ text, sig, time, speaker, speakerIdx }: { text: string; sig: Significance; time: string; speaker: string; speakerIdx: number }) {
  const [expanded, setExpanded] = useState(false)
  const c = SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length]
  return (
    <div 
      onClick={() => setExpanded(!expanded)}
      className="bg-white/12 rounded-lg border border-white/40 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-slide-in-right relative overflow-hidden group cursor-pointer transition-all duration-300"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 opacity-80" style={{ backgroundColor: c.stripeColor }} />
      <div className="pl-2">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <SpeakerChip name={speaker} idx={speakerIdx} />
            <SigBadge sig={sig} />
          </div>
          <span className="font-mono text-[9.5px] text-gray-300 flex-shrink-0">{time}</span>
        </div>
        <p className={`text-[13px] text-gray-700 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded backdrop-blur-sm">
          <CopyButton text={text} />
        </div>
      </div>
    </div>
  )
}

export function InterpretationPane({ summaries, technicals }: { summaries: SCard[]; technicals: TCard[] }) {
  const sumRef = useRef<HTMLDivElement>(null)
  const techRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sumRef.current?.scrollTo({ top: sumRef.current.scrollHeight, behavior: 'smooth' })
  }, [summaries])
  useEffect(() => {
    techRef.current?.scrollTo({ top: techRef.current.scrollHeight, behavior: 'smooth' })
  }, [technicals])

  return (
    <div className="flex flex-col h-full border-r border-gray-100" style={{ width: '32%' }}>
      {/* Executive Summary */}
      <div className="flex flex-col flex-1 min-h-0 border-b border-gray-100">
        <PaneLabel count={summaries.length} showLegend>Executive Summary</PaneLabel>
        <div className="flex-1 min-h-0 relative">
          <div ref={sumRef} className="absolute inset-0 overflow-y-auto hide-scroll px-3 py-3 scroll-fade">
            {summaries.length === 0 ? (
              <EmptySlate>AI summary will appear here as the conversation progresses.</EmptySlate>
            ) : (
              <div className="space-y-2 pb-10">
                {summaries.map((c, i) => (
                  <div key={c.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <CardItem text={c.text} sig={c.sig} time={c.time} speaker={c.speaker} speakerIdx={c.speakerIdx} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Technical Analysis */}
      <div className="flex flex-col flex-1 min-h-0">
        <PaneLabel count={technicals.length}>Technical Analysis</PaneLabel>
        <div className="flex-1 min-h-0 relative">
          <div ref={techRef} className="absolute inset-0 overflow-y-auto hide-scroll px-3 py-3 scroll-fade">
            {technicals.length === 0 ? (
              <EmptySlate>Technical breakdowns will appear here for engineering-heavy discussion.</EmptySlate>
            ) : (
              <div className="space-y-2 pb-10">
                {technicals.map((c, i) => (
                  <div key={c.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <CardItem text={c.text} sig={c.sig} time={c.time} speaker={c.speaker} speakerIdx={c.speakerIdx} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
