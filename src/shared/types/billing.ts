/** Mirrors `TrialStatus` in `src-tauri/src/application/trial_usecase.rs`. */
export interface TrialStatus {
  /** The workspace plan, or 'free' when there is no workspace. */
  plan: string;
  /** Paid plans and admins are never metered. */
  unlimited: boolean;
  /** The app owner (ROXI_HISTORY_OWNER_EMAIL) or a listed admin (ROXI_ADMIN_EMAILS). */
  admin: boolean;
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
}
