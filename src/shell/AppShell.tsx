import React from 'react';
import { tokens, radius } from '../design-system';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * The main widget's shared shell — full size of the Tauri window (420x780).
 * Idle and live surfaces both render inside this same dark shell; there is no
 * separate light chrome for the pre-session screens.
 */
export const AppShell: React.FC<AppShellProps> = ({ children }) => (
  <div className="w-screen h-screen overflow-hidden flex flex-col p-2 bg-transparent select-none">
    <div
      className="w-full h-full flex flex-col font-sans relative overflow-hidden"
      style={{
        // See styles.css for why brightness() is part of the recipe and why
        // this is the only layer allowed to be transparent.
        background: 'rgba(10,10,12,var(--glass-alpha))',
        backdropFilter: 'blur(var(--glass-blur)) saturate(150%) brightness(var(--glass-dim))',
        WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%) brightness(var(--glass-dim))',
        borderRadius: radius.shell,
        border: `1px solid ${tokens.hairline}`,
        boxShadow: [
          '0 48px 96px rgba(0,0,0,0.75)',
          '0 0 0 0.5px rgba(255,255,255,0.05)',
          'inset 0 1px 0 rgba(255,255,255,0.06)',
          '0 0 120px rgba(124,116,242,0.04)',
        ].join(', '),
      }}
    >
      {/* Drag region for Tauri, overlaid across the top strip. */}
      <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-14 z-0 cursor-move"></div>

      <main className="flex-1 overflow-hidden relative z-10 flex flex-col custom-scrollbar">
        {children}
      </main>
    </div>
  </div>
);
