import React from 'react';
import { tokens } from '../design-system';

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
 *
 * The window itself is transparent and a native material sits behind the
 * webview (src-tauri/src/window_material.rs). That is what supplies the blur
 * and the readable ground; what this element paints is a tint over it.
 */
export const AppShell: React.FC<AppShellProps> = ({ children }) => (
  // No inset. The 8px gutter used to hold the CSS drop shadow; with a
  // transparent window the material fills the whole window, so that ring
  // would show a blurred frame around the app instead of the desktop.
  <div className="w-screen h-screen overflow-hidden flex flex-col bg-transparent select-none">
    <div
      className="w-full h-full flex flex-col font-sans relative overflow-hidden"
      style={{
        background: tokens.shell,
        backdropFilter: tokens.shellBackdrop,
        WebkitBackdropFilter: tokens.shellBackdrop,
        // No radius and no border: macOS clips the window to its own rounded
        // rect now, and a second curve inside that one ghosts at every corner.
        // The OS owns the frame; this element just fills it.
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
