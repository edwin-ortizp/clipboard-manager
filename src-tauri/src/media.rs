use crate::db::{self, err};
use base64::Engine;
use image::{DynamicImage, ImageFormat};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
};

pub fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, ImageFormat::Png).map_err(err)?;
    Ok(out.into_inner())
}
pub fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(err)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "Imagen inválida o demasiado grande (máximo 256 MB al decodificar)".into())
}
fn file(dir: &Path, hash: &str, thumb: bool) -> PathBuf {
    dir.join(format!("{hash}{}.png", if thumb { ".thumb" } else { "" }))
}
pub fn store(c: &Connection, dir: &Path, bytes: &[u8]) -> Result<(), String> {
    if db::settings(c).paused {
        return Ok(());
    }
    let image = decode(bytes)?;
    let bytes = png(&image)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    std::fs::create_dir_all(dir).map_err(err)?;
    for (thumb, data) in [(false, bytes), (true, png(&image.thumbnail(320, 200))?)] {
        let path = file(dir, &hash, thumb);
        if !path.exists() {
            let temp = path.with_extension("tmp");
            std::fs::write(&temp, data).map_err(err)?;
            std::fs::rename(temp, path).map_err(err)?;
        }
    }
    c.execute("INSERT INTO clips(text,created,kind,width,height) VALUES(?1,?2,'image',?3,?4) ON CONFLICT(kind,text) DO UPDATE SET created=excluded.created",params![format!("image:{hash}"),db::now(),image.width(),image.height()]).map_err(err)?;
    db::purge(c, db::settings(c).limit)?;
    cleanup(c, dir)
}
pub fn data_url(c: &Connection, dir: &Path, id: i64, thumb: bool) -> Result<String, String> {
    let hash = db::image_hash(c, id)?;
    let data = std::fs::read(file(dir, &hash, thumb))
        .map_err(|_| "No se encuentra el archivo de imagen".to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    ))
}
pub fn read(c: &Connection, dir: &Path, id: i64) -> Result<Vec<u8>, String> {
    let hash = db::image_hash(c, id)?;
    std::fs::read(file(dir, &hash, false)).map_err(err)
}
pub fn cleanup(c: &Connection, dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut stmt = c
        .prepare("SELECT text FROM clips WHERE kind='image'")
        .map_err(err)?;
    let hashes: std::collections::HashSet<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .filter_map(Result::ok)
        .filter_map(|s| s.strip_prefix("image:").map(str::to_string))
        .collect();
    for entry in std::fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let hash = name.split('.').next().unwrap_or("");
        if hash.len() == 64
            && hash.bytes().all(|b| b.is_ascii_hexdigit())
            && !hashes.contains(hash)
            && entry.file_type().map_err(err)?.is_file()
        {
            std::fs::remove_file(entry.path()).map_err(err)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_lifecycle_and_transparency() {
        let c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        let dir = std::env::temp_dir().join(format!(
            "clipia-image-test-{}-{}",
            std::process::id(),
            db::now()
        ));
        let mut rgba = image::RgbaImage::new(3, 2);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 100]));
        let bytes = png(&DynamicImage::ImageRgba8(rgba.clone())).unwrap();
        store(&c, &dir, &bytes).unwrap();
        store(&c, &dir, &bytes).unwrap();
        let rows = db::clips(&c, "", false, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "image");
        assert_eq!(rows[0].width, Some(3));
        assert_eq!(
            decode(&read(&c, &dir, rows[0].id).unwrap())
                .unwrap()
                .to_rgba8(),
            rgba
        );
        assert!(db::text(&c, rows[0].id).is_err());
        assert!(data_url(&c, &dir, rows[0].id, true)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        c.execute("UPDATE clips SET favorite=1", []).unwrap();
        db::purge(&c, 0).unwrap();
        cleanup(&c, &dir).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        c.execute("DELETE FROM clips", []).unwrap();
        cleanup(&c, &dir).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn rejects_invalid_image() {
        assert!(decode(b"not an image").is_err());
    }
}
