use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub base_url: String,
    pub model: String,
    pub limit: i64,
    pub shortcut: String,
    pub paused: bool,
    pub autostart: bool,
    pub auto_copy: bool,
    pub notifications: bool,
    pub mappings_path: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: String::new(),
            limit: 1000,
            shortcut: "Ctrl+Alt+V".into(),
            paused: false,
            autostart: false,
            auto_copy: true,
            notifications: true,
            mappings_path: String::new(),
        }
    }
}
#[derive(Serialize)]
pub struct Clip {
    pub id: i64,
    pub text: String,
    pub favorite: bool,
    pub created: i64,
    pub kind: String,
    pub origin: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: i64,
    pub name: String,
    pub instructions: String,
    pub favorite: bool,
    pub position: i64,
}
#[derive(Serialize)]
pub struct Job {
    pub id: i64,
    pub input: String,
    pub prompt_name: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub created: i64,
}
#[derive(Serialize)]
pub struct Comparison {
    pub original: Option<String>,
    pub result: String,
    pub prompt_name: Option<String>,
}
pub fn comparison(c: &Connection, id: i64) -> Result<Comparison, String> {
    c.query_row("SELECT j.input,c.text,j.prompt_name FROM clips c LEFT JOIN jobs j ON j.id=c.job_id WHERE c.id=?1 AND c.kind='text' AND c.origin='ai'",[id],|r|Ok(Comparison{original:r.get(0)?,result:r.get(1)?,prompt_name:r.get(2)?})).map_err(err)
}
pub fn init(c: &Connection) -> Result<(), String> {
    c.create_scalar_function(
        "unicode_lower",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC
            | rusqlite::functions::FunctionFlags::SQLITE_UTF8,
        |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
    )
    .map_err(err)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS clips(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS prompts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, instructions TEXT NOT NULL, favorite INTEGER NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, input TEXT NOT NULL, prompt_name TEXT NOT NULL, instructions TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, source_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', output TEXT, error TEXT, created INTEGER NOT NULL);
    UPDATE jobs SET status='failed', error='Interrumpido al cerrar la aplicación. Puedes reintentarlo.' WHERE status='running';").map_err(err)?;
    migrate(c)?;
    let count: i64 = c
        .query_row("SELECT count(*) FROM settings", [], |r| r.get(0))
        .map_err(err)?;
    if count == 0 {
        for (i, (name, instructions)) in [
            (
                "Corregir escritura",
                "Corrige ortografía y gramática conservando el significado y el estilo.",
            ),
            (
                "Acortar",
                "Acorta el texto conservando las ideas esenciales.",
            ),
            (
                "Aclarar",
                "Reescribe el texto para que sea claro y fácil de entender.",
            ),
            (
                "Tono profesional",
                "Reescribe el texto con un tono profesional y natural.",
            ),
        ]
        .iter()
        .enumerate()
        {
            c.execute(
                "INSERT INTO prompts(name,instructions,favorite,position) VALUES(?1,?2,1,?3)",
                params![
                    name,
                    format!(
                        "{instructions}\nDevuelve únicamente el texto resultante.\n\n{{{{text}}}}"
                    ),
                    i as i64
                ],
            )
            .map_err(err)?;
        }
    }
    c.execute(
        "INSERT OR IGNORE INTO settings VALUES(1,?1)",
        [serde_json::to_string(&Settings::default()).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn migrate(c: &Connection) -> Result<(), String> {
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version >= 2 {
        return Ok(());
    }
    c.execute_batch("BEGIN IMMEDIATE;
      CREATE TABLE clips_v2(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'text', origin TEXT NOT NULL DEFAULT 'clipboard', width INTEGER, height INTEGER, job_id INTEGER, UNIQUE(kind,text));
      INSERT INTO clips_v2(id,text,favorite,created) SELECT id,text,favorite,created FROM clips;
      DROP TABLE clips;
      ALTER TABLE clips_v2 RENAME TO clips;
      CREATE TABLE batches(id INTEGER PRIMARY KEY AUTOINCREMENT, clipboard_seq INTEGER, delivered INTEGER NOT NULL DEFAULT 0, message TEXT, created INTEGER NOT NULL);
      ALTER TABLE jobs ADD COLUMN batch_id INTEGER REFERENCES batches(id);
      ALTER TABLE jobs ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX jobs_batch ON jobs(batch_id);
      PRAGMA user_version=2;
      COMMIT;").map_err(|e|{let _=c.execute_batch("ROLLBACK");err(e)})?;
    Ok(())
}
pub fn backup_before_migration(c: &Connection, path: &std::path::Path) -> Result<(), String> {
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='clips')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if exists && version < 2 {
        let backup = path.with_file_name(format!("clipia-before-v2-{}.sqlite3", now()));
        c.backup("main", &backup, None).map_err(err)?;
    }
    Ok(())
}
pub fn result(c: &Connection, job_id: i64, output: &str) -> Result<(), String> {
    if output.trim().is_empty() {
        return Err("Resultado vacío".into());
    }
    c.execute("INSERT INTO clips(text,created,origin,job_id) VALUES(?1,?2,'ai',?3) ON CONFLICT(kind,text) DO UPDATE SET created=excluded.created,origin='ai',job_id=excluded.job_id",params![output,now(),job_id]).map_err(err)?;
    purge(c, settings(c).limit)
}
pub fn image_hash(c: &Connection, id: i64) -> Result<String, String> {
    let text: String = c
        .query_row(
            "SELECT text FROM clips WHERE id=?1 AND kind='image'",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let hash = text.strip_prefix("image:").ok_or("Imagen inválida")?;
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Imagen inválida".into());
    }
    Ok(hash.into())
}
pub fn settings(c: &Connection) -> Settings {
    c.query_row("SELECT value FROM settings WHERE id=1", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}
pub fn save_settings(c: &Connection, s: &Settings) -> Result<(), String> {
    c.execute(
        "INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        [serde_json::to_string(s).map_err(err)?],
    )
    .map_err(err)?;
    purge(c, s.limit)
}
pub fn purge(c: &Connection, limit: i64) -> Result<(), String> {
    c.execute("DELETE FROM clips WHERE favorite=0 AND id NOT IN (SELECT id FROM clips WHERE favorite=0 ORDER BY created DESC,id DESC LIMIT ?1)",[limit]).map_err(err)?;
    Ok(())
}
pub fn capture(c: &Connection, text: &str) -> Result<(), String> {
    let s = settings(c);
    if s.paused || text.trim().is_empty() {
        return Ok(());
    }
    c.execute("INSERT INTO clips(text,created) VALUES(?1,?2) ON CONFLICT(kind,text) DO UPDATE SET created=excluded.created",params![text,now()]).map_err(err)?;
    purge(c, s.limit)
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn clips(
    c: &Connection,
    query: &str,
    favorite: bool,
    offset: i64,
) -> Result<Vec<Clip>, String> {
    let mut q=c.prepare("SELECT id,CASE WHEN kind='image' THEN '' ELSE substr(text,1,400) END,favorite,created,kind,origin,width,height FROM clips WHERE (?1=0 OR favorite=1) AND instr(unicode_lower(CASE WHEN kind='image' THEN 'Imagen' ELSE text END),unicode_lower(?2))>0 ORDER BY created DESC,id DESC LIMIT 50 OFFSET ?3").map_err(err)?;
    let rows = q
        .query_map(params![favorite, query, offset], |r| {
            Ok(Clip {
                id: r.get(0)?,
                text: r.get(1)?,
                favorite: r.get(2)?,
                created: r.get(3)?,
                kind: r.get(4)?,
                origin: r.get(5)?,
                width: r.get(6)?,
                height: r.get(7)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}
pub fn text(c: &Connection, id: i64) -> Result<String, String> {
    c.query_row(
        "SELECT text FROM clips WHERE id=?1 AND kind='text'",
        [id],
        |r| r.get(0),
    )
    .map_err(err)
}
pub fn prompts(c: &Connection) -> Result<Vec<Prompt>, String> {
    let mut q = c
        .prepare("SELECT id,name,instructions,favorite,position FROM prompts ORDER BY position,id")
        .map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok(Prompt {
                id: r.get(0)?,
                name: r.get(1)?,
                instructions: r.get(2)?,
                favorite: r.get(3)?,
                position: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}
pub fn jobs(c: &Connection) -> Result<Vec<Job>, String> {
    let mut q=c.prepare("SELECT id,input,prompt_name,status,output,error,created FROM jobs ORDER BY id DESC LIMIT 200").map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok(Job {
                id: r.get(0)?,
                input: r.get(1)?,
                prompt_name: r.get(2)?,
                status: r.get(3)?,
                output: r.get(4)?,
                error: r.get(5)?,
                created: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn comparison_keeps_full_original_beyond_recent_jobs() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let original = "Original 🦀\n".repeat(100);
        c.execute("INSERT INTO jobs(input,prompt_name,instructions,base_url,model,source_ids,status,output,created) VALUES(?1,'Corregir','{{text}}','http://localhost','m','[]','completed','Corregido',0)",[&original]).unwrap();
        let job = c.last_insert_rowid();
        result(&c, job, "Corregido").unwrap();
        let clip = clips(&c, "Corregido", false, 0).unwrap()[0].id;
        for _ in 0..201 {
            c.execute("INSERT INTO jobs(input,prompt_name,instructions,base_url,model,source_ids,status,created) VALUES('x','p','{{text}}','http://localhost','m','[]','failed',0)",[]).unwrap();
        }
        assert!(!jobs(&c).unwrap().iter().any(|j| j.id == job));
        let comparison = comparison(&c, clip).unwrap();
        assert_eq!(comparison.original.as_deref(), Some(original.as_str()));
        assert_eq!(comparison.result, "Corregido");
        assert_eq!(comparison.prompt_name.as_deref(), Some("Corregir"));
    }
    #[test]
    fn migration_preserves_legacy_data_and_settings() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY AUTOINCREMENT,text TEXT NOT NULL UNIQUE,favorite INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO clips VALUES(42,'Árbol legado',1,1234);").unwrap();
        c.execute("INSERT INTO settings VALUES(1,?1)",[r#"{"base_url":"http://localhost:9999/v1","model":"custom","limit":321,"shortcut":"Ctrl+Alt+F12","paused":true,"autostart":false}"#]).unwrap();
        init(&c).unwrap();
        let s = settings(&c);
        assert_eq!(s.model, "custom");
        assert_eq!(s.limit, 321);
        assert!(s.auto_copy && s.notifications && s.paused);
        let clip = &clips(&c, "", false, 0).unwrap()[0];
        assert_eq!(clip.id, 42);
        assert_eq!(clip.created, 1234);
        assert!(clip.favorite);
        assert_eq!(clip.kind, "text");
        assert_eq!(text(&c, 42).unwrap(), "Árbol legado");
        init(&c).unwrap();
        assert_eq!(clips(&c, "", false, 0).unwrap().len(), 1);
    }
    #[test]
    fn ai_result_is_saved_when_capture_paused() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let mut s = Settings::default();
        s.paused = true;
        save_settings(&c, &s).unwrap();
        result(&c, 7, "Resultado 🦀").unwrap();
        let rows = clips(&c, "", false, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].origin, "ai");
        result(&c, 8, "Resultado 🦀").unwrap();
        assert_eq!(clips(&c, "", false, 0).unwrap().len(), 1);
    }
    #[test]
    fn unicode_dedup_retention_and_favorites() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let mut s = Settings::default();
        s.limit = 1;
        save_settings(&c, &s).unwrap();
        capture(&c, "Árbol 🦀").unwrap();
        capture(&c, "Árbol 🦀").unwrap();
        assert_eq!(clips(&c, "", false, 0).unwrap().len(), 1);
        c.execute("UPDATE clips SET favorite=1", []).unwrap();
        capture(&c, "dos").unwrap();
        capture(&c, "tres").unwrap();
        assert_eq!(clips(&c, "", false, 0).unwrap().len(), 2);
        assert_eq!(clips(&c, "", true, 0).unwrap()[0].text, "Árbol 🦀");
        s.paused = true;
        save_settings(&c, &s).unwrap();
        capture(&c, "ignorado").unwrap();
        assert!(clips(&c, "ignorado", false, 0).unwrap().is_empty());
    }
    #[test]
    fn restart_requires_retry() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        c.execute("INSERT INTO jobs(input,prompt_name,instructions,base_url,model,source_ids,status,created) VALUES('x','p','{{text}}','http://localhost','m','[]','running',0)",[]).unwrap();
        init(&c).unwrap();
        assert_eq!(jobs(&c).unwrap()[0].status, "failed");
    }
    #[test]
    fn full_text_pagination_and_non_reused_ids() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let original = "Árbol 🦀\n".repeat(100);
        capture(&c, &original).unwrap();
        let id = clips(&c, "árbol", false, 0).unwrap()[0].id;
        assert_eq!(text(&c, id).unwrap(), original);
        assert_eq!(
            clips(&c, "árbol", false, 0).unwrap()[0]
                .text
                .chars()
                .count(),
            400
        );
        c.execute("DELETE FROM clips WHERE id=?1", [id]).unwrap();
        for i in 0..51 {
            capture(&c, &format!("Entrada {i}")).unwrap();
        }
        assert_eq!(clips(&c, "", false, 0).unwrap().len(), 50);
        assert_eq!(clips(&c, "", false, 50).unwrap().len(), 1);
        assert!(clips(&c, "", false, 0)
            .unwrap()
            .iter()
            .all(|row| row.id > id));
    }
    #[test]
    fn deleted_prompts_do_not_return_on_restart() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        assert_eq!(prompts(&c).unwrap().len(), 4);
        c.execute("DELETE FROM prompts", []).unwrap();
        init(&c).unwrap();
        assert!(prompts(&c).unwrap().is_empty());
    }
}
