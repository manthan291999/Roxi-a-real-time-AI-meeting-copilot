import { useCallback, useState } from 'react';
import { MeetingContext } from '../../shared/types';
import { useCaptureSession } from './useCaptureSession';

/** Which pre-capture screen is showing. Once live, App renders the session shell. */
export type CaptureStep = 'ready' | 'collecting-context';

/**
 * Sequences the pre-capture screens on top of useCaptureSession: ready screen ->
 * context intake -> live session. Keeping this separate from useCaptureSession
 * means the session hook stays about the session, not about navigation.
 */
export function useCaptureFlow() {
  const session = useCaptureSession();
  const [step, setStep] = useState<CaptureStep>('ready');

  const requestContext = useCallback(() => setStep('collecting-context'), []);
  const cancelContext = useCallback(() => setStep('ready'), []);

  /** Called by the intake modal for both "Start Capture" and "Skip this context". */
  const confirmContext = useCallback(async (context?: MeetingContext) => {
    setStep('ready');
    await session.startCapture(context);
  }, [session]);

  return {
    ...session,
    step,
    isCollectingContext: step === 'collecting-context',
    isStopping: session.isStopping,
    requestContext,
    cancelContext,
    confirmContext,
  };
}
