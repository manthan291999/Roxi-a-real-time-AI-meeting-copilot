import React from 'react';
import {
  tokens,
  typeScale,
  radius,
  MicIcon,
  SpeakerWaveIcon,
  RoxiMark,
  ChevronRightIcon,
  MotionClip,
} from '../../design-system';
// HEVC with an alpha channel (see brag-output/brag-plan.md); WKWebView plays
// it natively. An engine that can't falls back to the still via MotionClip.
import bannerClip from '../../assets/motion/roxi-brag-banner.mov';
import bannerPoster from '../../assets/motion/roxi-brag-banner-poster.webp';
import bannerStill from '../../assets/motion/roxi-brag-banner-still.webp';
import { Meeting } from '../../shared/types';
import { StartCaptureButton } from './StartCaptureButton';
import { BlackholeNotice } from './BlackholeNotice';
import { CaptureErrorNotice } from './CaptureErrorNotice';

/** How many meetings the Recent list shows before deferring to History. */
const RECENT_LIMIT = 3;

interface IdleScreenProps {
  /** Opens the context intake — this screen does not start capture itself. */
  onStart: () => void;
  onHistory: () => void;
  onLibrary: () => void;
  blackholeMissing: boolean;
  /** Re-probes the BlackHole driver from the setup card. */
  onRecheckBlackhole?: () => Promise<void> | void;
  /** Set when the previous session ended on its own rather than via Stop. */
  lastError?: string | null;
  /** Newest first. The section is hidden while this is empty. */
  recentMeetings?: Meeting[];
  onOpenMeeting?: (meeting: Meeting) => void;
  /** Shown under the Start button, e.g. the free-trial time left. */
  notice?: React.ReactNode;
}

