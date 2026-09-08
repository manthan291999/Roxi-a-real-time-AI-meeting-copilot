import { MeetingContext } from '../types';

export interface ICaptureService {
  /**
   * `context` is optional — a session can start with no context at all.
   * Resolves with the session id (`SessionId::value()` on the Rust side),
   * scoping key for usage lookups and anything else per-session.
   */
  startCapture(context?: MeetingContext): Promise<number>;
  stopCapture(): Promise<void>;
  checkBlackholeInstalled(): Promise<boolean>;
}
