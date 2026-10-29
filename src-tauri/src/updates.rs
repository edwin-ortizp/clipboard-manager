use crate::{changed, db::err, SharedState};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};
use tauri_plugin_updater::UpdaterExt;

fn check_error(error: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(ref error) if error.is_timeout() =>
            "La consulta de actualizaciones tardó demasiado. Inténtalo de nuevo.",
        Error::Reqwest(ref error) if error.is_decode() =>
            "El manifiesto de actualizaciones no es válido. La publicación debe corregirse.",
        Error::Reqwest(_) | Error::Network(_) =>
            "No se pudo conectar con el servidor de actualizaciones. Revisa la conexión e inténtalo de nuevo.",
        Error::ReleaseNotFound =>
            "El canal de actualizaciones no tiene un manifiesto disponible. Debe publicarse latest.json en GitHub Releases.",
        Error::Serialization(_) | Error::Semver(_) =>
            "El manifiesto de actualizaciones no es válido. La publicación debe corregirse.",
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) |
        Error::UnsupportedArch | Error::UnsupportedOs =>
            "La actualización publicada no incluye un paquete compatible con este equipo.",
        _ => "No se pudo consultar la actualización por un problema de configuración del canal.",
    }.into()
}
#[derive(Serialize)]
pub struct Available {
    version: String,
    notes: String,
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<Available>, String> {
    app.updater_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(check_error)?
        .check()
        .await
        .map_err(check_error)
        .map(|u| {
            u.map(|u| Available {
                version: u.version,
                notes: u.body.unwrap_or_default(),
            })
        })
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
        let update=app.updater_builder().timeout(std::time::Duration::from_secs(20)).build().map_err(check_error)?.check().await.map_err(check_error)?.ok_or("No hay una versión nueva disponible")?;
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

#[cfg(test)]
mod tests {
    use super::check_error;
    use tauri_plugin_updater::Error;

    #[test]
    fn publication_and_platform_errors_do_not_blame_the_connection() {
        let missing = check_error(Error::ReleaseNotFound);
        assert!(missing.contains("latest.json"));
        assert!(!missing.contains("conexión"));
        let invalid = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        assert!(check_error(Error::Serialization(invalid)).contains("no es válido"));
        assert!(check_error(Error::TargetNotFound("windows-x86_64".into())).contains("compatible"));
        assert!(check_error(Error::TargetsNotFound(vec![])).contains("compatible"));
    }

    #[tokio::test]
    async fn connection_failure_and_timeout_have_distinct_messages() {
        use std::net::TcpListener;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        // A listening socket that never answers produces a genuine request timeout.
        let error = reqwest_updater::Client::new()
            .get(&url)
            .timeout(std::time::Duration::from_millis(50))
            .send()
            .await
            .unwrap_err();
        assert!(check_error(Error::Reqwest(error)).contains("tardó demasiado"));
        drop(listener);
        let error = reqwest_updater::Client::new()
            .get(&url)
            .send()
            .await
            .unwrap_err();
        assert!(check_error(Error::Reqwest(error)).contains("No se pudo conectar"));
    }

    #[tokio::test]
    async fn malformed_json_response_is_a_publication_error() {
        use std::{io::Write, net::TcpListener};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            // Read the request first so closing the connection cannot reset unread data.
            use std::io::Read;
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nnot json",
                )
                .unwrap();
        });
        let error = reqwest_updater::Client::new()
            .get(url)
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap_err();
        assert!(check_error(Error::Reqwest(error)).contains("no es válido"));
        server.join().unwrap();
    }
}
