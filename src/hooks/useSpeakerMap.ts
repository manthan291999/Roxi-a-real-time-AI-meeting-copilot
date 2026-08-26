import { useCallback } from 'react'
import { SPEAKER_COLORS } from '../constants'

// Speaker name → stable index map (persists across renders)
export const speakerIndexMap = new Map<string, number>()
let speakerCounter = 0

export function getSpeakerIdx(name: string): number {
  if (!speakerIndexMap.has(name)) {
    speakerIndexMap.set(name, speakerCounter++ % SPEAKER_COLORS.length)
  }
  return speakerIndexMap.get(name)!
}

export function resetSpeakers() {
  speakerIndexMap.clear()
  speakerCounter = 0
}

export function useSpeakerMap() {
  return { getSpeakerIdx, resetSpeakers, speakerIndexMap }
}
