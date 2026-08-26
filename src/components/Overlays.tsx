import { Status } from '../types'

export function ConnectingOverlay() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 animate-fade-in">
      <div className="flex gap-1.5 items-end mb-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-1.5 bg-[#1B4FCC] rounded-full animate-live-pulse"
            style={{
              height: `${12 + i * 5}px`,
              animationDelay: `${i * 0.18}s`,
              opacity: 0.6 + i * 0.1,
            }}
          />
        ))}
      </div>
      <p className="text-sm font-medium text-gray-700">Connecting to audio sources…</p>
      <p className="text-xs text-gray-400">Initializing microphone and system audio</p>
    </div>
  )
}

export function ErrorOverlay({ status }: { status: Status }) {
  const msg =
    status === 'cost-limit'
      ? { title: 'Cost limit reached', body: "This meeting's AI usage cap has been hit. Transcription continues, but AI interpretation is paused." }
      : { title: 'Transcription unavailable', body: 'Unable to connect to the transcription service. Check your network connection or API keys.' }
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center animate-fade-in">
      <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-1">
        <svg className="w-5 h-5 text-red-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 3v5M8 11.5v.5" strokeLinecap="round" />
          <path d="M1.5 13.5l6-11a.6.6 0 0 1 1 0l6 11a.6.6 0 0 1-.5.9H2a.6.6 0 0 1-.5-.9Z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-800">{msg.title}</p>
      <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{msg.body}</p>
    </div>
  )
}
