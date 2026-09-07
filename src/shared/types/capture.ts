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

/**
 * What the user tells Roxi before capture starts. Both fields are optional —
 * "Skip this context" starts a session with neither.
 */
export interface MeetingContext {
  description?: string;
  role?: MeetingRole;
}
