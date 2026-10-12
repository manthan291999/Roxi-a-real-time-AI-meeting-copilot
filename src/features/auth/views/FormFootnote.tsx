import React from 'react';
import { tokens, typeScale } from '../../../design-system';

/** One centred line of reassurance under a form. */
export const FormFootnote: React.FC<{ children: React.ReactNode; align?: 'center' | 'left' }> = ({ children, align = 'center' }) => (
  <p style={{ color: tokens.muteDim, fontSize: typeScale.caption.fontSize, lineHeight: 1.5, textAlign: align }}>{children}</p>
);
