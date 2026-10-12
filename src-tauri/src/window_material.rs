//! window_material — the window's own translucency, owned in one place.
//!
//! The rest of the app never names a platform type. `lib.rs` calls `apply()`
//! and gets a `Result`; everything below the API boundary — NSVisualEffectView,
//! appearance pinning, the `#[cfg]` split — stays here.
//!
//! WHY THIS EXISTS AT ALL: CSS `backdrop-filter` samples the backdrop *within
//! the page*. The desktop is not in the page, so once the window is
//! transparent the stylesheet's blur has nothing left to sample. The layer
//! that actually blurs what is behind the window is the OS's own
//! `NSVisualEffectView`, inserted between the window and the webview. That is
//! what this module installs.
//!
//! On anything other than macOS this is a no-op and the window stays opaque,
//! which is deliberate: a transparent window with no material behind it puts
//! text directly on the user's desktop, and nothing in CSS can rescue that.

/// Install the native translucent material behind the webview.
///
/// Returns `Err` when the platform has one and it could not be applied. The
/// caller decides what that means — this module does not log, exit, or decide
/// policy, so it stays testable and has exactly one reason to change.
#[cfg(target_os = "macos")]
pub fn apply<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) -> anyhow::Result<()> {
    // NSAppearanceCustomization is the protocol that carries setAppearance;
    // NSWindow implements it, but the trait has to be in scope to call it.
    use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSWindow};
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

    // Pin the window to the light appearance BEFORE the material goes in.
    //
    // macOS materials follow the window's appearance, and Roxi's palette is
    // light-only: one `:root` block, near-black text, contrast measured
    // against a white shell. Under a system-wide Dark Mode the material would
    // render dark and put that near-black text on a near-black ground. This
    // is the line that stops the app being unreadable for every user who
    // runs their Mac in dark mode.
    //
    // SAFETY: `ns_window()` hands back a live NSWindow owned by tauri/wry,
    // and it is only dereferenced on the main thread during setup.
    unsafe {
        let ptr = win
            .ns_window()
            .map_err(|e| anyhow::anyhow!("ns_window: {e}"))? as *const NSWindow;
        if let Some(aqua) = NSAppearance::appearanceNamed(NSAppearanceNameAqua) {
            (*ptr).setAppearance(Some(&aqua));
        }
    }

    // Sidebar is the light, lightly-tinted material. Explicitly NOT HudWindow,
    // which is the dark one most floating panels use — it would fight the same
    // dark text the appearance pin above is protecting.
    //
    // No corner radius is passed: `decorations` stays true, so macOS clips the
    // window to its own rounded rect. Passing one here would put a second,
    // differently-sized curve inside the OS frame and ghost at every corner.
    apply_vibrancy(win, NSVisualEffectMaterial::Sidebar, None, None)
        .map_err(|e| anyhow::anyhow!("apply_vibrancy: {e}"))?;

    Ok(())
}

/// No-op fallback. The window is opaque on these platforms, by design.
#[cfg(not(target_os = "macos"))]
pub fn apply<R: tauri::Runtime>(_win: &tauri::WebviewWindow<R>) -> anyhow::Result<()> {
    Ok(())
}
