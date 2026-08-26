export interface ISpeakerRepository {
  resolveIndex(speakerName: string): number;
  reset(): void;
}
