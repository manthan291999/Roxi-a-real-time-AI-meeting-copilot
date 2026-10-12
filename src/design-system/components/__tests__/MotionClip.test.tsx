// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionClip } from '../MotionClip';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function renderClip() {
  return render(
    <MotionClip src="clip.mp4" poster="poster.webp" width={1040} height={400} fallback={<p>Still card</p>} />,
  );
}

describe('MotionClip', () => {
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // jsdom does not implement media playback.
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it('plays a muted, looping, inline, decorative video', () => {
    const { container } = renderClip();
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.muted).toBe(true);
    expect(video!.loop).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('aria-hidden', 'true');
    expect(video).toHaveAttribute('poster', 'poster.webp');
    expect(play).toHaveBeenCalled();
    expect(screen.queryByText('Still card')).not.toBeInTheDocument();
  });

  it('shows the fallback and no video under Reduce Motion', () => {
    setReducedMotion(true);
    const { container } = renderClip();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('Still card')).toBeInTheDocument();
  });

  it('swaps to the fallback when the clip fails to load', () => {
    const { container } = renderClip();
    fireEvent.error(container.querySelector('video')!);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('Still card')).toBeInTheDocument();
  });

  it('pauses while the window is hidden and resumes when it is shown', () => {
    renderClip();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pause).toHaveBeenCalled();

    play.mockClear();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(play).toHaveBeenCalled();
  });
});
