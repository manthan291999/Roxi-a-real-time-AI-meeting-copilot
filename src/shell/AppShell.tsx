import React from 'react';
import { tokens, radius } from '../design-system';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * The main widget's shared shell — sized by whatever the OS window currently
 * is, from the packaged minimum (480x520, tauri.conf.json) up to however wide
 * the user drags it. There is no fixed design width: `container-type:
 * inline-size` below turns this element into the query container that every
 * descendant's `@container roxi-shell (...)` rule and `cqw`-based spacing
 * measures against, so layout responds to the window's actual content box
 * rather than a hardcoded breakpoint list.
 *
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
        containerType: 'inline-size',
        containerName: 'roxi-shell',
      } as React.CSSProperties}
    >
      {/*
        Drag region: spans the full header height. z-[1] keeps it ABOVE the
        shell background (z-0) but BELOW button rows (z-20), so empty header
        space is draggable and buttons remain clickable.
        pointer-events-none on individual intercepting children is NOT needed:
        Tauri's drag region only fires when no child with pointer-events
        intercepts first — the buttons already do that correctly.
      */}
      <div
        data-tauri-drag-region
        className="absolute top-0 left-0 right-0 z-[1] cursor-move"
        style={{ height: '72px' }}
      />

      <main className="flex-1 overflow-hidden relative z-10 flex flex-col custom-scrollbar">
        {children}
      </main>
    </div>
  </div>
);
