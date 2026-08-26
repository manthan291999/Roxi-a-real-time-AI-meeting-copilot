export interface ICaptureService {
  startCapture(context: string): Promise<void>;
  stopCapture(): Promise<void>;
  checkBlackHoleInstalled(): Promise<boolean>;
}
