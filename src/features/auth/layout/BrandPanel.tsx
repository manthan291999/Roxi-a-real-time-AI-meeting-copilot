import React from 'react';
import panelClip from '../../../assets/motion/roxi-brag-panel.mp4';
import panelPoster from '../../../assets/motion/roxi-brag-panel-poster.webp';
import { authDisplaySerif, brandTokens, MotionClip } from '../../../design-system';
import { AuthBrand } from '../components';
import { BRAND_PITCH } from '../content/brandContent';
import { LivePreviewCard } from './LivePreviewCard';
import { TrustPoints } from './TrustPoints';

/**
 * The dark left half of the sign-in screens: lockup, pitch, a looping clip of
 * the product at work (the still card under Reduce Motion), and the privacy
 * promises. Hidden on narrow windows by the
 * `.auth-brand-panel` container rule in styles.css.
 *
 * Top padding clears the macOS traffic lights, which the transparent title
 * bar (tauri.conf.json) draws over this panel.
 */
export const BrandPanel: React.FC = () => (
  <aside
    className="auth-brand-panel relative shrink-0 overflow-hidden flex flex-col justify-between gap-8 pt-16 pb-10 px-12"
    style={{ width: 'clamp(420px, 44%, 560px)', background: brandTokens.ink, color: brandTokens.text }}
  >
    <Orbits />

    {/* `relative` on each block keeps it painted above the absolutely placed orbits. */}
    <div className="relative">
      <AuthBrand tone="onBrand" />
    </div>

    {/* flex-1 + min-h-0 let the clip give up height on a short window instead
        of pushing the trust points off the bottom of the panel. */}
    <div className="relative flex-1 min-h-0 flex flex-col justify-center gap-7">
      <div className="flex flex-col gap-4">
        <h2 style={{ fontFamily: authDisplaySerif, fontSize: 40, lineHeight: 1.1, fontWeight: 400, letterSpacing: '-0.015em' }}>
          {BRAND_PITCH.headline}
        </h2>
        <p className="text-[15px] leading-relaxed max-w-[420px]" style={{ color: brandTokens.textMute }}>
          {BRAND_PITCH.body}
        </p>
      </div>
      <div className="min-h-0 flex">
        {/* The clip is drawn on --t-brand-ink, so letterboxing on a short window is invisible. */}
        <MotionClip
          src={panelClip}
          poster={panelPoster}
          width={960}
          height={720}
          fallback={<LivePreviewCard />}
          style={{ maxHeight: '100%', objectFit: 'contain', objectPosition: 'left center' }}
        />
      </div>
    </div>

    <div className="relative">
      <TrustPoints />
    </div>
  </aside>
);

/** Two faint rings in the top-right corner. Pure decoration. */
const Orbits: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none">
    <span className="absolute rounded-full border" style={{ width: 480, height: 480, right: -160, top: -160, borderColor: brandTokens.orbit }} />
    <span className="absolute rounded-full border" style={{ width: 320, height: 320, right: -80, top: -80, borderColor: brandTokens.orbit }} />
  </div>
);
