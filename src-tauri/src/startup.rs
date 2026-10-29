use tauri_plugin_autostart::ManagerExt;
pub fn enable(app: &tauri::AppHandle) -> Result<(), tauri_plugin_autostart::Error> {
    app.autolaunch().enable()?;
    // Auto-launch 0.6 leaves paths unquoted. The public product name contains a space.
    let path = std::env::current_exe().map_err(|e| tauri_plugin_autostart::Error::Io(e))?;
    windows_registry::CURRENT_USER
        .create("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .and_then(|key| {
            key.set_string(
                "Clipboard Manager",
                format!("\"{}\" --background", path.display()),
            )
        })
        .map_err(|e| tauri_plugin_autostart::Error::Io(e.into()))?;
    Ok(())
}
