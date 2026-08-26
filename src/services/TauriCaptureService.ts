import { invoke } from '@tauri-apps/api/core';
import { ICaptureService } from '../interfaces/ICaptureService';

export class TauriCaptureService implements ICaptureService {
  async startCapture(context: string): Promise<void> {
    await invoke('start_capture', { context });
  }

  async stopCapture(): Promise<void> {
    await invoke('stop_capture');
  }

  async checkBlackHoleInstalled(): Promise<boolean> {
    return invoke<boolean>('check_blackhole_installed');
  }
}
