#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod ai;
mod clipboard;
mod db;
mod delivery;
mod mappings;
mod media;
mod startup;
mod updates;
use db::{err, Prompt, Settings};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct Shared {
    db: Mutex<Connection>,
    queue_paused: AtomicBool,
    wake: tokio::sync::Notify,
    cancel: tokio::sync::watch::Sender<i64>,
    startup_error: Mutex<Option<String>>,
    media_dir: std::path::PathBuf,
    updating: AtomicBool,
}
type SharedState = Arc<Shared>;
fn changed(app: &tauri::AppHandle) {
    let _ = app.emit("changed", ());
}
static WINDOW_CREATION: Mutex<()> = Mutex::new(());
static WIDGET_FOCUSED: AtomicBool = AtomicBool::new(false);
static WIDGET_READY: AtomicBool = AtomicBool::new(false);
fn ensure_window(app: &tauri::AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
    let _guard = WINDOW_CREATION.lock().map_err(err)?;
    if let Some(w) = app.get_webview_window(label) {
        return Ok(w);
    }
    if label == "widget" {
        WIDGET_FOCUSED.store(false, Ordering::SeqCst);
        WIDGET_READY.store(false, Ordering::SeqCst);
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .ok_or("Configuración de ventana no disponible")?;
    tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(err)?
        .build()
        .map_err(err)
}
fn request_widget(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || show_widget(&handle));
}
fn request_manager(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let _ = show_manager(handle);
    });
}
fn show_widget(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("widget") {
        if existing.is_visible().unwrap_or(false) {
            existing.destroy().map_err(err)?;
            return Ok(());
        }
    }
    let w = ensure_window(app, "widget")?;
    if let Some(m) = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten())
    {
        let area = m.work_area();
        let scale = m.scale_factor();
        let width = 380f64.min(area.size.width as f64 / scale);
        let height = 540f64.min(area.size.height as f64 / scale);
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.set_position(tauri::PhysicalPosition::new(
            area.position.x + area.size.width as i32 - (width * scale) as i32 - 12,
            area.position.y + area.size.height as i32 - (height * scale) as i32 - 12,
        ));
    }
    w.show().map_err(err)?;
    w.set_focus().map_err(err)?;
    let _ = w.emit("opened", ());
    Ok(())
}
#[derive(Serialize)]
struct Snapshot {
    settings: Settings,
    prompts: Vec<Prompt>,
    jobs: Vec<db::Job>,
    queue_paused: bool,
    has_key: bool,
    startup_error: Option<String>,
    last_delivery: Option<String>,
}
#[tauri::command]
fn snapshot(state: State<SharedState>) -> Result<Snapshot, String> {
    let c = state.db.lock().map_err(err)?;
    Ok(Snapshot {
        settings: db::settings(&c),
        prompts: db::prompts(&c)?,
        jobs: db::jobs(&c)?,
        queue_paused: state.queue_paused.load(Ordering::SeqCst),
        has_key: ai::secret()?.is_some(),
        startup_error: state.startup_error.lock().map_err(err)?.clone(),
        last_delivery: c
            .query_row(
                "SELECT message FROM batches WHERE message IS NOT NULL ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok(),
    })
}
#[tauri::command]
fn list_clips(
    state: State<SharedState>,
    query: String,
    favorite: bool,
    offset: i64,
) -> Result<Vec<db::Clip>, String> {
    db::clips(
        &*state.db.lock().map_err(err)?,
        &query,
        favorite,
        offset.max(0),
    )
}
#[tauri::command]
fn clip_text(state: State<SharedState>, id: i64) -> Result<String, String> {
    db::text(&*state.db.lock().map_err(err)?, id)
}
#[tauri::command]
fn clip_comparison(state: State<SharedState>, id: i64) -> Result<db::Comparison, String> {
    db::comparison(&*state.db.lock().map_err(err)?, id)
}
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    clipboard::write(&text)
}
#[tauri::command]
fn clip_image(state: State<SharedState>, id: i64, thumbnail: bool) -> Result<String, String> {
    media::data_url(
        &*state.db.lock().map_err(err)?,
        &state.media_dir,
        id,
        thumbnail,
    )
}
#[tauri::command]
fn copy_clip(state: State<SharedState>, id: i64) -> Result<(), String> {
    let c = state.db.lock().map_err(err)?;
    let kind: String = c
        .query_row("SELECT kind FROM clips WHERE id=?1", [id], |r| r.get(0))
        .map_err(err)?;
    if kind == "image" {
        clipboard::write_image(&media::read(&c, &state.media_dir, id)?)
    } else {
        clipboard::write(&db::text(&c, id)?)
    }
}
#[tauri::command]
fn update_clip(
    app: tauri::AppHandle,
    state: State<SharedState>,
    id: i64,
    action: String,
) -> Result<(), String> {
    let c = state.db.lock().map_err(err)?;
    match action.as_str() {
        "favorite" => {
            c.execute("UPDATE clips SET favorite=NOT favorite WHERE id=?1", [id])
                .map_err(err)?;
            db::purge(&c, db::settings(&c).limit)?;
        }
        "delete" => {
            c.execute("DELETE FROM clips WHERE id=?1", [id])
                .map_err(err)?;
        }
        "clear" => {
            c.execute("DELETE FROM clips WHERE favorite=0", [])
                .map_err(err)?;
        }
        _ => return Err("Acción inválida".into()),
    }
    media::cleanup(&c, &state.media_dir)?;
    drop(c);
    changed(&app);
    Ok(())
}
#[tauri::command]
fn save_prompt(
    app: tauri::AppHandle,
    state: State<SharedState>,
    prompt: Prompt,
) -> Result<(), String> {
    if prompt.name.trim().is_empty() || !prompt.instructions.contains("{{text}}") {
        return Err("Escribe un nombre e incluye {{text}} en las instrucciones".into());
    }
    let c = state.db.lock().map_err(err)?;
    if prompt.id == 0 {
        c.execute(
            "INSERT INTO prompts(name,instructions,favorite,position) VALUES(?1,?2,?3,?4)",
            params![
                prompt.name,
                prompt.instructions,
                prompt.favorite,
                prompt.position
            ],
        )
        .map_err(err)?;
    } else {
        c.execute(
            "UPDATE prompts SET name=?1,instructions=?2,favorite=?3,position=?4 WHERE id=?5",
            params![
                prompt.name,
                prompt.instructions,
                prompt.favorite,
                prompt.position,
                prompt.id
            ],
        )
        .map_err(err)?;
    }
    drop(c);
    changed(&app);
    Ok(())
}
#[tauri::command]
fn delete_prompt(app: tauri::AppHandle, state: State<SharedState>, id: i64) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(err)?
        .execute("DELETE FROM prompts WHERE id=?1", [id])
        .map_err(err)?;
    changed(&app);
    Ok(())
}
#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    settings: Settings,
    key: Option<String>,
) -> Result<(), String> {
    if !settings.mappings_path.is_empty() {
        mappings::load(&settings.mappings_path)?;
    }
    ai::validate_url(&settings.base_url)?;
    if !(1..=100000).contains(&settings.limit) {
        return Err("El límite debe estar entre 1 y 100000".into());
    }
    let shortcut: tauri_plugin_global_shortcut::Shortcut =
        settings.shortcut.parse().map_err(|_| "Atajo inválido")?;
    let old = { db::settings(&*state.db.lock().map_err(err)?) };
    if old.shortcut != settings.shortcut {
        app.global_shortcut()
            .on_shortcut(shortcut, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    request_widget(app)
                }
            })
            .map_err(|_| "El atajo está ocupado o no se puede registrar")?;
    }
    let result = (|| -> Result<(), String> {
        if let Some(key) = key {
            let entry = ai::credential()?;
            if key.is_empty() {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => (),
                    Err(_) => return Err("No se pudo eliminar la clave".into()),
                }
            } else {
                entry
                    .set_password(&key)
                    .map_err(|_| "No se pudo guardar la clave")?
            }
        }
        if settings.autostart != old.autostart {
            if settings.autostart {
                startup::enable(&app)
            } else {
                app.autolaunch().disable()
            }
            .map_err(err)?;
        }
        let c = state.db.lock().map_err(err)?;
        db::save_settings(&c, &settings)?;
        media::cleanup(&c, &state.media_dir)
    })();
    if result.is_err() {
        if old.shortcut != settings.shortcut {
            let _ = app.global_shortcut().unregister(shortcut);
        }
        return result;
    }
    if old.shortcut != settings.shortcut {
        let _ = app.global_shortcut().unregister(old.shortcut.as_str());
    }
    *state.startup_error.lock().map_err(err)? = None;
    changed(&app);
    Ok(())
}
#[tauri::command]
async fn check_mappings(path: String) -> Result<mappings::Status, String> {
    tauri::async_runtime::spawn_blocking(move || mappings::load(&path).map(|d| d.status()))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn choose_mappings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Diccionario TSV", &["tsv"])
            .blocking_pick_file()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(err)
            })
            .transpose()
    })
    .await
    .map_err(err)?
}
#[derive(Serialize)]
struct MappingApplied {
    id: i64,
    changes: usize,
    message: String,
}
#[tauri::command]
async fn apply_mappings(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    id: i64,
) -> Result<MappingApplied, String> {
    let sequence = clipboard::sequence();
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (input, path) = {
            let c = shared.db.lock().map_err(err)?;
            if shared.updating.load(Ordering::SeqCst) {
                return Err("La actualización está en curso".into());
            }
            let s = db::settings(&c);
            if s.mappings_path.is_empty() {
                return Err(
                    "Configura el archivo TSV en Ajustes → Diccionario de equivalencias".into(),
                );
            }
            (db::text(&c, id)?, s.mappings_path)
        };
        let output = mappings::load(&path)?.apply(&input);
        if output.changes == 0 {
            return Ok(MappingApplied {
                id,
                changes: 0,
                message: "No se encontraron cambios".into(),
            });
        }
        let target = {
            let mut c = shared.db.lock().map_err(err)?;
            if shared.updating.load(Ordering::SeqCst) || db::settings(&c).mappings_path != path {
                return Err(
                    "La configuración cambió durante la operación. Vuelve a intentarlo.".into(),
                );
            }
            mappings::replace_entry(&mut c, id, &input, &output.text)?
        };
        let message = match clipboard::write_if_unchanged(&output.text, Some(sequence)) {
            Ok(true) => format!("{} reemplazos aplicados y texto copiado", output.changes),
            Ok(false) => format!(
                "{} reemplazos guardados; conservamos tu última copia",
                output.changes
            ),
            Err(_) => format!(
                "{} reemplazos guardados; no se pudo copiar al portapapeles",
                output.changes
            ),
        };
        changed(&app);
        Ok(MappingApplied {
            id: target,
            changes: output.changes,
            message,
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn models(base_url: String) -> Result<Vec<String>, String> {
    let v = ai::request(&base_url, "models", None).await?;
    let data = v
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or("Respuesta de modelos inválida")?;
    Ok(data
        .iter()
        .filter_map(|v| v.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect())
}
#[tauri::command]
async fn test_provider(base_url: String, model: String) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("Escribe un modelo para probar la conexión".into());
    }
    ai::complete(&base_url, &model, "Responde únicamente OK. {{text}}", "")
        .await
        .map(|_| "Conexión y generación verificadas".into())
}
#[tauri::command]
fn enqueue(
    app: tauri::AppHandle,
    state: State<SharedState>,
    ids: Vec<i64>,
    prompt_id: i64,
    join: bool,
) -> Result<(), String> {
    if state.updating.load(Ordering::SeqCst) {
        return Err("La actualización está en curso".into());
    }
    if ids.is_empty() {
        return Err("Selecciona al menos un texto".into());
    }
    let mut c = state.db.lock().map_err(err)?;
    let s = db::settings(&c);
    if s.model.trim().is_empty() {
        return Err("Configura el modelo en Ajustes".into());
    }
    let p = db::prompts(&c)?
        .into_iter()
        .find(|p| p.id == prompt_id)
        .ok_or("Prompt inexistente")?;
    let texts: Vec<String> = ids
        .iter()
        .map(|id| db::text(&c, *id))
        .collect::<Result<_, _>>()?;
    let tx = c.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO batches(clipboard_seq,created) VALUES(?1,?2)",
        params![clipboard::sequence(), db::now()],
    )
    .map_err(err)?;
    let batch_id = tx.last_insert_rowid();
    let items: Vec<(String, Vec<i64>)> = if join {
        vec![(texts.join("\n\n"), ids)]
    } else {
        texts
            .into_iter()
            .zip(ids.into_iter().map(|id| vec![id]))
            .collect()
    };
    for (position, (text, source)) in items.into_iter().enumerate() {
        tx.execute("INSERT INTO jobs(input,prompt_name,instructions,base_url,model,source_ids,created,batch_id,position) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![text,p.name,p.instructions,s.base_url,s.model,serde_json::to_string(&source).map_err(err)?,db::now(),batch_id,position as i64]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    drop(c);
    state.wake.notify_one();
    changed(&app);
    Ok(())
}
#[tauri::command]
fn queue_control(app: tauri::AppHandle, state: State<SharedState>, paused: bool) {
    if state.updating.load(Ordering::SeqCst) {
        return;
    }
    state.queue_paused.store(paused, Ordering::SeqCst);
    state.wake.notify_one();
    changed(&app);
}
#[tauri::command]
fn job_action(
    app: tauri::AppHandle,
    state: State<SharedState>,
    id: i64,
    action: String,
) -> Result<(), String> {
    if state.updating.load(Ordering::SeqCst) {
        return Err("La actualización está en curso".into());
    }
    let c = state.db.lock().map_err(err)?;
    match action.as_str() {
        "cancel" => {
            let status: String = c
                .query_row("SELECT status FROM jobs WHERE id=?1", [id], |r| r.get(0))
                .map_err(err)?;
            c.execute("UPDATE jobs SET status='cancelled',error=NULL WHERE id=?1 AND status IN ('pending','running')",[id]).map_err(err)?;
            if status == "running" {
                state.cancel.send_replace(id);
            }
        }
        "retry" => {
            let status: String = c
                .query_row("SELECT status FROM jobs WHERE id=?1", [id], |r| r.get(0))
                .map_err(err)?;
            if !["failed", "cancelled"].contains(&status.as_str()) {
                return Err("Este trabajo no necesita reintento".into());
            }
            c.execute(
                "INSERT INTO batches(clipboard_seq,created) VALUES(?1,?2)",
                params![clipboard::sequence(), db::now()],
            )
            .map_err(err)?;
            c.execute("UPDATE jobs SET status='pending',error=NULL,output=NULL,batch_id=?2,position=0 WHERE id=?1",params![id,c.last_insert_rowid()]).map_err(err)?;
            state.wake.notify_one();
        }
        _ => return Err("Acción inválida".into()),
    }
    drop(c);
    delivery::finish(&app, &state);
    changed(&app);
    Ok(())
}
#[tauri::command]
async fn open_manager(app: tauri::AppHandle) -> Result<(), String> {
    show_manager(app)
}
fn show_manager(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.destroy();
    }
    let w = ensure_window(&app, "manager")?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)
}
#[tauri::command]
fn hide_widget(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.destroy();
    }
}
#[tauri::command]
async fn toggle_widget(app: tauri::AppHandle) -> Result<(), String> {
    show_widget(&app)
}
#[tauri::command]
fn widget_ready(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.set_focus();
            WIDGET_FOCUSED.store(true, Ordering::SeqCst);
            WIDGET_READY.store(true, Ordering::SeqCst);
        }
    }
}
#[tauri::command]
fn close_manager(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("manager") {
        let _ = w.destroy();
    }
}

