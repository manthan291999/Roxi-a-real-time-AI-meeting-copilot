import { invoke } from '@tauri-apps/api/core';
import { IBillingService } from '../shared/interfaces';
import { TrialStatus } from '../shared/types';

export class TauriBillingService implements IBillingService {
  getTrialStatus(): Promise<TrialStatus> {
    return invoke<TrialStatus>('get_trial_status');
  }
}
