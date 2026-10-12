import React from 'react';
import { radius, tokens } from '../../../design-system';

type Icon = React.FC<{ className?: string; style?: React.CSSProperties }>;

/** A tinted square holding one icon — the visual anchor of a single-purpose screen. */
export const IconTile: React.FC<{ icon: Icon }> = ({ icon: Icon }) => (
  <div
    className="w-14 h-14 flex items-center justify-center"
    style={{ borderRadius: radius.card + 2, background: tokens.signalDim, color: tokens.signal }}
    aria-hidden="true"
  >
    <Icon className="w-7 h-7" />
  </div>
);
