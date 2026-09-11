import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../../context';
import { AudioLevel } from '../../shared/types';

const SILENT: AudioLevel = { rms: 0, low: 0, mid: 0, high: 0, at: 0 };

/**
 * The live loudness of the capture mix, delivered as a getter rather than a
 * value.
 *
 * This is the one hook in the codebase that deliberately does NOT put what it
 * receives into state. `audio_level` arrives ~31 times a second; a `useState`
 * here would re-render the whole live session subtree 31 times a second for
 * data only an animation loop reads. Instead the latest reading is parked in a
 * ref and handed out through a stable getter, so a `requestAnimationFrame`
 * consumer samples it at its own cadence and React never re-renders at all.
 *
 * The returned function is referentially stable for the life of the component,
 * so it is safe to pass straight into a memoised child.
 */
export function useAudioLevel(): () => AudioLevel {
  const { eventBus } = useServices();
  const latest = useRef<AudioLevel>(SILENT);

  useEffect(() => {
    const unsubscribe = eventBus.onAudioLevel((level) => {
      latest.current = level;
    });
    return unsubscribe;
  }, [eventBus]);

  return useCallback(() => latest.current, []);
}
