import { useState, useCallback } from 'react'
import { Significance } from '../types'
import { SPEAKER_COLORS, SIG_CONFIG } from '../constants'
import { speakerIndexMap } from '../hooks/useSpeakerMap'

export function SpeakerChip({ name, idx, isActive }: { name: string; idx: number, isActive?: boolean }) {
  const c = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${c.chip}`}>
      <span className="relative flex h-1.5 w-1.5 items-center justify-center flex-shrink-0">
        {isActive && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${c.dot}`} />}
        <span className={`relative inline-flex w-1.5 h-1.5 rounded-full ${c.dot}`} />
      </span>
      {name}
    </span>
  )
}

export function SigBadge({ sig }: { sig: Significance }) {
  const c = SIG_CONFIG[sig]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest ${c.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => { })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])
  return (
    <button
      onClick={copy}
      className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8l3.5 3.5L13 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="5" width="8" height="9" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5" />
        </svg>
      )}
    </button>
  )
}

export function PaneLabel({ children, count, showLegend }: { children: React.ReactNode; count?: number; showLegend?: boolean }) {
  const speakers = Array.from(speakerIndexMap.entries())
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-gray-100 flex-shrink-0 bg-white z-10">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400">
          {count !== undefined && count > 0 ? `── ${count} ${String(children).toUpperCase()} ──` : children}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {showLegend && speakers.map(([name, idx]) => {
          const c = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
          return (
            <div key={name} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
              <span className="text-[9.5px] font-medium text-gray-500 uppercase tracking-wider">{name}</span>
            </div>
          )
        })
        }
      </div>
    </div>
  )
}

export function EmptySlate({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-10 gap-2 text-center">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mb-1">
        <svg className="w-4 h-4 text-gray-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5.5v3" strokeLinecap="round" />
          <circle cx="8" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed max-w-[180px]">{children}</p>
    </div>
  )
}

export function RoxiLogo() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
        <rect x="0" y="6" width="3.5" height="6" rx="1.75" fill="#1B4FCC" />
        <rect x="5.5" y="2" width="3.5" height="14" rx="1.75" fill="#1B4FCC" />
        <rect x="11" y="4.5" width="3.5" height="9" rx="1.75" fill="#1B4FCC" />
        <rect x="16.5" y="7" width="3.5" height="4" rx="1.75" fill="#1B4FCC" opacity="0.6" />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-gray-900">
        Roxi <span className="text-[#1B4FCC]">AI</span>
      </span>
    </div>
  )
}
