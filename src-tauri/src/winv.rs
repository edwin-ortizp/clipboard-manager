//! Optional Win+V interception. No keystrokes or clipboard contents are recorded.
use std::cell::RefCell;
use std::sync::{mpsc, Mutex};
use tauri::Manager;
use windows::core::w;
use windows::Win32::{
    Foundation::{GetLastError, SetLastError, HWND, LPARAM, LRESULT, WIN32_ERROR, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

thread_local! {
    static APP: RefCell<Option<tauri::AppHandle>> = const { RefCell::new(None) };
    static KEYS: RefCell<KeyboardState> = RefCell::new(KeyboardState::default());
}

// Current modifier state only; never retain a history of keys or text.
const MODIFIERS: [VIRTUAL_KEY; 8] = [
    VK_LWIN,
    VK_RWIN,
    VK_LCONTROL,
    VK_RCONTROL,
    VK_LMENU,
    VK_RMENU,
    VK_LSHIFT,
    VK_RSHIFT,
];

#[derive(Default)]
struct KeyboardState {
    modifiers: u8,
    v_down: bool,
    captured_v: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Decision {
    Pass,
    Capture,
    Consume,
}

impl KeyboardState {
    unsafe fn modifier_snapshot() -> u8 {
        let mut modifiers = 0;
        for (index, key) in MODIFIERS.iter().enumerate() {
            if GetAsyncKeyState(i32::from(key.0)) < 0 {
                modifiers |= 1 << index;
            }
        }
        modifiers
    }

    unsafe fn initial() -> Self {
        Self {
            modifiers: Self::modifier_snapshot(),
            v_down: GetAsyncKeyState(i32::from(VK_V.0)) < 0,
            captured_v: false,
        }
    }

    fn event(
        &mut self,
        vk: u32,
        message: u32,
        scan: u32,
        extended: bool,
        sampled_modifiers: u8,
    ) -> Decision {
        let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        let up = message == WM_KEYUP || message == WM_SYSKEYUP;
        if !down && !up {
            return Decision::Pass;
        }
        let modifier = match VIRTUAL_KEY(vk as u16) {
            VK_CONTROL => {
                if extended {
                    VK_RCONTROL
                } else {
                    VK_LCONTROL
                }
            }
            VK_MENU => {
                if extended {
                    VK_RMENU
                } else {
                    VK_LMENU
                }
            }
            VK_SHIFT => {
                if scan == 0x36 {
                    VK_RSHIFT
                } else {
                    VK_LSHIFT
                }
            }
            key => key,
        };
        if let Some(index) = MODIFIERS.iter().position(|key| *key == modifier) {
            if down {
                self.modifiers |= 1 << index;
            } else {
                self.modifiers &= !(1 << index);
            }
            return Decision::Pass;
        }
        if vk != u32::from(VK_V.0) {
            return Decision::Pass;
        }
        let repeated = self.v_down;
        self.v_down = down;
        if self.captured_v {
            if up {
                self.captured_v = false;
            }
            return Decision::Consume;
        }
        // Earlier hooks may omit modifier transitions. Never discard an observed modifier.
        let modifiers = self.modifiers | sampled_modifiers;
        if down
            && !repeated
            && should_capture(
                vk,
                modifiers & 0b0000_0011 != 0,
                modifiers & 0b0000_1100 != 0,
                modifiers & 0b0011_0000 != 0,
                modifiers & 0b1100_0000 != 0,
            )
        {
            self.captured_v = true;
            Decision::Capture
        } else {
            Decision::Pass
        }
    }
}

fn should_capture(vk: u32, win: bool, ctrl: bool, alt: bool, shift: bool) -> bool {
    vk == u32::from(VK_V.0) && win && !ctrl && !alt && !shift
}

unsafe fn mask_start_menu() -> Result<(), String> {
    // 0xE8 is unassigned: mark Win as used without sending a printable character.
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0xE8),
                    ..Default::default()
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0xE8),
                    dwFlags: KEYEVENTF_KEYUP,
                    ..Default::default()
                },
            },
        },
    ];
    SetLastError(WIN32_ERROR(0));
    let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!(
            "No se pudo activar Win+V: Windows rechazó la entrada auxiliar ({sent}/2, error {}). El panel de Windows sigue disponible.",
            GetLastError().0
        ))
    }
}

