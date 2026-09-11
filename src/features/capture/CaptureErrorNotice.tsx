import React from 'react';
import { tokens } from '../../design-system';

interface CaptureErrorNoticeProps {
  message: string;
}

/**
 * Shown on the idle screen after a capture session ended on its own (a dead
 * sidecar process, a broken audio pipe, or exhausted STT providers) instead
 * of via the Stop button — so the failure is visible instead of the app just
 * quietly landing back on the ready screen.
 */
export const CaptureErrorNotice: React.FC<CaptureErrorNoticeProps> = ({ message }) => (
  <div
    className="max-w-[400px] rounded-xl border px-4 py-3.5 text-left"
    style={{
      backgroundColor: tokens.riskBg,
      borderColor: tokens.riskLine,
    }}
  >
    <h3 className="mb-1 text-[14px] font-semibold" style={{ color: tokens.risk }}>
      Capture stopped unexpectedly
    </h3>
    <p className="text-[13px] leading-relaxed" style={{ color: tokens.mute }}>
      {message} You can start a new capture below.
    </p>
  </div>
);
