import { useState, useEffect, useCallback } from 'react';
import { useServices } from '../../context';
import { MeetingContext } from '../../shared/types';

/**
 * Owns the capture session: talks to ICaptureService and tracks provider status.
 * Screen sequencing lives in useCaptureFlow, not here.
 */
export function useCaptureSession() {
  const { captureService, eventBus } = useServices();
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [provider, setProvider] = useState<string>('Claude 3.5 Sonnet');
  const [blackholeMissing, setBlackholeMissing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    captureService.checkBlackholeInstalled().then((installed) => {
      setBlackholeMissing(!installed);
    });

    const unlistenStatus = eventBus.onProviderStatus((s) => {
      setProvider(s.provider);
      setStatus(s.state as 'idle' | 'connecting' | 'live' | 'error');
    });

    const unlistenError = eventBus.onCaptureError((err) => {
      setStatus('error');
      console.error('Capture error:', err);
    });

    return () => {
      unlistenStatus();
      unlistenError();
    };
  }, [captureService, eventBus]);

  const startCapture = useCallback(async (context?: MeetingContext) => {
    if (blackholeMissing) return;
    setStatus('connecting');
    try {
      await captureService.startCapture(context);
      setStatus('live');
    } catch (err) {
      console.error('Failed to start capture:', err);
      setStatus('error');
    }
  }, [captureService, blackholeMissing]);

  const stopCapture = useCallback(async () => {
    setIsStopping(true);
    await captureService.stopCapture();
    setIsStopping(false);
    setStatus('idle');
  }, [captureService]);

  return {
    status,
    provider,
    blackholeMissing,
    isStopping,
    startCapture,
    stopCapture
  };
}
