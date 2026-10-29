use crate::{changed, clipboard, db, SharedState};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
pub fn finish(app: &tauri::AppHandle, state: &SharedState) {
    loop {
        let next = {
            let c = state.db.lock().unwrap();
            let row=c.query_row("SELECT b.id,b.clipboard_seq FROM batches b WHERE b.delivered=0 AND EXISTS(SELECT 1 FROM jobs WHERE batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM jobs WHERE batch_id=b.id AND status IN ('pending','running')) ORDER BY b.id LIMIT 1",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<u32>>(1)?))).ok();
            row.and_then(|(id,seq)|{if c.execute("UPDATE batches SET delivered=1 WHERE id=?1 AND delivered=0",[id]).ok()?!=1{return None}
                let completed:i64=c.query_row("SELECT count(*) FROM jobs WHERE batch_id=?1 AND status='completed'",[id],|r|r.get(0)).ok()?;
                let failed:i64=c.query_row("SELECT count(*) FROM jobs WHERE batch_id=?1 AND status='failed'",[id],|r|r.get(0)).ok()?;
                let cancelled:i64=c.query_row("SELECT count(*) FROM jobs WHERE batch_id=?1 AND status='cancelled'",[id],|r|r.get(0)).ok()?;
                let output:Option<String>=c.query_row("SELECT output FROM jobs WHERE batch_id=?1 AND status='completed' ORDER BY position DESC,id DESC LIMIT 1",[id],|r|r.get(0)).ok();
                Some((id,seq,completed,failed,cancelled,output,db::settings(&c)))
            })
        };
        let Some((id, seq, completed, failed, cancelled, output, settings)) = next else {
            break;
        };
        let detail = if let Some(output) = output {
            if !settings.auto_copy {
                "Resultados listos en el historial".to_string()
            } else if let Some(seq) = seq {
                match clipboard::write_if_unchanged(&output, Some(seq)) {
                    Ok(true) => "Resultado copiado al portapapeles".into(),
                    Ok(false) => {
                        "Resultado listo en el historial; conservamos tu última copia".into()
                    }
                    Err(_) => {
                        "Resultado listo en el historial; no se pudo copiar al portapapeles".into()
                    }
                }
            } else {
                "Resultado listo en el historial; conservamos tu última copia".into()
            }
        } else {
            "No se generaron resultados nuevos".into()
        };
        let summary = format!(
            "{detail}. {completed} completados · {failed} fallidos · {cancelled} cancelados"
        );
        if let Ok(c) = state.db.lock() {
            let _ = c.execute(
                "UPDATE batches SET message=?1 WHERE id=?2",
                rusqlite::params![summary, id],
            );
        }
        let _ = app.emit("delivery", &summary);
        let visible = ["manager", "widget"].iter().any(|label| {
            app.get_webview_window(label)
                .is_some_and(|w| w.is_focused().unwrap_or(false))
        });
        if settings.notifications && !visible {
            let _ = app
                .notification()
                .builder()
                .title("Clipia · IA terminada")
                .body(&summary)
                .show();
        }
        changed(app);
    }
}