/** "Today, 3:40 PM" / "Yesterday" / "Mon 22 Sep" — the grain a Recent list needs. */
function formatMeetingDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return `Today, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const SectionHeader: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-baseline px-1">
    <h3 className="flex-1" style={{ color: tokens.mute, fontSize: typeScale.label.fontSize, fontWeight: typeScale.label.fontWeight }}>
      {children}
    </h3>
    {action}
  </div>
);

/** A System Settings-style inset group: one card, rows split by inset hairlines. */
const GroupedList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="border overflow-hidden divide-y divide-[var(--t-hairline-soft)]"
    style={{ borderRadius: radius.control, background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
  >
    {children}
  </div>
);

const SourceRow: React.FC<{ icon: React.ReactNode; label: string; value: string; status?: 'ok' | 'warn' }> = ({
  icon,
  label,
  value,
  status,
}) => (
  <div className="h-11 flex items-center gap-2.5 px-3.5">
    <span
      aria-hidden="true"
      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
      style={{ background: tokens.panelRaised, color: tokens.mute }}
    >
      {icon}
    </span>
    <span className="flex-1 text-[13px]" style={{ color: tokens.paper }}>
      {label}
    </span>
    <span className="text-[13px] truncate" style={{ color: status === 'warn' ? tokens.risk : tokens.mute }}>
      {value}
    </span>
    {status && (
      <span
        className="w-[7px] h-[7px] rounded-full shrink-0"
        style={{ background: status === 'ok' ? tokens.decision : tokens.risk }}
        aria-label={status === 'ok' ? 'Connected' : 'Needs setup'}
        role="img"
      />
    )}
  </div>
);

/** The ready screen shown on launch. Presentational: no services, no session state. */
export const IdleScreen: React.FC<IdleScreenProps> = ({
  onStart,
  onHistory,
  onLibrary,
  blackholeMissing,
  onRecheckBlackhole,
  lastError,
  recentMeetings = [],
  onOpenMeeting,
  notice,
}) => {
  const recent = recentMeetings.slice(0, RECENT_LIMIT);

  return (
    // Transparent so the shell's glass shows through. Scrolls rather than
    // clips: the widget can be resized well below the height this column needs.
    <div className="h-full w-full overflow-y-auto custom-scrollbar" style={{ backgroundColor: 'transparent' }}>
      <div className="min-h-full flex flex-col items-center px-6 pt-10 pb-5">
        <div className="w-full max-w-[520px] flex flex-col items-center">
          {blackholeMissing ? (
            // During setup the steps below need the attention, so no clip.
            <RoxiMark size={64} className="mb-5" style={{ filter: `drop-shadow(0 6px 14px ${tokens.signalLine})` }} />
          ) : (
            // No frame: the clip is HEVC with alpha, so it floats on this
            // screen's glass like the heading below it.
            <div data-testid="idle-brag-clip" className="w-full mb-4">
              <MotionClip
                src={bannerClip}
                poster={bannerPoster}
                width={1040}
                height={400}
                fallback={<img src={bannerStill} alt="" aria-hidden="true" width={1040} height={400} className="block w-full h-auto" />}
              />
            </div>
          )}

          <h2
            className="text-center"
            style={{
              color: tokens.paper,
              fontSize: typeScale.display.fontSize,
              lineHeight: typeScale.display.lineHeight,
              fontWeight: typeScale.display.fontWeight,
              letterSpacing: typeScale.display.letterSpacing,
            }}
          >
            {blackholeMissing ? 'One step before your first capture' : 'Ready to capture your meeting'}
          </h2>
          <p className="mt-2 max-w-[440px] text-center text-[15px] leading-[22px]" style={{ color: tokens.mute }}>
            {blackholeMissing
              ? 'Roxi hears you through the microphone. To hear everyone else, it needs BlackHole 2ch.'
              : 'Roxi transcribes, explains and flags action items live, from any Zoom, Meet, Teams or Slack call.'}
          </p>

          <div className="mt-6 w-full flex flex-col items-center gap-4">
            {blackholeMissing ? (
              <BlackholeNotice onRecheck={onRecheckBlackhole} />
            ) : (
              <>
                {lastError && <CaptureErrorNotice message={lastError} />}
                <StartCaptureButton onClick={onStart} />
                {notice}
              </>
            )}
          </div>

          <section className="w-full mt-8 flex flex-col gap-2" aria-label="Capture sources">
            <SectionHeader>Capture sources</SectionHeader>
            <GroupedList>
              <SourceRow icon={<MicIcon className="w-3.5 h-3.5" />} label="Microphone" value="System default input" />
              <SourceRow
                icon={<SpeakerWaveIcon className="w-3.5 h-3.5" />}
                label="System audio"
                value={blackholeMissing ? 'BlackHole 2ch not found' : 'BlackHole 2ch'}
                status={blackholeMissing ? 'warn' : 'ok'}
              />
            </GroupedList>
          </section>

          {recent.length > 0 && (
            <section className="w-full mt-6 flex flex-col gap-2" aria-label="Recent meetings">
              <SectionHeader
                action={
                  <button
                    type="button"
                    onClick={onHistory}
                    className="text-[13px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)] rounded"
                    style={{ color: tokens.signal }}
                  >
                    Show All
                  </button>
                }
              >
                Recent
              </SectionHeader>
              <GroupedList>
                {recent.map((meeting) => (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => (onOpenMeeting ? onOpenMeeting(meeting) : onHistory())}
                    className="w-full h-11 flex items-center gap-2.5 pl-3.5 pr-3 text-left transition-colors hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
                  >
                    <span className="flex-1 truncate text-[13px] font-medium" style={{ color: tokens.paper }}>
                      {meeting.title || 'Untitled meeting'}
                    </span>
                    <span className="text-[12px] shrink-0" style={{ color: tokens.mute }}>
                      {formatMeetingDate(meeting.date)}
                    </span>
                    <ChevronRightIcon className="w-3.5 h-3.5 shrink-0" style={{ color: tokens.mute }} />
                  </button>
                ))}
              </GroupedList>
            </section>
          )}

          <button
            type="button"
            onClick={onLibrary}
            className="mt-5 text-[13px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)] rounded"
            style={{ color: tokens.mute }}
          >
            Manage Library
          </button>
        </div>

        <div className="flex-1 min-h-6" />
        <p className="flex items-center gap-1.5 text-[12px]" style={{ color: tokens.mute }}>
          <kbd
            className="h-[18px] px-1.5 inline-flex items-center border font-sans text-[11px] font-medium"
            style={{ borderRadius: 4, borderColor: tokens.hairline, background: tokens.card }}
          >
            ⌥ Space
          </kbd>
          shows or hides Roxi from anywhere
        </p>
      </div>
    </div>
  );
};
