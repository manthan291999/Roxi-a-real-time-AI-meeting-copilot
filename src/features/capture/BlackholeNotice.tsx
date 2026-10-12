import React, { useState } from 'react';
import { tokens, radius, CopyButton, WarningIcon } from '../../design-system';

const INSTALL_COMMAND = 'brew install blackhole-2ch';

interface BlackholeNoticeProps {
  /** Re-probes the driver, so a fresh install is picked up without a relaunch. */
  onRecheck?: () => Promise<void> | void;
}

/**
 * Shown instead of the start button when the BlackHole driver is absent —
 * without it there is no system audio to capture on macOS. Written as a setup
 * card rather than an error: on first run this is the expected state, and the
 * user needs the steps, not an apology.
 */
export const BlackholeNotice: React.FC<BlackholeNoticeProps> = ({ onRecheck }) => {
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    if (!onRecheck) return;
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  };

  return (
    <section
      aria-labelledby="blackhole-setup-title"
      className="w-full flex gap-3.5 border text-left"
      style={{
        padding: '18px 18px 16px',
        borderRadius: radius.card,
        background: tokens.card,
        borderColor: tokens.hairline,
        boxShadow: tokens.cardInset,
      }}
    >
      <WarningIcon className="w-[22px] h-[22px] shrink-0 mt-px" style={{ color: tokens.risk }} />
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <h3 id="blackhole-setup-title" className="text-[14px] font-semibold" style={{ color: tokens.paper }}>
          Install BlackHole 2ch
        </h3>
        <ol className="list-decimal pl-[18px] text-[13px] leading-5" style={{ color: tokens.mute }}>
          <li>Run the install command in Terminal.</li>
          <li>In Audio MIDI Setup, create a Multi-Output Device with your speakers and BlackHole 2ch.</li>
          <li>Set it as your Mac’s sound output, then come back here.</li>
        </ol>
        <div
          className="flex items-center gap-2 h-8 pl-3 pr-1.5 font-mono text-[12.5px]"
          style={{ borderRadius: radius.chip, background: tokens.panelRaised, color: tokens.paper }}
        >
          <span className="flex-1 truncate select-all">{INSTALL_COMMAND}</span>
          <CopyButton text={INSTALL_COMMAND} subject="install command" />
        </div>
        {onRecheck && (
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={recheck}
              disabled={checking}
              className="h-[30px] px-3.5 text-[13px] font-semibold transition-[filter] hover:enabled:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] disabled:opacity-60"
              style={{ borderRadius: radius.chip, background: tokens.signal, color: tokens.onSignal }}
            >
              {checking ? 'Checking…' : 'Check Again'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
