import { useState, useEffect, useCallback } from 'react';
import { useServices } from '../../context';
import { MeetingContext } from '../../shared/types';

/**
 * Gateway provider states (gateway/stt/provider-manager.js setState) -> session
 * status. The gateway emits 'active', never 'live', so casting the raw string
 * never matched and WidgetHeader's Live pill and Stop button never rendered.
 */
function toSessionStatus(state: string): 'idle' | 'connecting' | 'live' | 'error' {
  switch (state) {
    case 'active':     return 'live';
    case 'connecting': return 'connecting';
    case 'switching':  return 'connecting';
    case 'failed':     return 'error';
    default:           return 'connecting';
  }
}

/**
 * Owns the capture session: talks to ICaptureService and tracks provider status.
 * Screen sequencing lives in useCaptureFlow, not here.
 */
export function useCaptureSession() {
  const { captureService, eventBus } = useServices();
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [provider, setProvider] = useState<string>('');
  const [blackholeMissing, setBlackholeMissing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  /** Set when the previous session ended on its own rather than via Stop. */
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    captureService.checkBlackholeInstalled().then((installed) => {
      setBlackholeMissing(!installed);
    });

    const unlistenStatus = eventBus.onProviderStatus((s) => {
      setProvider(s.provider);
      setStatus(toSessionStatus(s.state));
    });

    const unlistenError = eventBus.onCaptureError((err) => {
      console.error('Capture error:', err);
      // Land back on the idle screen with the reason visible, rather than
      // leaving the live view frozen with no Stop button (status !== 'live'
      // hides it — see WidgetHeader). Best-effort teardown: the backend
      // process is already gone or dying, so failures here are expected and
      // ignorable — the session is over either way.
      captureService.stopCapture().catch(() => {});
      setLastError(err);
      setStatus('idle');
      setSessionId(null);
    });

    return () => {
      unlistenStatus();
      unlistenError();
    };
  }, [captureService, eventBus]);

  const startCapture = useCallback(async (context?: MeetingContext) => {
    if (blackholeMissing) return;
    setLastError(null);
    setStatus('connecting');
    try {
      const id = await captureService.startCapture(context);
      setSessionId(id);
      // Status is driven by the provider_status event; asserting 'live' here
      // would claim a connection the gateway has not reported yet.
    } catch (err) {
      console.error('Failed to start capture:', err);
      // Back to idle with the reason visible, not a dangling 'error' status
      // the render layer has no screen for (see onCaptureError above).
      setLastError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
      setSessionId(null);
    }
  }, [captureService, blackholeMissing]);

  const stopCapture = useCallback(async () => {
    setIsStopping(true);
    try {
      await captureService.stopCapture();
    } catch (err) {
      console.error('Failed to stop capture:', err);
    } finally {
      // Always return to idle: the session is over either way, and leaving
      // isStopping set disables the only Stop control in the header.
      setIsStopping(false);
      setStatus('idle');
      setSessionId(null);
    }
  }, [captureService]);

  return {
    status,
    provider,
    blackholeMissing,
    isStopping,
    sessionId,
    lastError,
    startCapture,
    stopCapture
  };
}
