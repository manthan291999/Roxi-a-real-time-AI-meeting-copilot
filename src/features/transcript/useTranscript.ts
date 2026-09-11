import { useTranscriptContext } from './TranscriptProvider';

/**
 * The live transcript, owned by TranscriptProvider (mounted above the tab
 * switcher in App.tsx) so it survives switching to History/Library and back.
 */
export function useTranscript() {
  return useTranscriptContext();
}
