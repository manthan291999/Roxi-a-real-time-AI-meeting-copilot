import React from 'react';
import { tokens, radius } from '../../design-system';

/**
 * System Settings building blocks. Every settings category composes these,
 * so rows, groups and buttons stay identical from one pane to the next.
 */

/** A titled inset group: one card, rows split by inset hairlines, optional footnote. */
export const SettingsGroup: React.FC<{ title?: string; footer?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  footer,
  children,
}) => (
  <section className="flex flex-col gap-1.5" aria-label={title}>
    {title && (
      <h3 className="px-1 text-[13px] font-semibold" style={{ color: tokens.mute }}>
        {title}
      </h3>
    )}
    <div
      className="border overflow-hidden divide-y divide-[var(--t-hairline-soft)]"
      style={{ borderRadius: radius.control, background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
    >
      {children}
    </div>
    {footer && (
      <p className="px-1 text-[12px] leading-relaxed" style={{ color: tokens.mute }}>
        {footer}
      </p>
    )}
  </section>
);

interface SettingsRowProps {
  label: React.ReactNode;
  /** A second line under the label. */
  detail?: React.ReactNode;
  /** Right-hand side: a value, a control, or a button. */
  children?: React.ReactNode;
  icon?: React.ReactNode;
}

/** One 44px row: label on the left, value or control on the right. */
export const SettingsRow: React.FC<SettingsRowProps> = ({ label, detail, children, icon }) => (
  <div className="min-h-11 flex items-center gap-3 px-3.5 py-2">
    {icon && (
      <span
        aria-hidden="true"
        className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center"
        style={{ background: tokens.panelRaised, color: tokens.mute }}
      >
        {icon}
      </span>
    )}
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="text-[13px]" style={{ color: tokens.paper }}>{label}</span>
      {detail && <span className="text-[12px] leading-snug" style={{ color: tokens.mute }}>{detail}</span>}
    </div>
    {children !== undefined && <div className="shrink-0 flex items-center gap-2 max-w-[60%]">{children}</div>}
  </div>
);

/** The secondary-text value on the right of a row. */
export const RowValue: React.FC<{ children: React.ReactNode; mono?: boolean }> = ({ children, mono }) => (
  <span className={`truncate text-[13px] ${mono ? 'font-mono text-[12px]' : ''}`} style={{ color: tokens.mute }}>
    {children}
  </span>
);

export type StatusTone = 'ok' | 'warn' | 'idle';

const TONE_COLOR: Record<StatusTone, string> = { ok: tokens.decision, warn: tokens.risk, idle: tokens.muteDim };

/** Colour plus text, always — never a bare dot. */
export const StatusValue: React.FC<{ tone: StatusTone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className="flex items-center gap-1.5 text-[13px]" style={{ color: tone === 'warn' ? tokens.risk : tokens.mute }}>
    <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: TONE_COLOR[tone] }} />
    {children}
  </span>
);

interface SettingsButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'destructive';
  title?: string;
}

/** A 28px push button: white with a hairline, indigo for the default action, red text when destructive. */
export const SettingsButton: React.FC<SettingsButtonProps> = ({ children, onClick, disabled, tone = 'default', title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="h-7 px-3 rounded-[7px] border text-[12px] font-medium whitespace-nowrap transition-[background-color,filter,transform] duration-150 active:enabled:scale-[0.98] hover:enabled:brightness-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
    style={
      tone === 'primary'
        ? { background: tokens.signal, borderColor: 'transparent', color: tokens.onSignal, boxShadow: tokens.signalBevel }
        : { background: tokens.ink, borderColor: tokens.hairline, color: tone === 'destructive' ? tokens.danger : tokens.paper }
    }
  >
    {children}
  </button>
);

/** Keyboard keys, drawn the way macOS menus show shortcuts. */
export const Keys: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="flex items-center gap-1">
    {keys.map((key) => (
      <kbd
        key={key}
        className="min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center border font-sans text-[12px] font-medium"
        style={{ borderRadius: 5, borderColor: tokens.hairline, background: tokens.ink, color: tokens.paper }}
      >
        {key}
      </kbd>
    ))}
  </span>
);

/** Pane heading: Large Title plus one line of what this category covers. */
export const PaneHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
  <header className="flex items-center gap-3.5">
    <span
      aria-hidden="true"
      className="w-11 h-11 shrink-0 rounded-[11px] flex items-center justify-center"
      style={{ background: tokens.signal, color: tokens.onSignal, boxShadow: tokens.signalBevel }}
    >
      {icon}
    </span>
    <div className="min-w-0">
      <h1 className="text-[22px] leading-7 font-bold tracking-[-0.02em]" style={{ color: tokens.paper }}>{title}</h1>
      <p className="text-[13px]" style={{ color: tokens.mute }}>{subtitle}</p>
    </div>
  </header>
);
