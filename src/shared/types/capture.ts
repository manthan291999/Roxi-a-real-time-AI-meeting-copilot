/**
 * Who the user is in the meeting. Declared as data (see capture/context-intake/presets.ts)
 * so roles can be added without touching the picker component.
 */
export interface MeetingRole {
  id: string;
  label: string;
  emoji: string;
}

/** A preset that pre-fills the meeting description. */
export interface MeetingPreset {
  id: string;
  label: string;
  description: string;
}

import { ProjectSelection } from './project';

/**
 * What the user tells Roxi before capture starts. `name` is always collected —
 * the intake modal requires it before either "Start Capture" or "Skip this
 * context" will respond. Every other field stays optional.
 */
export interface MeetingContext {
  name: string;
  description?: string;
  role?: MeetingRole;
  project?: ProjectSelection;
  docIds?: string[];
}


/**
 * A loudness reading off the capture mix, normalised to 0..1 against a rolling
 * peak by the Rust meter (`adapters/audio_meter.rs`). `at` is the local
 * timestamp the reading arrived, which is how a renderer tells "quiet" from
 * "the capture stopped and nothing is coming".
 */
export interface AudioLevel {
  rms: number;
  low: number;
  mid: number;
  high: number;
  at: number;
}
