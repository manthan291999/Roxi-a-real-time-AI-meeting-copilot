import { invoke } from '@tauri-apps/api/core';
import { ICaptureService } from '../shared/interfaces';
import { MeetingContext } from '../shared/types';
import { toStartCapturePayload } from './mappers';

/**
 * Tauri adapter. The only place that knows the `start_capture` argument names —
 * callers pass a MeetingContext and stay unaware of the Rust signature.
 */
export class TauriCaptureService implements ICaptureService {
  async startCapture(context?: MeetingContext): Promise<void> {
    await invoke('start_capture', toStartCapturePayload(context));
  }

  async stopCapture(): Promise<void> {
    await invoke('stop_capture');
  }

  async checkBlackholeInstalled(): Promise<boolean> {
    return await invoke('check_blackhole_installed');
  }
}