unsafe extern "system" fn keyboard(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code != HC_ACTION as i32 {
        return CallNextHookEx(None, code, w, l);
    }
    let key = &*(l.0 as *const KBDLLHOOKSTRUCT);
    // The current event is V: only sample OTHER keys, whose transitions precede it.
    // Sampling V itself here would see its old asynchronous state.
    let sampled = if key.vkCode == u32::from(VK_V.0)
        && (w.0 as u32 == WM_KEYDOWN || w.0 as u32 == WM_SYSKEYDOWN)
    {
        KeyboardState::modifier_snapshot()
    } else {
        0
    };
    let decision = KEYS.with(|state| {
        state.borrow_mut().event(
            key.vkCode,
            w.0 as u32,
            key.scanCode,
            key.flags.contains(LLKHF_EXTENDED),
            sampled,
        )
    });
    // Never hold the keyboard-state borrow across SendInput (injected callbacks may reenter).
    if decision == Decision::Consume {
        return LRESULT(1);
    }
    if decision == Decision::Capture {
        if let Err(error) = mask_start_menu() {
            // Injection can be denied by Windows: leave the native shortcut intact.
            KEYS.with(|state| state.borrow_mut().captured_v = false);
            if let Some(app) = APP.with(|slot| slot.borrow().clone()) {
                std::thread::spawn(move || {
                    let state = app.state::<crate::SharedState>();
                    if let Ok(mut message) = state.startup_error.lock() {
                        *message = Some(error);
                    }
                    crate::changed(&app);
                });
            }
            return CallNextHookEx(None, code, w, l);
        }
        let app = APP.with(|slot| slot.borrow().clone());
        if let Some(app) = app {
            crate::request_widget(&app);
        }
        return LRESULT(1);
    }
    CallNextHookEx(None, code, w, l)
}

const STOP: u32 = WM_APP + 1;

