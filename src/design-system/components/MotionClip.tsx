import React, { useEffect, useRef, useState } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/** Tracks the macOS "Reduce motion" setting, including changes while the app is open. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface MotionClipProps {
  src: string;
  /** Frame 0 of the clip, so nothing jumps when playback starts. */
  poster: string;
  /** Intrinsic size of the clip; sets the aspect ratio before it loads. */
  width: number;
  height: number;
  /** Shown instead of the video under Reduce Motion or when the file fails to load. */
  fallback: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A silent, looping, decorative product clip (made with /brag, see
 * src/assets/motion/). Hidden from assistive tech: the surrounding copy says
 * what the clip shows.
 *
 * Plays only while it can be seen. It pauses when the window is hidden
 * (Option+Space) or the clip scrolls out of view, and never plays under
 * Reduce Motion.
 */
export const MotionClip: React.FC<MotionClipProps> = ({ src, poster, width, height, fallback, className = '', style }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const still = reduced || failed;

  useEffect(() => {
    const video = ref.current;
    if (still || !video) return;
    // Set as a property: React does not reliably reflect `muted`, and WebKit
    // only allows autoplay for a video it knows is muted.
    video.muted = true;

    let onScreen = true;
    const sync = () => {
      if (onScreen && !document.hidden) {
        // A refused play() leaves the poster up, which is the right outcome.
        video.play()?.catch(() => {});
      } else {
        video.pause();
      }
    };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting;
            sync();
          });
    observer?.observe(video);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      video.pause();
    };
  }, [still, src]);

  if (still) return <>{fallback}</>;

  return (
    <video
      ref={ref}
      aria-hidden="true"
      tabIndex={-1}
      src={src}
      poster={poster}
      width={width}
      height={height}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      disablePictureInPicture
      onError={() => setFailed(true)}
      className={`block pointer-events-none select-none ${className}`}
      style={{ width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, ...style }}
    />
  );
};
