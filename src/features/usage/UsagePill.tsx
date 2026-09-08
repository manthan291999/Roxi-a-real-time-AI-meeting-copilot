import React, { useEffect, useRef, useState } from 'react';
import { tokens, radius, easing, CoinIcon, ChevronDownIcon } from '../../design-system';
import { SessionUsage } from '../../shared/types';
import { useUsage } from './useUsage';

const NOMINAL_CEILING_USD = 0.5;
const ELEVATED_CEILING_USD = 2.0;

/**
 * Cost-magnitude heuristic for the pill's color — not a budget enforcement.
 * `LLM_BUDGET_SOFT`/`HARD` are documented as a call-count circuit breaker but
 * aren't wired into the Rust agent pipeline today, so this reports spend, it
 * doesn't gate it.
 */
function colorState(costUsd: number): 'nominal' | 'elevated' | 'critical' {
  if (costUsd > ELEVATED_CEILING_USD) return 'critical';
  if (costUsd > NOMINAL_CEILING_USD) return 'elevated';
  return 'nominal';
}

const STATE_COLORS = {
  nominal: { fg: tokens.decision, bg: tokens.decisionBg },
  elevated: { fg: tokens.risk, bg: tokens.riskBg },
  critical: { fg: tokens.danger, bg: tokens.dangerBg },
} as const;

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function minutesSince(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes < 1 ? 'just now' : `${minutes} min`;
}

interface UsagePillProps {
  /** Current capture session, or `null` when nothing is live. */
  sessionId: number | null;
  isLive: boolean;
}

/**
 * Session LLM cost, next to the controls a live meeting already surfaces —
 * not a fourth tab. Renders nothing until the first fetch resolves, and
 * nothing at all outside a live session.
 */
export const UsagePill: React.FC<UsagePillProps> = ({ sessionId, isLive }) => {
  const { usage } = useUsage(sessionId, isLive);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Closing on stop, rather than leaving a stale total's popover open.
  useEffect(() => {
    if (!isLive) setOpen(false);
  }, [isLive]);

  if (!usage) return null;

  const { fg, bg } = STATE_COLORS[colorState(usage.costUsd)];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Session usage, ${formatUsd(usage.costUsd)}`}
        className="flex items-center gap-[5px] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
        style={{
          padding: '4px 9px 4px 7px',
          borderRadius: radius.pill,
          border: 'none',
          background: bg,
          color: fg,
          fontSize: 12,
          fontWeight: 600,
          transition: `opacity 0.15s ${easing.calm}`,
        }}
      >
        <CoinIcon className="w-[13px] h-[13px]" />
        <span className="font-mono tabular-nums">{formatUsd(usage.costUsd)}</span>
        <ChevronDownIcon
          className="w-[9px] h-[9px] transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transitionTimingFunction: easing.calm }}
        />
      </button>

      {open && <UsagePopover usage={usage} />}
    </div>
  );
};

const UsagePopover: React.FC<{ usage: SessionUsage }> = ({ usage }) => {
  const maxAgentCost = Math.max(1e-6, ...usage.byAgent.map((a) => a.costUsd));

  return (
    <div
      className="absolute right-0 z-30"
      style={{
        top: 'calc(100% + 8px)',
        width: 264,
        borderRadius: radius.card,
        background: tokens.card,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: `1px solid ${tokens.hairline}`,
        boxShadow: tokens.sheetShadow,
        padding: 16,
      }}
    >
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-[11px] uppercase tracking-wide font-mono" style={{ color: tokens.muteDim }}>
          This session
        </span>
        {usage.firstTs && (
          <span className="text-[11px] font-mono" style={{ color: tokens.muteDim }}>
            {minutesSince(usage.firstTs)}
          </span>
        )}
      </div>

      <div className="font-mono tabular-nums" style={{ fontSize: 26, fontWeight: 700, color: tokens.paper, lineHeight: 1 }}>
        {formatUsd(usage.costUsd)}
      </div>
      <div className="text-[11.5px] mt-1" style={{ color: tokens.mute }}>
        {usage.calls} calls &middot; {(usage.promptTokens + usage.completionTokens).toLocaleString()} tokens
      </div>

      {usage.byAgent.length > 0 && (
        <>
          <hr className="my-3" style={{ border: 'none', borderTop: `1px solid ${tokens.hairlineSoft}` }} />
          <div className="flex flex-col gap-1.5">
            {usage.byAgent.map((agent) => (
              <div key={agent.tag} className="flex items-center gap-2 text-[11px]" style={{ color: tokens.mute }}>
                <span className="w-[84px] shrink-0 truncate">{agent.tag}</span>
                <span className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: tokens.overlay }}>
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(6, (agent.costUsd / maxAgentCost) * 100)}%`,
                      background: tokens.signal,
                    }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums font-semibold" style={{ color: tokens.paper }}>
                  {formatUsd(agent.costUsd)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[10px] mt-3 leading-relaxed" style={{ color: tokens.muteDim }}>
        Estimated from OpenAI list pricing &mdash; not a metered bill.
      </p>
    </div>
  );
};
