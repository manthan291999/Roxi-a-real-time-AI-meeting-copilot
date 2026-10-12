import { TrialStatus } from '../types';

export interface IBillingService {
  /** The free-trial allowance for the signed-in workspace on this Mac. */
  getTrialStatus(): Promise<TrialStatus>;
}
