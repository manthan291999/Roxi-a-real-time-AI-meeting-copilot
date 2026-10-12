import { describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (url: string) => openUrl(url) }));

import { isSafeExternalUrl, openExternalUrl } from '../externalLinks';

describe('isSafeExternalUrl', () => {
  it.each(['https://example.com/a?b=1', 'http://example.com', '  https://example.com  '])(
    'accepts %s',
    (url) => expect(isSafeExternalUrl(url)).toBe(true),
  );

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'vscode://open',
    'data:text/html,<script>',
    'not a url',
    '',
    null,
    undefined,
  ])('rejects %s', (url) => expect(isSafeExternalUrl(url)).toBe(false));
});

describe('openExternalUrl', () => {
  it('opens safe links and drops unsafe ones', () => {
    openUrl.mockClear();
    openExternalUrl('javascript:alert(1)');
    expect(openUrl).not.toHaveBeenCalled();
    openExternalUrl('https://example.com');
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
  });
});
