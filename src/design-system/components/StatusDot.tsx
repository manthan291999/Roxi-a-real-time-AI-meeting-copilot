import React from 'react';
import { tokens } from '../tokens';

interface StatusDotProps {
  color: 'green' | 'amber' | 'red' | 'gray';
  pulse?: boolean;
}

const COLORS: Record<StatusDotProps['color'], string> = {
  green: tokens.decision,
  amber: tokens.risk,
  red: '#ef4444',
  gray: tokens.muteDim,
};

export const StatusDot: React.FC<StatusDotProps> = ({ color, pulse = false }) => (
  <div
    className={`w-1.5 h-1.5 rounded-full ${pulse ? 'animate-pulse' : ''}`}
    style={{ background: COLORS[color] }}
  />
);
