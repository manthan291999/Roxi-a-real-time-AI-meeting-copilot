import React from 'react';
import pkg from '../../../package.json';

interface SettingsPaneProps {
  isLive: boolean;
  isConnecting: boolean;
  provider: string;
  sessionId: number | null;
  blackholeMissing: boolean;
}

/**
 * The one deliberately dark surface in an otherwise light-only app (see
 * CLAUDE.md's window-transparency notes) — a one-off glass-black panel, not a
 * new theme. Every value here is a literal, not a `--t-*` token, on purpose:
 * borrowing the light system's tokens for a surface that inverts all of them
 * would be the "derive a colour from a colour" mistake tokens.ts warns
 * against. If a second dark surface shows up, promote these to real tokens
 * instead of copying the literals again.
 */
const dark = {
  panel: 'rgba(20, 20, 24, 0.86)',
  sheen: 'linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 45%)',
  border: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.08)',
  text: '#F2F2F5',
  textMute: 'rgba(242, 242, 245, 0.62)',
  textFaint: 'rgba(242, 242, 245, 0.38)',
  good: '#34D399',
  warn: '#FBBF24',
};

const StatusRow: React.FC<{ label: string; value: string; dotColor: string }> = ({ label, value, dotColor }) => (
  <div className="flex items-center justify-between py-2.5">
    <span className="text-[13px]" style={{ color: dark.textMute }}>{label}</span>
    <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: dark.text }}>
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      {value}
    </span>
  </div>
);

export const SettingsPane: React.FC<SettingsPaneProps> = ({ isLive, isConnecting, provider, sessionId, blackholeMissing }) => {
  const sessionStatus = isLive ? 'Live' : isConnecting ? 'Connecting' : 'Idle';
  const sessionDot = isLive ? dark.good : isConnecting ? dark.warn : dark.textFaint;

  return (
    <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 flex flex-col items-center animate-fade-in">
      <div
        className="w-full max-w-[420px] rounded-[20px] overflow-hidden relative"
        style={{
          background: dark.panel,
          border: `1px solid ${dark.border}`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: dark.sheen }} />

        <div className="relative px-5 pt-5 pb-2">
          <h2 className="text-[18px] font-bold" style={{ color: dark.text }}>Settings</h2>
          <p className="text-[12px] mt-0.5" style={{ color: dark.textFaint }}>Roxi v{pkg.version}</p>
        </div>

        <div className="relative px-5 py-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide pt-2 pb-1" style={{ color: dark.textFaint }}>
            Audio input
          </h3>
          <div className="border-t" style={{ borderColor: dark.divider }}>
            <StatusRow
              label="BlackHole 2ch"
              value={blackholeMissing ? 'Not installed' : 'Installed'}
              dotColor={blackholeMissing ? dark.warn : dark.good}
            />
          </div>
          {blackholeMissing && (
            <p className="text-[12px] leading-relaxed pb-3" style={{ color: dark.textMute }}>
              Roxi needs BlackHole 2ch to capture system audio on macOS. Install it, then reopen the app.
            </p>
          )}
        </div>

        <div className="relative px-5 py-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide pt-2 pb-1" style={{ color: dark.textFaint }}>
            Capture session
          </h3>
          <div className="border-t" style={{ borderColor: dark.divider }}>
            <StatusRow label="Status" value={sessionStatus} dotColor={sessionDot} />
            {(isLive || isConnecting) && (
              <>
                <div className="border-t" style={{ borderColor: dark.divider }} />
                <StatusRow label="Provider" value={provider || '—'} dotColor={sessionDot} />
                <div className="border-t" style={{ borderColor: dark.divider }} />
                <StatusRow label="Session ID" value={sessionId != null ? String(sessionId) : '—'} dotColor={sessionDot} />
              </>
            )}
          </div>
        </div>

        <div className="relative px-5 pt-2 pb-5">
          <p className="text-[12px]" style={{ color: dark.textFaint }}>
            Roxi listens to meetings, transcribes them live, and streams back plain-language explanations, decisions, action items, risks, and suggested replies.
          </p>
        </div>
      </div>
    </div>
  );
};
