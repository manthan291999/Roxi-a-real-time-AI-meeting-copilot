import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Only plain web links may leave the app.
 *
 * Every URL that reaches the opener comes from model output or web search
 * results, so it is untrusted. Without this guard a crafted answer could hand
 * the OS a `file:`, `javascript:` or custom-scheme URL and launch whatever
 * handler is registered for it.
 */
export function isSafeExternalUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Open a link in the user's browser. Unsafe or failing links are dropped silently. */
export function openExternalUrl(url: string | null | undefined): void {
  if (!isSafeExternalUrl(url)) return;
  void openUrl(url.trim()).catch(() => {});
}
