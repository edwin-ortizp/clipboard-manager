use crate::db::{self, err};
use regex::{Regex, RegexBuilder};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;

pub struct Rule {
    from: String,
    to: String,
    word: bool,
    line: usize,
    pattern: Regex,
    canonical: Option<Regex>,
}
pub struct Dictionary {
    rules: Vec<Rule>,
}
#[derive(Serialize)]
pub struct Status {
    pub rules: usize,
}
pub struct Replacement {
    pub text: String,
    pub changes: usize,
}
fn pattern(value: &str, nocase: bool) -> Result<Regex, String> {
    RegexBuilder::new(&regex::escape(value))
        .case_insensitive(nocase)
        .build()
        .map_err(err)
}
fn word_char(c: char) -> bool {
    static WORD: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    WORD.get_or_init(|| Regex::new(r"^\w$").unwrap())
        .is_match(c.encode_utf8(&mut [0; 4]))
}
fn bounded(text: &str, start: usize, end: usize) -> bool {
    !text[..start].chars().next_back().is_some_and(word_char)
        && !text[end..].chars().next().is_some_and(word_char)
}
pub fn parse(text: &str) -> Result<Dictionary, String> {
    let mut rules: Vec<Rule> = Vec::new();
    for (i, line) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let cols: Vec<_> = line.split('\t').collect();
        let fail = |reason: &str| format!("Línea {}: {reason}", i + 1);
        if cols.len() != 4 {
            return Err(fail(
                "se requieren cuatro columnas separadas por tabuladores",
            ));
        }
        let [from, to, mode, case] = [cols[0], cols[1], cols[2], cols[3]];
        if from.trim().is_empty() || to.trim().is_empty() {
            return Err(fail("origen y reemplazo no pueden estar vacíos"));
        }
        if !["word", "any"].contains(&mode) || !["case", "nocase"].contains(&case) {
            return Err(fail("usa word|any y case|nocase"));
        }
        let compiled = pattern(from, case == "nocase")?;
        for previous in &rules {
            if previous.from == from
                || (compiled
                    .find(&previous.from)
                    .is_some_and(|m| m.start() == 0 && m.end() == previous.from.len()))
                || previous
                    .pattern
                    .find(from)
                    .is_some_and(|m| m.start() == 0 && m.end() == from.len())
            {
                return Err(fail(&format!(
                    "origen duplicado o incompatible con la línea {}",
                    previous.line
                )));
            }
        }
        let word = mode == "word";
        let canonical = if compiled
            .find_iter(to)
            .any(|m| m.len() < to.len() && (!word || bounded(to, m.start(), m.end())))
        {
            Some(pattern(to, case == "nocase")?)
        } else {
            None
        };
        rules.push(Rule {
            from: from.into(),
            to: to.into(),
            word,
            line: i + 1,
            pattern: compiled,
            canonical,
        });
    }
    if rules.is_empty() {
        return Err("El archivo no contiene equivalencias".into());
    }
    Ok(Dictionary { rules })
}
pub fn load(path: &str) -> Result<Dictionary, String> {
    let p = Path::new(path);
    if !p.is_absolute() || !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("tsv")) {
        return Err("Selecciona la ruta absoluta de un archivo .tsv".into());
    }
    let bytes = std::fs::read(p).map_err(|_| {
        "No se pudo leer el diccionario TSV. Comprueba la ruta y sus permisos.".to_string()
    })?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "El diccionario debe estar codificado en UTF-8".to_string())?;
    parse(text)
}
impl Dictionary {
    pub fn status(&self) -> Status {
        Status {
            rules: self.rules.len(),
        }
    }
    pub fn apply(&self, text: &str) -> Replacement {
        let mut matches = Vec::new();
        for (index, rule) in self.rules.iter().enumerate() {
            let protected: Vec<_> = rule
                .canonical
                .as_ref()
                .map(|p| {
                    p.find_iter(text)
                        .filter(|m| !rule.word || bounded(text, m.start(), m.end()))
                        .map(|m| (m.start(), m.end()))
                        .collect()
                })
                .unwrap_or_default();
            for m in rule.pattern.find_iter(text) {
                if rule.word && !bounded(text, m.start(), m.end()) {
                    continue;
                }
                if protected
                    .iter()
                    .any(|&(a, b)| a <= m.start() && b >= m.end() && b - a > m.len())
                {
                    continue;
                }
                matches.push((m.start(), m.end(), index));
            }
        }
        matches.sort_by(|a, b| {
            (b.1 - b.0)
                .cmp(&(a.1 - a.0))
                .then_with(|| a.0.cmp(&b.0))
                .then(a.2.cmp(&b.2))
        });
        let mut selected: std::collections::BTreeMap<usize, (usize, usize)> =
            std::collections::BTreeMap::new();
        for (start, end, index) in matches {
            if selected
                .range(..=start)
                .next_back()
                .is_some_and(|(_, v)| v.0 > start)
                || selected
                    .range(start..)
                    .next()
                    .is_some_and(|(s, _)| *s < end)
            {
                continue;
            }
            selected.insert(start, (end, index));
        }
        let mut result = String::with_capacity(text.len());
        let mut cursor = 0;
        let mut changes = 0;
        for (start, (end, index)) in selected {
            result.push_str(&text[cursor..start]);
            let to = &self.rules[index].to;
            result.push_str(to);
            if &text[start..end] != to {
                changes += 1
            }
            cursor = end;
        }
        result.push_str(&text[cursor..]);
        Replacement {
            text: result,
            changes,
        }
    }
}
pub fn replace_entry(
    c: &mut Connection,
    id: i64,
    expected: &str,
    result: &str,
) -> Result<i64, String> {
    let tx = c.transaction().map_err(err)?;
    let (current, favorite): (String, bool) = tx
        .query_row(
            "SELECT text,favorite FROM clips WHERE id=?1 AND kind='text'",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    if current != expected {
        return Err("La entrada cambió durante la operación. Vuelve a intentarlo.".into());
    }
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM clips WHERE kind='text' AND text=?1",
            [result],
            |r| r.get(0),
        )
        .ok();
    let target = existing.unwrap_or(id);
    if target != id {
        tx.execute("UPDATE clips SET favorite=(favorite OR ?1),origin='dictionary',job_id=NULL,created=?2 WHERE id=?3",params![favorite,db::now(),target]).map_err(err)?;
        tx.execute("DELETE FROM clips WHERE id=?1", [id])
            .map_err(err)?;
    } else {
        tx.execute(
            "UPDATE clips SET text=?1,origin='dictionary',job_id=NULL,created=?2 WHERE id=?3",
            params![result, db::now(), id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn longest_crossing_phrase_wins() {
        let d = parse("a b\tX\tword\tcase\nb c d\tY\tword\tcase").unwrap();
        assert_eq!(d.apply("a b c d").text, "a Y");
    }
    #[test]
    fn parser_comments_bom_and_modes() {
        let d=parse("\u{feff}# from\tto\tword|any\tcase|nocase\n\nKevin\tKewin\tword\tnocase\nAPI\tinterfaz\tword\tcase\n").unwrap();
        assert_eq!(d.status().rules, 2);
        assert_eq!(
            d.apply("kevin KEVIN Kevinista API api").text,
            "Kewin Kewin Kevinista interfaz api"
        );
    }
    #[test]
    fn literal_unicode_boundaries_and_accents() {
        let d = parse(
            "analisis\tanálisis\tword\tnocase\nárbol\tÁRBOL\tword\tnocase\na.b\tliteral\tany\tcase",
        )
        .unwrap();
        assert_eq!(
            d.apply("ANALISIS análisis árbol árbolito arbol a.b axb")
                .text,
            "análisis análisis ÁRBOL árbolito arbol literal axb"
        );
        assert_eq!(d.apply("analisis\u{301}").changes, 0);
    }
    #[test]
    fn longest_single_pass_and_canonical() {
        let d=parse("COVID\tCOVID-19\tword\tnocase\nCOVID-19\tCOVID-19\tword\tnocase\nYa hice pool\tYa hice pull\tword\tnocase\npool\tpull\tword\tnocase\npull\tgit pull\tword\tnocase\ngitignore\t.gitignore\tword\tnocase").unwrap();
        let r = d.apply("COVID COVID-19. Ya hice pool; pool; .gitignore gitignore");
        assert_eq!(
            r.text,
            "COVID-19 COVID-19. Ya hice pull; pull; .gitignore .gitignore"
        );
        assert_eq!(r.changes, 4);
        assert_eq!(d.apply(".gitignore COVID-19").changes, 0);
    }
    #[test]
    fn invalid_rows_and_duplicates() {
        for s in [
            "a\tb\tword",
            "a\tb\tword\twrong",
            "a\t\tword\tcase",
            "\tb\tword\tcase",
        ] {
            assert!(parse(s).unwrap_err_string().contains("Línea 1"));
        }
        assert!(parse("A\tb\tword\tcase\na\tc\tany\tnocase").is_err());
        assert!(parse("A\tb\tword\tcase\na\tc\tword\tcase").is_ok());
        assert!(parse("# only comment").is_err());
    }
    trait ErrorString {
        fn unwrap_err_string(self) -> String;
    }
    impl ErrorString for Result<Dictionary, String> {
        fn unwrap_err_string(self) -> String {
            match self {
                Err(e) => e,
                Ok(_) => panic!("expected invalid dictionary"),
            }
        }
    }
    #[test]
    fn external_file_reloaded_and_deleted() {
        let dir =
            std::env::temp_dir().join(format!("clipia-tsv-{}-{}", std::process::id(), db::now()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("rules.tsv");
        std::fs::write(&path, "a\tb\tword\tcase").unwrap();
        assert_eq!(load(path.to_str().unwrap()).unwrap().apply("a").text, "b");
        std::fs::write(&path, "a\tc\tword\tcase").unwrap();
        assert_eq!(load(path.to_str().unwrap()).unwrap().apply("a").text, "c");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(load(path.to_str().unwrap()).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(load(path.to_str().unwrap()).is_err());
        std::fs::remove_dir(&dir).unwrap();
        assert!(load("relative.tsv").is_err());
    }
    #[test]
    fn replaces_in_place_and_clears_ai_link() {
        let mut c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        db::result(&c, 7, "pool").unwrap();
        let id = db::clips(&c, "", false, 0).unwrap()[0].id;
        assert_eq!(replace_entry(&mut c, id, "pool", "pull").unwrap(), id);
        let rows = db::clips(&c, "", false, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "pull");
        assert_eq!(rows[0].origin, "dictionary");
        assert!(db::comparison(&c, id).is_err());
    }
    #[test]
    fn merges_duplicates_and_preserves_favorite() {
        let mut c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        db::capture(&c, "pool").unwrap();
        let old = c.last_insert_rowid();
        c.execute("UPDATE clips SET favorite=1 WHERE id=?1", [old])
            .unwrap();
        db::capture(&c, "pull").unwrap();
        let target = c.last_insert_rowid();
        assert_eq!(replace_entry(&mut c, old, "pool", "pull").unwrap(), target);
        let rows = db::clips(&c, "", false, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].favorite);
        assert_eq!(rows[0].origin, "dictionary");
    }
    #[test]
    fn stale_entry_not_modified() {
        let mut c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        db::capture(&c, "a").unwrap();
        let id = c.last_insert_rowid();
        assert!(replace_entry(&mut c, id, "other", "b").is_err());
        assert_eq!(db::text(&c, id).unwrap(), "a");
    }
}
