use serde_json::{json, Value};
pub static ISOLATED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        if ISOLATED.load(std::sync::atomic::Ordering::SeqCst) {
            "local.clipia.verification"
        } else {
            "local.clipia.desktop"
        },
        "provider",
    )
    .map_err(|_| "No se pudo abrir el almacén de credenciales de Windows".into())
}
pub fn secret() -> Result<Option<String>, String> {
    if ISOLATED.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(None);
    }
    match credential()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("No se pudo leer la clave guardada en Windows".into()),
    }
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "No se pudo iniciar el cliente HTTP".into())
}
pub fn validate_url(url: &str) -> Result<(), String> {
    let u = reqwest::Url::parse(url).map_err(|_| "URL base inválida")?;
    if !["http", "https"].contains(&u.scheme())
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("Usa una URL HTTP/HTTPS sin credenciales, parámetros ni fragmentos".into());
    }
    Ok(())
}
pub async fn request(base: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    send(
        base,
        path,
        body,
        secret()?,
        std::time::Duration::from_secs(120),
    )
    .await
}
async fn send(
    base: &str,
    path: &str,
    body: Option<Value>,
    key: Option<String>,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    validate_url(base)?;
    let c = client()?;
    let url = format!("{}/{}", base.trim_end_matches('/'), path);
    let mut req = if let Some(body) = body {
        c.post(url).json(&body)
    } else {
        c.get(url)
    };
    req = req.timeout(timeout);
    if let Some(key) = key {
        req = req.bearer_auth(key)
    }
    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "El proveedor agotó el tiempo de espera (120 s)".to_string()
        } else {
            "No se pudo conectar con el proveedor".into()
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "El proveedor respondió HTTP {}",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "El proveedor devolvió una respuesta JSON inválida".into())
}
pub async fn complete(
    base: &str,
    model: &str,
    instructions: &str,
    input: &str,
) -> Result<String, String> {
    let v=request(base,"chat/completions",Some(json!({"model":model,"stream":false,"messages":[{"role":"user","content":instructions.replace("{{text}}",input)}]}))).await?;
    parse_completion(&v)
}
fn parse_completion(v: &Value) -> Result<String, String> {
    v.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "El proveedor no devolvió texto en choices[0].message.content".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compatible_response() {
        assert_eq!(
            parse_completion(&json!({"choices":[{"message":{"content":"Árbol"}}]})).unwrap(),
            "Árbol"
        );
        assert!(parse_completion(&json!({"choices":[]})).is_err());
        assert!(parse_completion(&json!({"choices":[{"message":{"content":""}}]})).is_err());
    }
    #[test]
    fn urls() {
        assert!(validate_url("http://localhost:1234/v1").is_ok());
        assert!(validate_url("file:///tmp").is_err());
        assert!(validate_url("https://key@example.com").is_err());
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };
    fn server(status: &'static str, body: &'static str, delay: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0; 8192];
            let _ = stream.read(&mut buf);
            std::thread::sleep(Duration::from_millis(delay));
            let response=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            let _ = stream.write_all(response.as_bytes());
        });
        format!("http://{addr}/v1")
    }
    #[tokio::test]
    async fn valid_models() {
        let base = server("200 OK", r#"{"data":[{"id":"local"}]}"#, 0);
        let v = send(&base, "models", None, None, Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(v["data"][0]["id"], "local");
    }
    #[tokio::test]
    async fn authentication_error_is_sanitized() {
        let base = server(
            "401 Unauthorized",
            r#"{"error":"private server details"}"#,
            0,
        );
        let e = send(
            &base,
            "models",
            None,
            Some("test-key".into()),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();
        assert_eq!(e, "El proveedor respondió HTTP 401");
    }
    #[tokio::test]
    async fn invalid_json() {
        let base = server("200 OK", "not-json", 0);
        assert!(send(&base, "models", None, None, Duration::from_secs(2))
            .await
            .unwrap_err()
            .contains("JSON inválida"));
    }
    #[tokio::test]
    async fn timeout() {
        let base = server("200 OK", "{}", 300);
        assert!(send(&base, "models", None, None, Duration::from_millis(50))
            .await
            .unwrap_err()
            .contains("tiempo de espera"));
    }
    #[tokio::test]
    async fn unavailable() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        drop(l);
        assert!(send(&base, "models", None, None, Duration::from_secs(5))
            .await
            .unwrap_err()
            .contains("No se pudo conectar"));
    }
}
