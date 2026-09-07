/**
 * Artifacts the detached risk/analyst lane produces, as they cross the Tauri
 * boundary.
 *
 * Rust emits Vec<Decision> / Vec<ActionItem> / Vec<Risk> — arrays of objects
 * (agents/domain/{decision,action_item,risk}.rs). IEventBus previously declared
 * all three as string[], so any component rendering an element directly as a
 * React child would throw "Objects are not valid as a React child".
 */

export interface MeetingDecision {
  text: string;
  confidence: number;
}

export interface MeetingActionItem {
  text: string;
  assignee?: string | null;
  deadline?: string | null;
}

export interface MeetingRisk {
  text: string;
  category?: string | null;
  severity?: string | null;
}
