use base64::Engine;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&args[1]).expect("installer");
    let signature = std::fs::read_to_string(&args[2]).expect("signature");
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&args[3]).unwrap()).unwrap();
    let decode = |s: &str| {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(s.trim())
                .unwrap(),
        )
        .unwrap()
    };
    let public = minisign_verify::PublicKey::decode(&decode(
        config["plugins"]["updater"]["pubkey"].as_str().unwrap(),
    ))
    .unwrap();
    let signature = minisign_verify::Signature::decode(&decode(&signature)).unwrap();
    public
        .verify(&data, &signature, true)
        .expect("valid signature");
    let mut tampered = data.clone();
    tampered[0] ^= 1;
    assert!(
        public.verify(&tampered, &signature, true).is_err(),
        "tampered installer must be rejected"
    );
    assert!(
        public
            .verify(&data[..data.len() / 2], &signature, true)
            .is_err(),
        "interrupted download must be rejected"
    );
    println!(
        "Firma válida; instalador alterado y descarga truncada rechazados. {}",
        signature.trusted_comment()
    );
}
