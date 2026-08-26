import { useEffect, useRef } from 'react'
import { TxLine } from '../../types'
import { SPEAKER_COLORS } from '../../constants'
import { SpeakerChip, PaneLabel, EmptySlate } from '../../components/Shared'

export function TranscriptPane({ lines }: { lines: TxLine[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines])

  return (
    <div className="flex flex-col h-full border-r border-gray-100" style={{ width: '38%' }}>
      <PaneLabel count={lines.filter(l => !l.partial).length} showLegend>Live Transcript</PaneLabel>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto hide-scroll px-4 py-3 scroll-fade">
          {lines.length === 0 ? (
            <EmptySlate>Waiting for speech…</EmptySlate>
          ) : (
            <div className="space-y-4 pb-14">
              {lines.map((line, i) => {
                const c = SPEAKER_COLORS[line.speakerIdx % SPEAKER_COLORS.length]
                const isActive = i === lines.length - 1 && line.partial;
                return (
                  <div key={line.id} className="animate-slide-up">
                    <div className="flex items-center gap-2 mb-1.5">
                      <SpeakerChip name={line.speaker} idx={line.speakerIdx} isActive={isActive} />
                      <span className="font-mono text-[10px] text-gray-300">{line.time}</span>
                    </div>
                    <div className="pl-3 border-l-2" style={{ borderLeftColor: c.stripeColor }}>
                      <p
                        className={`text-sm leading-relaxed transition-all duration-300 ${line.partial
                            ? 'text-gray-400 italic animate-shimmer'
                            : 'text-gray-800'
                          }`}
                      >
                        {line.text}
                        {line.partial && (
                          <span className="inline-block ml-1 w-1.5 h-3.5 bg-gray-300 rounded-sm animate-live-pulse" />
                        )}
                      </p>
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
