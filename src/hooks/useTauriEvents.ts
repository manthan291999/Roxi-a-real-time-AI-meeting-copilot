import { useEffect } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'

export interface TauriEventCallbacks {
  onProviderStatus?: (payload: { provider: string | null; state: string }) => void
  onTranscriptPartial?: (payload: { text: string; speaker: string; sttLabel?: string }) => void
  onTranscriptFinal?: (payload: { text: string; speaker: string; sttLabel?: string }) => void
  onContextExplanation?: (payload: { text: string; speaker: string }) => void
  onTechnicalExplanation?: (payload: { text: string; speaker: string }) => void
  onChunkSignificance?: (payload: string) => void
  onMeetingDecisions?: (payload: { text: string; confidence: number }[]) => void
  onMeetingActionItems?: (payload: { text: string; assignee: string | null; deadline: string | null }[]) => void
  onSuggestedResponse?: (payload: { text: string; speaker: string }) => void
  onCircuitBreaker?: (payload: any) => void
  onApiHealth?: (payload: { keys: { index: number; state: string; cooldownRemainingMs: number }[] }) => void
  onCaptureError?: (payload: string) => void
}

export function useTauriEvents(callbacks: TauriEventCallbacks) {
  useEffect(() => {
    const unlistenPromises: Promise<UnlistenFn>[] = []

    const addListener = <T>(event: string, handler?: (e: any) => void) => {
      if (handler) {
        unlistenPromises.push(listen<T>(event, handler))
      }
    }

    addListener<{ provider: string | null; state: string }>('provider_status', callbacks.onProviderStatus)
    addListener<{ text: string; speaker: string; sttLabel?: string }>('transcript_partial', callbacks.onTranscriptPartial)
    addListener<{ text: string; speaker: string; sttLabel?: string }>('transcript_final', callbacks.onTranscriptFinal)
    addListener<{ text: string; speaker: string }>('context_explanation', callbacks.onContextExplanation)
    addListener<{ text: string; speaker: string }>('technical_explanation', callbacks.onTechnicalExplanation)
    addListener<string>('chunk_significance', callbacks.onChunkSignificance)
    addListener<{ text: string; confidence: number }[]>('meeting_decisions', callbacks.onMeetingDecisions)
    addListener<{ text: string; assignee: string | null; deadline: string | null }[]>('meeting_action_items', callbacks.onMeetingActionItems)
    addListener<{ text: string; speaker: string }>('suggested_response', callbacks.onSuggestedResponse)
    addListener('circuit_breaker', callbacks.onCircuitBreaker)
    addListener<{ keys: { index: number; state: string; cooldownRemainingMs: number }[] }>('api_health', callbacks.onApiHealth)
    addListener<string>('capture_error', callbacks.onCaptureError)

    return () => {
      unlistenPromises.forEach(p => p.then(unlisten => unlisten()))
    }
  }, [
    callbacks.onProviderStatus, callbacks.onTranscriptPartial, callbacks.onTranscriptFinal,
    callbacks.onContextExplanation, callbacks.onTechnicalExplanation, callbacks.onChunkSignificance,
    callbacks.onMeetingDecisions, callbacks.onMeetingActionItems, callbacks.onSuggestedResponse,
    callbacks.onCircuitBreaker, callbacks.onApiHealth, callbacks.onCaptureError
  ])
}
