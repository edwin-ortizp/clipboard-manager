use crate::{changed, db::err, SharedState};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};
use tauri_plugin_updater::UpdaterExt;
#[derive(Serialize)]
pub struct Available {
    version: String,
    notes: String,
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<Available>, String> {
    app.updater_builder().timeout(std::time::Duration::from_secs(20)).build().map_err(err)?.check().await.map_err(|_|"No se pudo consultar la publicación de actualizaciones. Revisa la conexión; el canal aún puede no estar publicado.".to_string()).map(|u|u.map(|u|Available{version:u.version,notes:u.body.unwrap_or_default()}))
}
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    expected_version: String,
) -> Result<(), String> {
    let was_paused;
    {
        let c = state.db.lock().map_err(err)?;
        let running: i64 = c
            .query_row(
                "SELECT count(*) FROM jobs WHERE status='running'",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if running > 0 {
            return Err(
                "Espera a que termine el trabajo activo o cancélalo antes de actualizar".into(),
            );
        }
        if state.updating.swap(true, Ordering::SeqCst) {
            return Err("Ya hay una actualización en curso".into());
        }
        was_paused = state.queue_paused.swap(true, Ordering::SeqCst);
    }
    changed(&app);
    let result=async {
        let update=app.updater_builder().timeout(std::time::Duration::from_secs(20)).build().map_err(err)?.check().await.map_err(|_|"No se pudo consultar la actualización")?.ok_or("No hay una versión nueva disponible")?;
        if update.version!=expected_version{return Err("La versión disponible cambió. Busca actualizaciones de nuevo.".into())}
        let progress_app=app.clone();let mut received=0u64;
        let bytes=update.download(move|chunk,total|{received+=chunk as u64;let _=progress_app.emit("update-progress",serde_json::json!({"received":received,"total":total}));},||{}).await.map_err(|_|"No se pudo descargar o verificar la firma de la actualización. No se modificó la aplicación.".to_string())?;
        let _=app.emit("update-installing",());
        update.install(bytes).map_err(|_|"No se pudo iniciar el instalador de la actualización".to_string())?;
        app.restart();
    }.await;
    state.updating.store(false, Ordering::SeqCst);
    state.queue_paused.store(was_paused, Ordering::SeqCst);
    state.wake.notify_one();
    changed(&app);
    result
}
