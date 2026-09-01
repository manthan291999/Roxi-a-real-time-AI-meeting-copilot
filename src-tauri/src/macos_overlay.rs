//! macOS overlay behavior for the Roxi window.
//!
//! `set_always_on_top` alone does NOT keep a window visible above a fullscreen
//! Zoom/Meet/Teams window. This raises the window to NSStatusWindowLevel and
//! lets it join all Spaces (including fullscreen ones) so the interpreter
//! panel stays readable during meetings. The content-protection shield set in
//! `lib.rs` keeps the window out of screen captures regardless of level.

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior, NSStatusWindowLevel};
use std::ffi::c_void;

/// Raise the window above fullscreen apps and let it follow the user across Spaces.
pub fn make_overlay<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    let ns_window_ptr = win.ns_window()? as *mut c_void;

    // SAFETY: `ns_window()` returns a valid, live NSWindow owned by tauri/wry.
    // The setup hook runs on the main thread, which AppKit requires.
    unsafe {
        let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);

        // Status-window level: floats above fullscreen meeting windows.
        ns_window.setLevel(NSStatusWindowLevel);

        // Appear on every Space and alongside fullscreen windows.
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
    }

    Ok(())
}
