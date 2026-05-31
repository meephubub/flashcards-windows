// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Window,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[tauri::command]
fn set_window_size(window: Window, width: u32, height: u32) {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .unwrap();
    window.center().unwrap();
}

#[tauri::command]
fn hide_to_tray(window: Window) {
    let _ = window.hide();
}

#[tauri::command]
async fn open_sticky_note(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(_) = app.get_webview_window("sticky-note") {
        return Err("Sticky note window already open".to_string());
    }

    let _ = tauri::WebviewWindowBuilder::new(
        &app,
        "sticky-note",
        tauri::WebviewUrl::App("sticky-note.html".into())
    )
    .title("Sticky Note")
    .inner_size(300.0, 400.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("trigger-open", ());
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if shortcut.matches(Modifiers::CONTROL, Code::KeyK) {
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = window.hide();
                                } else {
                                    show_main_window(app);
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let show_item = MenuItem::with_id(app, "show", "Show Flashcards", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Flashcards")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Explicitly enable window transparency to let acrylic pass through
            // (If not set via tauri.conf.json, this ensures it runtime-forces it)
            // Note: Window transparency must be true in tauri.conf.json -> app -> windows

            window
                .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: 680,
                    height: 600,
                }))
                .unwrap();
            window.center().unwrap();

            // Apply vibrant background configurations
            #[cfg(target_os = "windows")]
            {
                // Light theme translucent base fallback color (R, G, B, Alpha)
                let _ = apply_acrylic(&window, Some((255, 255, 255, 120)));
            }

            #[cfg(target_os = "macos")]
            {
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
            }

            let ctrl_k = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyK);
            app.global_shortcut().register(ctrl_k).unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_window_size, hide_to_tray, open_sticky_note])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
