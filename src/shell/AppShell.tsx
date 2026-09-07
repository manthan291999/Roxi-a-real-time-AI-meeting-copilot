import React from 'react';
import { tokens, radius } from '../design-system';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * The main widget's shared shell — full size of the Tauri window (420x780).
 * Idle and live surfaces both render inside this same shell; there is no
 * separate chrome for the pre-session screens.
 *
 * This component owns layout and nothing else. The glass recipe — background,
 * backdrop filter, shadow — lives in styles.css beside the contrast
 * measurements that justify it, and arrives here as three tokens.
 */
export const AppShell: React.FC<AppShellProps> = ({ children }) => (
  <div className="w-screen h-screen overflow-hidden flex flex-col p-2 bg-transparent select-none">
    <div
      className="w-full h-full flex flex-col font-sans relative overflow-hidden"
      style={{
        background: tokens.shell,
        backdropFilter: tokens.shellBackdrop,
        WebkitBackdropFilter: tokens.shellBackdrop,
        borderRadius: radius.shell,
        border: `1px solid ${tokens.hairline}`,
        boxShadow: tokens.shellShadow,
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
