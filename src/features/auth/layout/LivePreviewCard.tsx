import React from 'react';
import { brandTokens, radius } from '../../../design-system';
import { LIVE_PREVIEW } from '../content/brandContent';

/**
 * A still of what Roxi shows during a meeting. Decorative, so hidden from
 * assistive tech. Stands in for the brand clip under Reduce Motion or if the
 * clip fails to load; the clip shows the same moment, so keep them in step.
 */
export const LivePreviewCard: React.FC = () => (
  <div
    aria-hidden="true"
    className="flex flex-col gap-3.5 p-5 border"
    style={{ borderRadius: radius.panel - 2, background: brandTokens.surface, borderColor: brandTokens.line }}
  >
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: brandTokens.textMute }}>
        <span className="w-2 h-2 rounded-full" style={{ background: brandTokens.live }} />
        Live · {LIVE_PREVIEW.meeting}
      </span>
      <span className="text-[12px]" style={{ color: brandTokens.textDim }}>
        {LIVE_PREVIEW.time}
      </span>
    </div>

    <p className="text-[14px] leading-relaxed" style={{ color: brandTokens.text }}>
      <span className="font-semibold mr-2" style={{ color: brandTokens.accent }}>
        {LIVE_PREVIEW.speaker}
      </span>
      {LIVE_PREVIEW.line}
    </p>

    <div className="h-px" style={{ background: brandTokens.line }} />

    <ul className="flex flex-col gap-2.5">
      {LIVE_PREVIEW.tags.map((tag) => (
        <li key={tag.label} className="flex items-start gap-2.5">
          <span
            className="shrink-0 text-[11px] font-bold uppercase tracking-[0.06em] px-[7px] py-[3px]"
            style={{ borderRadius: radius.chip - 2, color: tag.color, background: tag.background }}
          >
            {tag.label}
          </span>
          <span className="text-[13px] leading-normal" style={{ color: brandTokens.textMute }}>
            {tag.text}
          </span>
        </li>
      ))}
    </ul>
  </div>
);
