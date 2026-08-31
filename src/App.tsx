import { useState, useEffect, useCallback, useContext } from 'react'
import { Status, SpeakerEntry } from './types'

// Context
import { ServicesContext } from './context/ServicesContext'

// Features
import { useCaptureSession } from './features/capture/useCaptureSession'
import { useTranscript } from './features/transcript/useTranscript'
import { useAnalysis } from './features/analysis/useAnalysis'

// Components
import { TopBar } from './features/capture/TopBar'
import { TranscriptPane } from './features/transcript/TranscriptPane'
import { InterpretationPane } from './features/analysis/InterpretationPane'
import { RepliesPane } from './features/analysis/RepliesPane'
import { HistoryView } from './features/history/HistoryView'
import { ChatPanel } from './features/chat/ChatPanel'
import { ContextModal } from './features/capture/ContextModal'
import { SpeakerRenameModal } from './features/transcript/SpeakerRenameModal'
import { BlackHoleModal } from './features/onboarding/BlackHoleModal'
import { ConnectingOverlay, ErrorOverlay } from './components/Overlays'

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [showHistory, setShowHistory] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [historyFocusId, setHistoryFocusId] = useState<number | null>(null)
  const [showContextModal, setShowContextModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [showBlackHoleModal, setShowBlackHoleModal] = useState(false)
  const [meetingContext, setMeetingContext] = useState('')
  const [apiKeys, setApiKeys] = useState<{ index: number; state: string; cooldownRemainingMs: number }[]>([])
  const [billing, setBilling] = useState<any>(null)

  const services = useContext(ServicesContext)

  const { lines, setLines, sessionSpeakers, setPartialId, lastActiveSpeakerRef } = useTranscript()
  const { summaries, setSummaries, technicals, setTechnicals, replies, setReplies } = useAnalysis(lastActiveSpeakerRef)

  const resetSpeakers = useCallback(() => {
    services?.speakerRepo.reset()
  }, [services])

  const clearData = useCallback(() => {
    setLines([])
    setSummaries([])
    setTechnicals([])
    setReplies([])
  }, [setLines, setSummaries, setTechnicals, setReplies])

  const { isCapturing, handleStartCapture, handleStopCapture, setIsCapturing } = useCaptureSession(
    setStatus,
    resetSpeakers,
    clearData,
    setPartialId
  )

  useEffect(() => {
    services?.captureService.checkBlackHoleInstalled().then((installed) => {
      if (!installed) {
        setShowBlackHoleModal(true)
      }
    }).catch(console.error)
  }, [services])

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        setReplies((prev) => {
          const lastReply = [...prev].reverse().find(r => r.type === 'reply' || !r.type);
          if (lastReply) {
            navigator.clipboard.writeText(lastReply.text).catch(() => {});
          }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setReplies]);

  // Handle provider and connection status changes
  useEffect(() => {
    if (!services) return;
    const unsubs: (() => void)[] = [];
    
    services.eventBus.onProviderStatus(e => {
      const { provider, state } = e;
      if (state === 'connecting' || state === 'switching') setStatus('connecting')
      else if (state === 'active') setStatus(provider === 'speechmatics' ? 'live-backup' : 'live')
      else if (state === 'failed') setStatus('unavailable')
    }).then(u => unsubs.push(u));

    services.eventBus.onCircuitBreaker((snapshot: any) => {
      if (snapshot && snapshot.state === 'open') setStatus('cost-limit');
    }).then(u => unsubs.push(u));

    services.eventBus.onApiHealth(e => {
      if (e.keys) setApiKeys(e.keys);
    }).then(u => unsubs.push(u));

    services.eventBus.onBilling(e => {
      if (e.snapshot) setBilling(e.snapshot);
    }).then(u => unsubs.push(u));

    services.eventBus.onCaptureError(e => {
      console.error('Capture error:', e);
      setStatus('unavailable');
      setIsCapturing(false);
      setPartialId(null);
    }).then(u => unsubs.push(u));

    return () => unsubs.forEach(u => u());
  }, [services, setStatus, setIsCapturing, setPartialId]);

  const isError = status === 'unavailable' || status === 'cost-limit'

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#F7F8FA', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <TopBar
        status={status}
        isCapturing={isCapturing}
        onStartCapture={() => setShowContextModal(true)}
        onStopCapture={handleStopCapture}
        onShowHistory={() => setShowHistory(true)}
        onShowRename={() => setShowRenameModal(true)}
        onShowChat={() => setShowChat(true)}
        apiKeys={apiKeys}
        billing={billing}
      />

      <div className="flex-1 min-h-0 flex">
        {status === 'idle' && !isCapturing ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-fade-in">
            <div className="flex gap-1.5 items-end mb-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-2 bg-gray-200 rounded-full"
                  style={{ height: `${14 + i * 6}px` }}
                />
              ))}
            </div>
            <p className="text-sm font-medium text-gray-500">Ready to capture your meeting</p>
            <p className="text-xs text-gray-400 max-w-xs text-center leading-relaxed">
              Press <span className="font-semibold text-gray-600">Start Capture</span> to begin transcribing
              and interpreting your conversation in real time.
            </p>
            <button
              onClick={() => setShowContextModal(true)}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors shadow-sm"
              style={{ backgroundColor: '#1B4FCC' }}
            >
              <span className="w-2 h-2 rounded-full bg-white opacity-90" />
              Start Capture
            </button>
          </div>
        ) : status === 'connecting' ? (
          <div className="flex-1"><ConnectingOverlay /></div>
        ) : isError ? (
          <div className="flex-1"><ErrorOverlay status={status} /></div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            <TranscriptPane lines={lines} />
            <InterpretationPane summaries={summaries} technicals={technicals} />
            <RepliesPane cards={replies} />
          </div>
        )}
      </div>

      {showRenameModal && (
        <SpeakerRenameModal
          speakers={sessionSpeakers}
          onClose={() => setShowRenameModal(false)}
        />
      )}

      {showChat && (
        <ChatPanel
          onClose={() => {
            setShowChat(false)
            // Stop the chat sidecar so it holds no LLM budget while hidden.
            services?.chatService.close().catch(() => {})
          }}
          onOpenMeeting={(meetingId) => {
            setHistoryFocusId(meetingId)
            setShowHistory(true)
          }}
        />
      )}

      {showHistory && (
        <HistoryView
          onClose={() => { setShowHistory(false); setHistoryFocusId(null) }}
          initialMeetingId={historyFocusId}
        />
      )}

      {showContextModal && (
        <ContextModal
          onSubmit={(ctx, role) => {
            setShowContextModal(false)
            setMeetingContext(ctx)
            handleStartCapture(ctx, role)
          }}
          onCancel={() => setShowContextModal(false)}
        />
      )}

      {showBlackHoleModal && (
        <BlackHoleModal onClose={() => setShowBlackHoleModal(false)} />
      )}
    </div>
  )
}
