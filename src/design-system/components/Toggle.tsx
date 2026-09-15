import React from 'react';
import { tokens, radius, easing } from '../tokens';

interface ToggleProps {
  /** Stable id — the hint is wired to the switch through it. */
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible name of the thing being switched. */
  label: string;
  /** One line of micro-copy saying what the current position means. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const TRACK_W = 38;
const TRACK_H = 21;
const KNOB = 15;
const INSET = (TRACK_H - KNOB) / 2;

/**
 * A labelled on/off switch.
 *
 * A real `role="switch"` button rather than a styled checkbox: it carries its
 * own state to assistive tech, takes focus natively, and needs no hidden
 * input to keep in sync. Colour comes from tokens only — no literals — so
 * re-theming stays an edit to `styles.css`.
 */
export const Toggle: React.FC<ToggleProps> = ({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  className = '',
}) => {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: radius.pill,
          background: checked ? tokens.signal : tokens.neutralBg,
          border: `1px solid ${checked ? tokens.signalLine : tokens.neutralLine}`,
          outlineColor: tokens.focusRing,
          transition: `background 160ms ${easing.calm}, border-color 160ms ${easing.calm}`,
        }}
      >
        <span
          className="absolute block"
          style={{
            width: KNOB,
            height: KNOB,
            top: INSET - 1,
            left: checked ? TRACK_W - KNOB - INSET - 2 : INSET - 1,
            borderRadius: radius.pill,
            background: checked ? tokens.ink : tokens.mute,
            transition: `left 160ms ${easing.calm}, background 160ms ${easing.calm}`,
          }}
        />
      </button>

      <div className="flex flex-col min-w-0 leading-tight">
        <span className="text-[12px] font-semibold truncate" style={{ color: tokens.paper }}>
          {label}
        </span>
        {hint && (
          <span id={hintId} className="text-[11px] truncate" style={{ color: tokens.muteDim }}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
};
