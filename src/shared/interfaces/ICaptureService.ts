import { MeetingContext } from '../types';

export interface ICaptureService {
  /** `context` is optional — a session can start with no context at all. */
  startCapture(context?: MeetingContext): Promise<void>;
  stopCapture(): Promise<void>;
  checkBlackholeInstalled(): Promise<boolean>;
}
