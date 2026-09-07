export interface ISpeakerRepository {
  /**
   * Rename a speaker. Applied locally straight away, then persisted through the
   * Rust host to the gateway — which owns the live diarization state, so a
   * direct database write would leave already-resolved labels stale.
   *
   * Rejects if the rename could not be persisted; the local change is rolled
   * back first, so a caller that ignores the rejection still shows the truth.
   */
  rename(sttLabel: string, displayName: string): Promise<void>;

  getDisplayName(sttLabel: string): string;

  /** Notifies subscribers when any display name changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;

  /**
   * Monotonic counter bumped on every change. Names live outside React, so
   * consumers use this as a `useSyncExternalStore` snapshot.
   */
  getVersion(): number;
}