struct RunningHook {
    window: isize,
    stopped: mpsc::Receiver<Result<(), String>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl RunningHook {
    fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel();
        let (done, stopped) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("win-v-hook".into())
            .spawn(move || unsafe {
                // A message-only window wakes the owner thread without polling or extra APIs.
                let window = match CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("ClipboardManagerWinV"),
                    WINDOW_STYLE::default(),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    None,
                    None,
                ) {
                    Ok(window) => window,
                    Err(error) => {
                        let _ = tx.send(Err(error.to_string()));
                        return;
                    }
                };
                KEYS.with(|state| *state.borrow_mut() = KeyboardState::initial());
                let installed = GetModuleHandleW(None).and_then(|module| {
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), Some(module.into()), 0)
                });
                let hook = match installed {
                    Ok(hook) => hook,
                    Err(error) => {
                        let _ = DestroyWindow(window);
                        let _ = tx.send(Err(error.to_string()));
                        return;
                    }
                };
                APP.with(|slot| *slot.borrow_mut() = Some(app));
                let mut hooked = true;
                if tx.send(Ok(window.0 as isize)).is_ok() {
                    let mut message = MSG::default();
                    while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                        if message.hwnd == window && message.message == STOP {
                            match UnhookWindowsHookEx(hook) {
                                Ok(()) => {
                                    hooked = false;
                                    let _ = done.send(Ok(()));
                                    break;
                                }
                                Err(error) => {
                                    let _ = done.send(Err(error.to_string()));
                                    continue;
                                }
                            }
                        }
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                if hooked {
                    let _ = UnhookWindowsHookEx(hook);
                }
                let _ = DestroyWindow(window);
                APP.with(|slot| *slot.borrow_mut() = None);
                KEYS.with(|state| *state.borrow_mut() = KeyboardState::default());
            })
            .map_err(|error| error.to_string())?;
        let window = rx.recv().map_err(|error| error.to_string())??;
        Ok(Self {
            window,
            stopped,
            thread: Some(thread),
        })
    }

    fn stop(&mut self) -> Result<(), String> {
        unsafe {
            PostMessageW(
                Some(HWND(self.window as *mut _)),
                STOP,
                WPARAM(0),
                LPARAM(0),
            )
            .map_err(|error| error.to_string())?;
        }
        self.stopped.recv().map_err(|error| error.to_string())??;
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .map_err(|_| "El hilo Win+V terminó inesperadamente".to_string())?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct Controller {
    running: Mutex<Option<RunningHook>>,
}

impl Controller {
    pub fn set_enabled(&self, app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
        let mut running = self.running.lock().map_err(crate::db::err)?;
        set_enabled(
            &mut running,
            enabled,
            &mut || RunningHook::start(app.clone()),
            &mut RunningHook::stop,
        )
    }

    pub fn save(
        &self,
        app: &tauri::AppHandle,
        enabled: bool,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut running = self.running.lock().map_err(crate::db::err)?;
        save_with(
            &mut running,
            enabled,
            &mut || RunningHook::start(app.clone()),
            &mut RunningHook::stop,
            persist,
        )
    }
}

fn set_enabled<T>(
    running: &mut Option<T>,
    enabled: bool,
    start: &mut impl FnMut() -> Result<T, String>,
    stop: &mut impl FnMut(&mut T) -> Result<(), String>,
) -> Result<(), String> {
    if enabled && running.is_none() {
        *running = Some(start()?);
    } else if !enabled {
        if let Some(hook) = running.as_mut() {
            stop(hook)?;
            *running = None;
        }
    }
    Ok(())
}

fn save_with<T>(
    running: &mut Option<T>,
    enabled: bool,
    start: &mut impl FnMut() -> Result<T, String>,
    stop: &mut impl FnMut(&mut T) -> Result<(), String>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let previous = running.is_some();
    set_enabled(running, enabled, start, stop)?;
    if let Err(error) = persist() {
        return match set_enabled(running, previous, start, stop) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}. No se pudo restablecer Win+V: {rollback}")),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(state: &mut KeyboardState, vk: VIRTUAL_KEY, message: u32) -> Decision {
        state.event(vk.0.into(), message, 0, false, 0)
    }

    #[test]
    fn sampled_windows_modifier_recovers_missing_hook_transition() {
        for win in [0b01, 0b10] {
            let mut state = KeyboardState::default();
            assert_eq!(
                state.event(VK_V.0.into(), WM_KEYDOWN, 0, false, win),
                Decision::Capture
            );
            assert_eq!(key(&mut state, VK_V, WM_KEYUP), Decision::Consume);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
        }
    }

    #[test]
    fn sampled_extra_modifiers_never_turn_other_shortcuts_into_win_v() {
        for extra in [0b100, 0b1000, 0b10000, 0b100000, 0b1000000, 0b10000000] {
            let mut state = KeyboardState::default();
            key(&mut state, VK_LWIN, WM_KEYDOWN);
            assert_eq!(
                state.event(VK_V.0.into(), WM_KEYDOWN, 0, false, extra),
                Decision::Pass
            );
            let mut state = KeyboardState::default();
            assert_eq!(
                state.event(VK_V.0.into(), WM_KEYDOWN, 0, false, extra | 1),
                Decision::Pass
            );
        }
    }

    #[test]
    fn modifier_events_capture_both_windows_keys_without_async_state_queries() {
        for win in [VK_LWIN, VK_RWIN] {
            let mut state = KeyboardState::default();
            assert_eq!(key(&mut state, win, WM_KEYDOWN), Decision::Pass);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Consume);
            // Even if Win is released first, finish consuming the same V pair.
            assert_eq!(key(&mut state, win, WM_KEYUP), Decision::Pass);
            assert_eq!(key(&mut state, VK_V, WM_KEYUP), Decision::Consume);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
        }
    }

    #[test]
    fn releasing_one_windows_key_keeps_the_other_pressed() {
        let mut state = KeyboardState::default();
        key(&mut state, VK_LWIN, WM_KEYDOWN);
        key(&mut state, VK_RWIN, WM_KEYDOWN);
        key(&mut state, VK_LWIN, WM_KEYUP);
        assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
    }

    #[test]
    fn modifier_event_sequences_preserve_other_shortcuts() {
        for modifier in [
            VK_LCONTROL,
            VK_RCONTROL,
            VK_LMENU,
            VK_RMENU,
            VK_LSHIFT,
            VK_RSHIFT,
        ] {
            let mut state = KeyboardState::default();
            key(&mut state, VK_LWIN, WM_KEYDOWN);
            key(&mut state, modifier, WM_SYSKEYDOWN);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
            key(&mut state, modifier, WM_SYSKEYUP);
            // Removing a modifier halfway through an existing shortcut must not capture repeats.
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
            assert_eq!(key(&mut state, VK_V, WM_KEYUP), Decision::Pass);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
        }
        let mut state = KeyboardState::default();
        key(&mut state, VK_V, WM_KEYDOWN);
        key(&mut state, VK_LWIN, WM_KEYDOWN);
        assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
    }

    #[test]
    fn generic_modifiers_keep_left_and_right_states_separate() {
        for (generic, left, right, right_scan, right_extended) in [
            (VK_CONTROL, VK_LCONTROL, VK_RCONTROL, 0, true),
            (VK_MENU, VK_LMENU, VK_RMENU, 0, true),
            (VK_SHIFT, VK_LSHIFT, VK_RSHIFT, 0x36, false),
        ] {
            let mut state = KeyboardState::default();
            key(&mut state, VK_LWIN, WM_KEYDOWN);
            key(&mut state, left, WM_KEYDOWN);
            state.event(generic.0.into(), WM_KEYDOWN, right_scan, right_extended, 0);
            key(&mut state, left, WM_KEYUP);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
            key(&mut state, VK_V, WM_KEYUP);
            key(&mut state, right, WM_KEYUP);
            assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
        }
    }

    #[test]
    fn failed_injection_leaves_the_v_pair_and_repeats_native() {
        let mut state = KeyboardState::default();
        key(&mut state, VK_LWIN, WM_KEYDOWN);
        assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
        state.captured_v = false;
        assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Pass);
        assert_eq!(key(&mut state, VK_V, WM_KEYUP), Decision::Pass);
        assert_eq!(key(&mut state, VK_V, WM_KEYDOWN), Decision::Capture);
    }

    #[test]
    fn enabling_and_disabling_are_immediate_and_idempotent() {
        let mut running = None;
        let mut starts = 0;
        let mut stops = 0;
        let mut start = || {
            starts += 1;
            Ok(())
        };
        let mut stop = |_: &mut ()| {
            stops += 1;
            Ok(())
        };
        for enabled in [true, true, false, false] {
            set_enabled(&mut running, enabled, &mut start, &mut stop).unwrap();
            assert_eq!(running.is_some(), enabled);
        }
        assert_eq!((starts, stops), (1, 1));
    }

    #[test]
    fn database_failure_restores_hook_and_settings_in_both_directions() {
        for previous in [false, true] {
            let mut c = rusqlite::Connection::open_in_memory().unwrap();
            crate::db::init(&c).unwrap();
            let mut old = crate::db::Settings::default();
            old.win_v = previous;
            crate::persist_settings(&mut c, &old).unwrap();
            crate::db::capture(&c, "Keep me").unwrap();
            // Fail AFTER the settings UPDATE, during purge, to verify SQLite rollback too.
            c.execute_batch("CREATE TRIGGER fail_purge BEFORE DELETE ON clips BEGIN SELECT RAISE(ABORT,'simulated save failure'); END;").unwrap();
            let mut next = old.clone();
            next.win_v = !previous;
            c.execute("INSERT INTO clips(text,created) VALUES('Second',0)", [])
                .unwrap();
            next.limit = 1;
            let mut running = previous.then_some(());
            let mut starts = 0;
            let mut stops = 0;
            let error = save_with(
                &mut running,
                next.win_v,
                &mut || {
                    starts += 1;
                    Ok(())
                },
                &mut |_: &mut ()| {
                    stops += 1;
                    Ok(())
                },
                || crate::persist_settings(&mut c, &next),
            )
            .unwrap_err();
            assert!(error.contains("simulated save failure"));
            assert_eq!(running.is_some(), previous);
            assert_eq!(crate::db::settings(&c).win_v, previous);
            assert_eq!(crate::db::settings(&c).limit, old.limit);
            assert_eq!(crate::db::clips(&c, "", false, 0).unwrap().len(), 2);
            assert_eq!((starts, stops), (1, 1));
        }
    }

    #[test]
    fn installation_or_removal_failure_prevents_saving() {
        let mut running: Option<()> = None;
        let error = save_with(
            &mut running,
            true,
            &mut || Err("installation failed".into()),
            &mut |_| Ok(()),
            || panic!("Must not save if installation fails"),
        )
        .unwrap_err();
        assert_eq!(error, "installation failed");
        assert!(running.is_none());

        let mut running = Some(());
        let error = save_with(
            &mut running,
            false,
            &mut || Ok(()),
            &mut |_| Err("removal failed".into()),
            || panic!("Must not save if removal fails"),
        )
        .unwrap_err();
        assert_eq!(error, "removal failed");
        assert!(running.is_some());
    }

    #[test]
    fn successful_save_keeps_new_hook_state_and_recovers_from_failed_startup() {
        let mut running = None;
        let mut saved = false;
        save_with(&mut running, true, &mut || Ok(()), &mut |_| Ok(()), || {
            saved = true;
            Ok(())
        })
        .unwrap();
        assert!(saved && running.is_some());
        save_with(&mut running, false, &mut || Ok(()), &mut |_| Ok(()), || {
            Ok(())
        })
        .unwrap();
        assert!(running.is_none());
    }

    #[test]
    fn rollback_failure_is_reported_alongside_original_failure() {
        let mut running = None;
        let error = save_with(
            &mut running,
            true,
            &mut || Ok(()),
            &mut |_| Err("cannot remove hook".into()),
            || Err("cannot save settings".into()),
        )
        .unwrap_err();
        assert!(error.contains("cannot save settings"));
        assert!(error.contains("cannot remove hook"));
        assert!(running.is_some());
    }

    #[test]
    fn captures_win_v_but_not_plain_v() {
        assert!(should_capture(VK_V.0.into(), true, false, false, false));
        assert!(!should_capture(VK_V.0.into(), false, false, false, false));
    }

    #[test]
    fn win_shift_v_and_all_extra_modifier_combinations_pass_through() {
        assert!(!should_capture(VK_V.0.into(), true, false, false, true));
        // Exercise Ctrl, Alt, Shift and every combination of them, with or without Win.
        for win in [false, true] {
            for modifiers in 1..8 {
                assert!(
                    !should_capture(
                        VK_V.0.into(),
                        win,
                        modifiers & 1 != 0,
                        modifiers & 2 != 0,
                        modifiers & 4 != 0,
                    ),
                    "Unexpected capture: win={win}, modifiers={modifiers}"
                );
            }
        }
    }

    #[test]
    fn other_virtual_keys_pass_through_including_win_d_and_win_alone() {
        for vk in 0..=255 {
            if vk != u32::from(VK_V.0) {
                assert!(
                    !should_capture(vk, true, false, false, false),
                    "Unexpected capture of virtual key {vk}"
                );
            }
        }
    }
}
