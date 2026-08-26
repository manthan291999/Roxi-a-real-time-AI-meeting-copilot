import { ISpeakerRepository } from '../interfaces/ISpeakerRepository';

export class SpeakerRepository implements ISpeakerRepository {
  private speakerMap: Record<string, number> = {};
  private nextIdx = 0;

  resolveIndex(speakerName: string): number {
    if (this.speakerMap[speakerName] !== undefined) {
      return this.speakerMap[speakerName];
    }
    const idx = this.nextIdx++;
    this.speakerMap[speakerName] = idx;
    return idx;
  }

  reset(): void {
    this.speakerMap = {};
    this.nextIdx = 0;
  }
}
