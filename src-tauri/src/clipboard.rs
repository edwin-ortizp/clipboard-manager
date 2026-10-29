use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::*,
        System::{DataExchange::*, LibraryLoader::GetModuleHandleW, Memory::*},
        UI::WindowsAndMessaging::*,
    },
};
static OWN_SEQUENCE: AtomicU32 = AtomicU32::new(0);
static OWNER: AtomicIsize = AtomicIsize::new(0);
pub enum Capture {
    Text(String),
    Image(Vec<u8>),
}
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Close;
impl Drop for Close {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}
pub fn write(text: &str) -> Result<(), String> {
    write_if_unchanged(text, None).map(|_| ())
}
pub fn write_if_unchanged(text: &str, expected: Option<u32>) -> Result<bool, String> {
    unsafe {
        let owner = OWNER.load(Ordering::SeqCst);
        if owner == 0 {
            return Err("El portapapeles todavía se está iniciando".into());
        }
        OpenClipboard(Some(HWND(owner as *mut _)))
            .map_err(|_| "El portapapeles está ocupado. Vuelve a intentarlo.".to_string())?;
        let _close = Close;
        if expected.is_some_and(|s| s != GetClipboardSequenceNumber()) {
            return Ok(false);
        }
        let data = wide(text);
        let mem = GlobalAlloc(GMEM_MOVEABLE, data.len() * 2).map_err(|e| e.to_string())?;
        let p = GlobalLock(mem);
        if p.is_null() {
            let _ = GlobalFree(Some(mem));
            return Err("No se pudo reservar el portapapeles".into());
        }
        std::ptr::copy_nonoverlapping(data.as_ptr(), p as *mut u16, data.len());
        let _ = GlobalUnlock(mem);
        if let Err(e) = EmptyClipboard() {
            let _ = GlobalFree(Some(mem));
            return Err(e.to_string());
        }
        if let Err(e) = SetClipboardData(13, Some(HANDLE(mem.0))) {
            let _ = GlobalFree(Some(mem));
            return Err(e.to_string());
        }
        OWN_SEQUENCE.store(GetClipboardSequenceNumber(), Ordering::SeqCst);
        Ok(true)
    }
}
unsafe fn raw(format: u32) -> Option<Vec<u8>> {
    let h = GetClipboardData(format).ok()?;
    let m = HGLOBAL(h.0);
    let size = GlobalSize(m);
    if size == 0 || size > 64 * 1024 * 1024 {
        return None;
    }
    let p = GlobalLock(m);
    if p.is_null() {
        return None;
    }
    let bytes = std::slice::from_raw_parts(p as *const u8, size).to_vec();
    let _ = GlobalUnlock(m);
    Some(bytes)
}
pub fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let u32at = |n| u32::from_le_bytes(dib[n..n + 4].try_into().unwrap());
    let header = u32at(0) as usize;
    if header < 40 || header > dib.len() {
        return None;
    }
    let bits = u16::from_le_bytes(dib[14..16].try_into().unwrap());
    let compression = u32at(16);
    let colors = u32at(32) as usize;
    let palette = if colors > 0 {
        colors.checked_mul(4)?
    } else if bits <= 8 {
        (1usize << bits) * 4
    } else {
        0
    };
    let masks = if header == 40 && (compression == 3 || compression == 6) {
        if compression == 6 {
            16
        } else {
            12
        }
    } else {
        0
    };
    let offset = 14usize
        .checked_add(header)?
        .checked_add(palette)?
        .checked_add(masks)?;
    if offset > dib.len() + 14 {
        return None;
    }
    let mut bmp = Vec::with_capacity(dib.len() + 14);
    bmp.extend(b"BM");
    bmp.extend(((dib.len() + 14) as u32).to_le_bytes());
    bmp.extend([0u8; 4]);
    bmp.extend((offset as u32).to_le_bytes());
    bmp.extend(dib);
    Some(bmp)
}
unsafe fn read() -> Option<Capture> {
    if GetClipboardSequenceNumber() == OWN_SEQUENCE.load(Ordering::SeqCst) {
        return None;
    }
    OpenClipboard(None).ok()?;
    let _close = Close;
    for name in [
        "ExcludeClipboardContentFromMonitorProcessing",
        "CanIncludeInClipboardHistory",
    ] {
        let name = wide(name);
        let format = RegisterClipboardFormatW(PCWSTR(name.as_ptr()));
        if IsClipboardFormatAvailable(format).is_ok() {
            if format
                == RegisterClipboardFormatW(PCWSTR(
                    wide("ExcludeClipboardContentFromMonitorProcessing").as_ptr(),
                ))
            {
                return None;
            }
            let h = GetClipboardData(format).ok()?;
            let m = HGLOBAL(h.0);
            if GlobalSize(m) < std::mem::size_of::<u32>() {
                return None;
            }
            let p = GlobalLock(m);
            if !p.is_null() {
                let excluded = *(p as *const u32) == 0;
                let _ = GlobalUnlock(m);
                if excluded {
                    return None;
                }
            }
        }
    }
    let png = RegisterClipboardFormatW(PCWSTR(wide("PNG").as_ptr()));
    if IsClipboardFormatAvailable(png).is_ok() {
        if let Some(bytes) = raw(png) {
            return Some(Capture::Image(bytes));
        }
    }
    for format in [17, 8] {
        if IsClipboardFormatAvailable(format).is_ok() {
            if let Some(bytes) = raw(format).and_then(|b| dib_to_bmp(&b)) {
                return Some(Capture::Image(bytes));
            }
        }
    }
    let h = GetClipboardData(13).ok()?;
    let m = HGLOBAL(h.0);
    let size = GlobalSize(m) / 2;
    let p = GlobalLock(m) as *const u16;
    if p.is_null() {
        return None;
    }
    let slice = std::slice::from_raw_parts(p, size);
    let end = slice.iter().position(|v| *v == 0).unwrap_or(size);
    let text = String::from_utf16_lossy(&slice[..end]);
    let _ = GlobalUnlock(m);
    Some(Capture::Text(text))
}
fn encode_image(bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let image = crate::media::decode(bytes)?.to_rgba8();
    let png = crate::media::png(&image::DynamicImage::ImageRgba8(image.clone()))?;
    let (w, h) = image.dimensions();
    let mut dib = vec![0u8; 124];
    dib[0..4].copy_from_slice(&124u32.to_le_bytes());
    dib[4..8].copy_from_slice(&(w as i32).to_le_bytes());
    dib[8..12].copy_from_slice(&(-(h as i32)).to_le_bytes());
    dib[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib[14..16].copy_from_slice(&32u16.to_le_bytes());
    dib[16..20].copy_from_slice(&3u32.to_le_bytes());
    dib[20..24].copy_from_slice(&(w * h * 4).to_le_bytes());
    for (offset, mask) in [
        (40, 0x00ff0000u32),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
        (56, 0x73524742),
    ] {
        dib[offset..offset + 4].copy_from_slice(&mask.to_le_bytes());
    }
    for p in image.pixels() {
        dib.extend([p[2], p[1], p[0], p[3]]);
    }
    Ok((png, dib))
}
pub fn write_image(bytes: &[u8]) -> Result<(), String> {
    let (png, dib) = encode_image(bytes)?;
    unsafe {
        let owner = OWNER.load(Ordering::SeqCst);
        if owner == 0 {
            return Err("El portapapeles no está disponible".into());
        }
        OpenClipboard(Some(HWND(owner as *mut _))).map_err(|_| "El portapapeles está ocupado")?;
        let _close = Close;
        let mut blocks = Vec::new();
        for data in [&png, &dib] {
            let mem = match GlobalAlloc(GMEM_MOVEABLE, data.len()) {
                Ok(mem) => mem,
                Err(e) => {
                    for old in blocks {
                        let _ = GlobalFree(Some(old));
                    }
                    return Err(e.to_string());
                }
            };
            let p = GlobalLock(mem);
            if p.is_null() {
                let _ = GlobalFree(Some(mem));
                for old in blocks {
                    let _ = GlobalFree(Some(old));
                }
                return Err("No se pudo reservar memoria".into());
            }
            std::ptr::copy_nonoverlapping(data.as_ptr(), p as *mut u8, data.len());
            let _ = GlobalUnlock(mem);
            blocks.push(mem);
        }
        if let Err(e) = EmptyClipboard() {
            for old in blocks {
                let _ = GlobalFree(Some(old));
            }
            return Err(e.to_string());
        }
        let format = RegisterClipboardFormatW(PCWSTR(wide("PNG").as_ptr()));
        let mut blocks = blocks.into_iter();
        for fmt in [format, 17] {
            let mem = blocks.next().unwrap();
            if let Err(e) = SetClipboardData(fmt, Some(HANDLE(mem.0))) {
                let _ = GlobalFree(Some(mem));
                for remaining in blocks {
                    let _ = GlobalFree(Some(remaining));
                }
                return Err(e.to_string());
            }
        }
        OWN_SEQUENCE.store(GetClipboardSequenceNumber(), Ordering::SeqCst);
        Ok(())
    }
}
pub fn listen(callback: impl Fn(Capture) + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || unsafe {
        unsafe extern "system" fn proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
            DefWindowProcW(hwnd, msg, w, l)
        }
        let class = wide("ClipiaClipboardListener");
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let wc = WNDCLASSW {
            lpfnWndProc: Some(proc),
            hInstance: instance.into(),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        RegisterClassW(&wc);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class.as_ptr()),
            PCWSTR(class.as_ptr()),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        ) else {
            return;
        };
        if AddClipboardFormatListener(hwnd).is_err() {
            return;
        }
        OWNER.store(hwnd.0 as isize, Ordering::SeqCst);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_CLIPBOARDUPDATE {
                for _ in 0..5 {
                    if let Some(text) = read() {
                        callback(text);
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = RemoveClipboardFormatListener(hwnd);
        let _ = DestroyWindow(hwnd);
        OWNER.store(0, Ordering::SeqCst);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn image_formats_round_trip_alpha() {
        let mut rgba = image::RgbaImage::new(2, 1);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 100]));
        rgba.put_pixel(1, 0, image::Rgba([0, 255, 0, 255]));
        let source = crate::media::png(&image::DynamicImage::ImageRgba8(rgba.clone())).unwrap();
        let (png, dib) = encode_image(&source).unwrap();
        assert_eq!(crate::media::decode(&png).unwrap().to_rgba8(), rgba);
        assert_eq!(
            crate::media::decode(&dib_to_bmp(&dib).unwrap())
                .unwrap()
                .to_rgba8(),
            rgba
        );
    }
    #[test]
    fn malformed_dib_is_rejected() {
        assert!(dib_to_bmp(&[]).is_none());
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&124u32.to_le_bytes());
        assert!(dib_to_bmp(&dib).is_none());
    }
    use windows::Win32::System::{StationsAndDesktops::*, Threading::GetCurrentThreadId};

    // A separate window station has its own clipboard: this never reads or changes
    // the user's interactive clipboard, including its non-text formats.
    #[test]
    #[ignore = "Requiere permiso de Windows para crear una estación de portapapeles aislada; no usa el portapapeles personal"]
    fn native_capture_unicode_exclusions_and_no_self_recapture() {
        unsafe {
            let original_station = GetProcessWindowStation().unwrap();
            let original_desktop = GetThreadDesktop(GetCurrentThreadId()).unwrap();
            let name = wide(&format!("ClipiaTest{}", std::process::id()));
            let station = CreateWindowStationW(PCWSTR(name.as_ptr()), 0, 0x0000037F, None).unwrap();
            SetProcessWindowStation(station).unwrap();
            let desktop_name = wide("IsolatedClipboard");
            let desktop = CreateDesktopW(
                PCWSTR(desktop_name.as_ptr()),
                PCWSTR::null(),
                None,
                Default::default(),
                0x000001FF,
                None,
            )
            .unwrap();
            SetThreadDesktop(desktop).unwrap();
            let (tx, rx) = std::sync::mpsc::channel();
            let listener = listen(move |s| {
                if let Capture::Text(s) = s {
                    let _ = tx.send(s);
                }
            });
            for _ in 0..100 {
                if OWNER.load(Ordering::SeqCst) != 0 {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            assert_ne!(
                OWNER.load(Ordering::SeqCst),
                0,
                "native listener must initialize"
            );
            external_write("Árbol 🦀\r\nSegunda línea", None);
            assert_eq!(
                rx.recv_timeout(Duration::from_secs(3)).unwrap(),
                "Árbol 🦀\r\nSegunda línea"
            );
            write("Resultado propio").unwrap();
            assert!(
                rx.recv_timeout(Duration::from_millis(250)).is_err(),
                "own writes must not loop"
            );
            external_write(
                "Texto excluido",
                Some("ExcludeClipboardContentFromMonitorProcessing"),
            );
            assert!(rx.recv_timeout(Duration::from_millis(250)).is_err());
            external_write("Texto privado", Some("CanIncludeInClipboardHistory"));
            assert!(rx.recv_timeout(Duration::from_millis(250)).is_err());
            external_write("Captura reanudada", None);
            assert_eq!(
                rx.recv_timeout(Duration::from_secs(3)).unwrap(),
                "Captura reanudada"
            );
            PostMessageW(
                Some(HWND(OWNER.load(Ordering::SeqCst) as *mut _)),
                WM_QUIT,
                WPARAM(0),
                LPARAM(0),
            )
            .unwrap();
            listener.join().unwrap();
            SetThreadDesktop(original_desktop).unwrap();
            SetProcessWindowStation(original_station).unwrap();
            CloseDesktop(desktop).unwrap();
            CloseWindowStation(station).unwrap();
        }
    }
    unsafe fn external_write(text: &str, exclusion: Option<&str>) {
        OpenClipboard(Some(HWND(OWNER.load(Ordering::SeqCst) as *mut _))).unwrap();
        let _close = Close;
        EmptyClipboard().unwrap();
        let data = wide(text);
        let mem = GlobalAlloc(GMEM_MOVEABLE, data.len() * 2).unwrap();
        let p = GlobalLock(mem);
        assert!(!p.is_null());
        std::ptr::copy_nonoverlapping(data.as_ptr(), p as *mut u16, data.len());
        let _ = GlobalUnlock(mem);
        SetClipboardData(13, Some(HANDLE(mem.0))).unwrap();
        if let Some(name) = exclusion {
            let format = RegisterClipboardFormatW(PCWSTR(wide(name).as_ptr()));
            let mem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 4).unwrap();
            SetClipboardData(format, Some(HANDLE(mem.0))).unwrap();
        }
    }
}
