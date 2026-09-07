import { invoke } from '@tauri-apps/api/core';
import { ISpeakerRepository } from '../shared/interfaces';

/**
 * Speaker display names.
 *
 * Names are held locally so already-rendered transcript lines (which carry the
 * raw STT label) re-resolve immediately, and persisted through the host so they
 * survive the session. The rename is applied optimistically and rolled back if
 * the host rejects it — the alternative, waiting for the round trip, makes the
 * rename feel broken while the pipe is busy with audio.
 */
export class SpeakerRepository implements ISpeakerRepository {
  private map = new Map<string, string>();
  private listeners = new Set<() => void>();
  private version = 0;

  async rename(sttLabel: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (!sttLabel || !name) return;

    const previous = this.map.get(sttLabel);
    this.map.set(sttLabel, name);
    this.notify();

    try {
      await invoke('rename_speaker', { sttLabel, displayName: name });
    } catch (err) {
      // Put it back: the name is not persisted, so showing it would be a lie.
      if (previous === undefined) this.map.delete(sttLabel);
      else this.map.set(sttLabel, previous);
      this.notify();
      throw err;
    }
  }

  getDisplayName(sttLabel: string): string {
    return this.map.get(sttLabel) || sttLabel;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
