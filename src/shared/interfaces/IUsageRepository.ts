import { SessionUsage } from '../types';

export interface IUsageRepository {
  /** Spend for one capture session (the id `startCapture` resolved with). */
  getSessionUsage(sessionId: number): Promise<SessionUsage>;
}
