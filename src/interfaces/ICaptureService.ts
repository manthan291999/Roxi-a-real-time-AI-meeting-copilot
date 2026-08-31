export interface ICaptureService {
  startCapture(context: string, role?: string): Promise<void>;
  stopCapture(): Promise<void>;
  checkBlackHoleInstalled(): Promise<boolean>;
}