async fn worker(app: tauri::AppHandle, state: SharedState) {
    loop {
        state.wake.notified().await;
        loop {
            if state.queue_paused.load(Ordering::SeqCst) || state.updating.load(Ordering::SeqCst) {
                break;
            }
            let next = {
                let c = state.db.lock().unwrap();
                if state.updating.load(Ordering::SeqCst)
                    || state.queue_paused.load(Ordering::SeqCst)
                {
                    break;
                }
                let row=c.query_row("SELECT id,input,instructions,base_url,model FROM jobs WHERE status='pending' ORDER BY id LIMIT 1",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).ok();
                if let Some(ref row) = row {
                    // Clear the previous job's signal while holding the claim lock;
                    // cancelling this job can only happen after it becomes running.
                    state.cancel.send_replace(0);
                    let _ = c.execute("UPDATE jobs SET status='running' WHERE id=?1", [row.0]);
                }
                row
            };
            let Some((id, input, instructions, base, model)) = next else {
                break;
            };
            changed(&app);
            let mut cancelled = state.cancel.subscribe();
            let result = tokio::select! {r=ai::complete(&base,&model,&instructions,&input)=>Some(r),_=async {loop {if *cancelled.borrow_and_update()==id {break} if cancelled.changed().await.is_err(){break}}}=>None};
            {
                let c = state.db.lock().unwrap();
                match result {
                    Some(Ok(output)) => {
                        let _ = c.execute_batch("SAVEPOINT complete_job");
                        let saved=c.execute("UPDATE jobs SET status='completed',output=?1,error=NULL WHERE id=?2 AND status='running'",params![output,id]);
                        if matches!(saved, Ok(1)) {
                            if db::result(&c, id, &output).is_ok() {
                                if c.execute_batch("RELEASE complete_job").is_ok() {
                                    let _ = media::cleanup(&c, &state.media_dir);
                                }
                            } else {
                                let _ = c.execute_batch(
                                    "ROLLBACK TO complete_job; RELEASE complete_job",
                                );
                                let _=c.execute("UPDATE jobs SET status='failed',error='No se pudo guardar el resultado' WHERE id=?1",[id]);
                            }
                        } else {
                            let _ = c.execute_batch("RELEASE complete_job");
                        }
                    }
                    Some(Err(error)) => {
                        let _=c.execute("UPDATE jobs SET status='failed',error=?1 WHERE id=?2 AND status='running'",params![error,id]);
                    }
                    None => {
                        let _ = c.execute(
                            "UPDATE jobs SET status='cancelled' WHERE id=?1 AND status='running'",
                            [id],
                        );
                    }
                }
            }
            delivery::finish(&app, &state);
            changed(&app);
        }
    }
}
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let dir = args
        .iter()
        .position(|s| s == "--data-dir")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from)
        .unwrap_or(app.path().app_data_dir()?);
    std::fs::create_dir_all(&dir)?;
    let c = Connection::open(dir.join("clipia.sqlite3"))?;
    db::backup_before_migration(&c, &dir.join("clipia.sqlite3"))?;
    db::init(&c)?;
    c.execute(
        "UPDATE batches SET clipboard_seq=NULL WHERE delivered=0",
        [],
    )?;
    media::cleanup(&c, &dir.join("media"))?;
    let settings = db::settings(&c);
    let pending: i64 = c.query_row(
        "SELECT count(*) FROM jobs WHERE status='pending'",
        [],
        |r| r.get(0),
    )?;
    let state = Arc::new(Shared {
        db: Mutex::new(c),
        queue_paused: AtomicBool::new(pending > 0),
        wake: tokio::sync::Notify::new(),
        cancel: tokio::sync::watch::channel(0).0,
        startup_error: Mutex::new(None),
        media_dir: dir.join("media"),
        updating: AtomicBool::new(false),
    });
    app.manage(state.clone());
    if app
        .global_shortcut()
        .on_shortcut(settings.shortcut.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                request_widget(app);
            }
        })
        .is_err()
    {
        *state.startup_error.lock().unwrap() = Some("No se pudo registrar el atajo. Cámbialo en Ajustes; puedes abrir Clipboard Manager desde la bandeja.".into());
    }
    if !args.iter().any(|s| s == "--no-capture") {
        let handle = app.handle().clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(32);
        clipboard::listen(move |capture| {
            let _ = tx.try_send(capture);
        });
        std::thread::spawn(move || {
            for capture in rx {
                let state = handle.state::<SharedState>();
                if let Ok(c) = state.db.lock() {
                    let result = match capture {
                        clipboard::Capture::Text(text) => db::capture(&c, &text)
                            .and_then(|_| media::cleanup(&c, &state.media_dir)),
                        clipboard::Capture::Image(bytes) => {
                            media::store(&c, &state.media_dir, &bytes)
                        }
                    };
                    if result.is_ok() {
                        drop(c);
                        changed(&handle);
                    }
                };
            }
        });
    }
    let menu = tauri::menu::Menu::with_items(
        app,
        &[
            &tauri::menu::MenuItem::with_id(app, "widget", "Portapapeles", true, None::<&str>)?,
            &tauri::menu::MenuItem::with_id(
                app,
                "manager",
                "Administrar Clipboard Manager",
                true,
                None::<&str>,
            )?,
            &tauri::menu::MenuItem::with_id(
                app,
                "pause",
                "Pausar / reanudar captura",
                true,
                None::<&str>,
            )?,
            &tauri::menu::MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?,
        ],
    )?;
    let icon =
        tauri::image::Image::new_owned(include_bytes!("../icons/tray.rgba").to_vec(), 32, 32);
    tauri::tray::TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Clipboard Manager · Portapapeles con IA")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "widget" => request_widget(app),
            "manager" => request_manager(app),
            "pause" => {
                let state = app.state::<SharedState>();
                let c = state.db.lock().unwrap();
                let mut s = db::settings(&c);
                s.paused = !s.paused;
                let _ = db::save_settings(&c, &s);
                drop(c);
                changed(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    tauri::async_runtime::spawn(worker(app.handle().clone(), state));
    if !args.iter().any(|s| s == "--background") {
        show_manager(app.handle().clone())?;
    }
    Ok(())
}
fn main() {
    let mut context = tauri::generate_context!();
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--no-capture") {
        if let Some(dir) = args
            .iter()
            .position(|a| a == "--data-dir")
            .and_then(|i| args.get(i + 1))
        {
            use sha2::Digest;
            let hash = format!("{:x}", sha2::Sha256::digest(dir.as_bytes()));
            context.config_mut().identifier = format!("local.clipia.verification.{}", &hash[..12]);
            ai::ISOLATED.store(true, Ordering::SeqCst);
        }
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            request_manager(app)
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Clipboard Manager")
                .args(["--background"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            snapshot,
            list_clips,
            clip_text,
            clip_comparison,
            copy_text,
            copy_clip,
            clip_image,
            updates::check_update,
            updates::install_update,
            update_clip,
            save_prompt,
            delete_prompt,
            save_settings,
            check_mappings,
            choose_mappings,
            apply_mappings,
            models,
            test_provider,
            enqueue,
            queue_control,
            job_action,
            open_manager,
            hide_widget,
            toggle_widget,
            widget_ready,
            close_manager
        ])
        .setup(setup)
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.destroy();
            }
            tauri::WindowEvent::Focused(true) if window.label() == "widget" => {
                WIDGET_FOCUSED.store(true, Ordering::SeqCst);
            }
            tauri::WindowEvent::Focused(false) if window.label() == "widget" => {
                if WIDGET_READY.load(Ordering::SeqCst)
                    && WIDGET_FOCUSED.swap(false, Ordering::SeqCst)
                {
                    let _ = window.destroy();
                }
            }
            _ => {}
        })
        .build(context)
        .expect("No se pudo iniciar Clipboard Manager");
    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}
