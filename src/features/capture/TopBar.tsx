import { Status, ApiKey } from '../../types'
import { RoxiLogo } from '../../components/Shared'

function StatusPill({ status }: { status: Status }) {
  const cfg: Record<Status, { label: string; dot: string; bg: string; text: string; pulse: boolean }> = {
    idle: { label: 'Ready', dot: 'bg-gray-400', bg: 'bg-gray-100', text: 'text-gray-600', pulse: false },
    connecting: { label: 'Connecting…', dot: 'bg-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', pulse: true },
    live: { label: 'Live', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', pulse: true },
    'live-backup': { label: 'Live · Backup STT', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', pulse: true },
    unavailable: { label: 'Transcription unavailable', dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', pulse: false },
    'cost-limit': { label: 'Cost Limit Reached', dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', pulse: false },
  }
  const c = cfg[status]
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className="relative w-2 h-2 flex items-center justify-center flex-shrink-0">
        {c.pulse && (
          <span className={`absolute inset-0 rounded-full ${c.dot} opacity-30 animate-live-pulse`} />
        )}
        <span className={`w-2 h-2 rounded-full ${c.dot} relative`} />
      </span>
      <span>{c.label}</span>
      {status === 'live-backup' && (
        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide ml-0.5">backup</span>
      )}
    </span>
  )
}

function ApiHealthStrip({ keys }: { keys: ApiKey[] }) {
  if (keys.length === 0) return null
  const colorMap: Record<string, string> = {
    closed: 'bg-emerald-500',
    'half-open': 'bg-amber-400',
    open: 'bg-red-500',
  }
  const labelMap: Record<string, string> = { closed: 'OK', 'half-open': 'Testing', open: 'Tripped' }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border border-gray-100">
      <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400 mr-0.5">LLM</span>
      {keys.map((k) => {
        const dot = colorMap[k.state] ?? 'bg-gray-400'
        const secs = k.cooldownRemainingMs > 0 ? `${Math.ceil(k.cooldownRemainingMs / 1000)}s` : ''
        const tip = `Key ${k.index + 1}: ${labelMap[k.state] ?? k.state}${secs ? ` — ${secs}` : ''}`
        return (
          <span key={k.index} title={tip} className="relative flex items-center justify-center w-2 h-2">
            {k.state === 'closed' && <span className="absolute w-2 h-2 rounded-full bg-emerald-400 opacity-40 animate-ping" />}
            <span className={`relative w-2 h-2 rounded-full ${dot}`} />
          </span>
        )
      })}
    </div>
  )
}

function BillingBadge({ billing }: { billing: any }) {
  if (!billing || billing.calls_made === 0) return null
  
  const totalTokens = billing.session_prompt_tokens + billing.session_completion_tokens
  const costUsd = billing.session_total_usd.toFixed(4)
  const tokenStr = new Intl.NumberFormat('en-US').format(totalTokens)

  return (
    <div 
      className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-100/50 text-emerald-700 transition-all hover:bg-emerald-100"
      title={`Calls: ${billing.calls_made}\nPrompt: ${billing.session_prompt_tokens}\nCompletion: ${billing.session_completion_tokens}`}
    >
      <span className="font-semibold text-xs tracking-tight">
        <span className="opacity-80 font-medium mr-1">💰</span>
        ${costUsd}
      </span>
      <span className="w-px h-3 bg-emerald-200/60" />
      <span className="text-[10px] font-medium opacity-80 uppercase tracking-wide">
        {tokenStr} <span className="lowercase">tkns</span>
      </span>
    </div>
  )
}

export function TopBar({
  status,
  isCapturing,
  onStartCapture,
  onStopCapture,
  onShowHistory,
  onShowRename,
  apiKeys = [],
  billing,
}: {
  status: Status
  isCapturing: boolean
  onStartCapture: () => void
  onStopCapture: () => void
  onShowHistory: () => void
  onShowRename: () => void
  apiKeys?: ApiKey[]
  billing?: any
}) {
  return (
    <div className="flex items-center justify-between px-5 h-14 border-b border-gray-200 bg-white flex-shrink-0">
      <div className="flex items-center gap-4">
        <RoxiLogo />
        <div className="w-px h-4 bg-gray-200" />
        <StatusPill status={status} />
      </div>

      <div className="flex items-center gap-2">
        {billing && <BillingBadge billing={billing} />}
        {apiKeys.length > 0 && <ApiHealthStrip keys={apiKeys} />}
        <button
          onClick={onShowHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" strokeLinecap="round" />
            <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 5.5V8l2 1.5" strokeLinecap="round" />
          </svg>
          History
        </button>

        <button
          onClick={onShowRename}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          title="Rename speakers"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="3.5" />
            <path d="M11.5 14c0-2.5-2.5-4-5.5-4" strokeLinecap="round" />
            <path d="M13 9l2 2-3 3-2-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Speakers
        </button>

        {isCapturing ? (
          <button
            onClick={onStopCapture}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
          >
            <span className="w-2 h-2 rounded-sm bg-red-500" />
            Stop Capture
          </button>
        ) : (
          <button
            onClick={onStartCapture}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[#1B4FCC] hover:bg-[#1644B8] transition-colors shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-white opacity-90" />
            Start Capture
          </button>
        )}
      </div>
    </div>
  )
}
