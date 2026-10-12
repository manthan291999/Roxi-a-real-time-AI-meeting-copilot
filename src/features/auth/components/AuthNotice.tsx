import React from 'react';
import { radius, tokens, typeScale } from '../../../design-system';

const TONES = {
  error: { role: 'alert', background: tokens.dangerBg, border: tokens.danger, color: tokens.danger },
  success: { role: 'status', background: tokens.decisionBg, border: tokens.decisionLine, color: tokens.decision },
} as const;

/** Inline message above a form. `tone` picks the colour family. */
export const AuthNotice: React.FC<{
  tone: keyof typeof TONES;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone, children, action }) => {
  const t = TONES[tone];
  return (
    <div
      role={t.role}
      className="flex flex-col gap-1.5 px-3.5 py-3 border"
      style={{
        borderRadius: radius.control,
        background: t.background,
        borderColor: t.border,
        color: t.color,
        fontSize: typeScale.label.fontSize,
        lineHeight: 1.45,
      }}
    >
      <span style={{ fontWeight: 500 }}>{children}</span>
      {action}
    </div>
  );
};
