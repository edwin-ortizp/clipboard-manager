#[allow(dead_code)]
#[path = "../src/db.rs"]
mod db;
#[allow(dead_code)]
#[path = "../src/mappings.rs"]
mod mappings;
fn main() {
    let path = std::env::args().nth(1).expect("Ruta TSV requerida");
    match mappings::load(&path) {
        Ok(d) => println!("Diccionario válido: {} equivalencias", d.status().rules),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    }
}
