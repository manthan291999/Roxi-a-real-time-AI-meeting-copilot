import React from 'react';
import { authDisplaySerif, tokens, typeScale } from '../../../design-system';

/** Eyebrow, serif title and one line of context at the top of a form. */
export const AuthHeader: React.FC<{ eyebrow?: string; title: string; children: React.ReactNode }> = ({
  eyebrow,
  title,
  children,
}) => (
  <header className="flex flex-col gap-2">
    {eyebrow && (
      <span className="uppercase" style={{ color: tokens.signal, fontSize: typeScale.caption.fontSize, fontWeight: 600, letterSpacing: '0.12em' }}>
        {eyebrow}
      </span>
    )}
    <h1 style={{ color: tokens.paper, fontFamily: authDisplaySerif, fontSize: 34, lineHeight: 1.1, fontWeight: 500, letterSpacing: '-0.015em' }}>
      {title}
    </h1>
    <p style={{ color: tokens.mute, fontSize: 15, lineHeight: typeScale.body.lineHeight }}>{children}</p>
  </header>
);
