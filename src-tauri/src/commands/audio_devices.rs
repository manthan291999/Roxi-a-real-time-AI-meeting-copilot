#[tauri::command]
pub async fn check_blackhole_installed() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        if let Ok(devices) = host.devices() {
            for device in devices {
                if let Ok(name) = device.name() {
                    if name.to_lowercase().contains("blackhole") {
                        return Ok(true);
                    }
                }
            }
        }
        return Ok(false);
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}
