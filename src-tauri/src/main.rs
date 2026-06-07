// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod link_preview;

use link_preview::{fetch_link_preview as scrape_link_preview, normalize_http_url, LinkPreview};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    Emitter, LogicalSize, Manager, Size, WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[derive(Serialize)]
struct WindowSize {
    width: u32,
    height: u32,
}

struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

struct ImageTileMeta {
    aspect: f64,
}

struct MoodboardImageInner {
    meta: Mutex<HashMap<String, ImageTileMeta>>,
    correcting: Mutex<HashMap<String, bool>>,
}

#[derive(Clone)]
struct MoodboardImageState(Arc<MoodboardImageInner>);

impl Default for MoodboardImageState {
    fn default() -> Self {
        Self(Arc::new(MoodboardImageInner {
            meta: Mutex::new(HashMap::new()),
            correcting: Mutex::new(HashMap::new()),
        }))
    }
}

const IMAGE_MAX_W: f64 = 880.0;
const IMAGE_MAX_H: f64 = 720.0;
const IMAGE_MIN_W: f64 = 48.0;
const IMAGE_MIN_H: f64 = 48.0;

fn clamp_initial_image_size(natural_w: f64, natural_h: f64) -> (f64, f64) {
    let mut w = natural_w.max(1.0);
    let mut h = natural_h.max(1.0);
    let scale = (IMAGE_MAX_W / w).min(IMAGE_MAX_H / h).min(1.0);
    w = (w * scale).round().max(IMAGE_MIN_W);
    h = (h * scale).round().max(IMAGE_MIN_H);
    (w, h)
}

fn snap_logical_size(width: f64, height: f64, aspect: f64) -> (f64, f64) {
    let mut w = width.max(IMAGE_MIN_W);
    let mut h = height.max(IMAGE_MIN_H);
    let current = w / h;

    if (current - aspect).abs() < 0.002 {
        return (w, h);
    }

    if current > aspect {
        w = h * aspect;
    } else {
        h = w / aspect;
    }

    (
        w.round().max(IMAGE_MIN_W),
        h.round().max(IMAGE_MIN_H),
    )
}

fn apply_logical_size(window: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(Size::Logical(LogicalSize::new(
            width.max(IMAGE_MIN_W),
            height.max(IMAGE_MIN_H),
        )))
        .map_err(|e| e.to_string())
}

fn moodboard_label(id: &str) -> String {
    format!("moodboard-{}", id)
}

fn configure_pure_image_window(window: &WebviewWindow) {
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
}

#[tauri::command]
fn set_window_size(window: Window, width: u32, height: u32, center: Option<bool>) {
    window
        .set_size(Size::Physical(tauri::PhysicalSize { width, height }))
        .unwrap();
    if center.unwrap_or(true) {
        window.center().unwrap();
    }
}

#[tauri::command]
fn get_expanded_window_size(window: Window, percent: Option<f64>) -> Result<WindowSize, String> {
    let ratio = percent.unwrap_or(80.0).clamp(40.0, 95.0) / 100.0;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No monitor found for window".to_string())?;
    let work_area = monitor.work_area();
    let width = ((work_area.size.width as f64) * ratio).round() as u32;
    let height = ((work_area.size.height as f64) * ratio).round() as u32;
    Ok(WindowSize {
        width: width.max(640),
        height: height.max(480),
    })
}

#[tauri::command]
fn hide_to_tray(window: Window) {
    let _ = window.hide();
}

#[tauri::command]
async fn open_sticky_note(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("sticky-note").is_some() {
        return Err("Sticky note window already open".to_string());
    }

    let _ = tauri::WebviewWindowBuilder::new(
        &app,
        "sticky-note",
        tauri::WebviewUrl::App("sticky-note.html".into()),
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

fn moodboard_window_offset(app: &tauri::AppHandle) -> (f64, f64) {
    let count = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("moodboard-"))
        .count();
    let n = count as f64;
    (72.0 + n * 32.0, 72.0 + n * 32.0)
}

fn attach_image_resize_handler(window: WebviewWindow, label: String, state: MoodboardImageState) {
    let win = window.clone();
    let label_key = label;
    window.on_window_event(move |event| {
        let WindowEvent::Resized(physical_size) = event else {
            return;
        };

        {
            let correcting = state.0.correcting.lock().unwrap();
            if *correcting.get(&label_key).unwrap_or(&false) {
                return;
            }
        }

        let aspect = {
            let meta = state.0.meta.lock().unwrap();
            meta.get(&label_key).map(|entry| entry.aspect)
        };

        let Some(aspect) = aspect else {
            return;
        };

        let scale = win.scale_factor().unwrap_or(1.0);
        let logical_w = physical_size.width as f64 / scale;
        let logical_h = physical_size.height as f64 / scale;
        let (target_w, target_h) = snap_logical_size(logical_w, logical_h, aspect);

        if (target_w - logical_w).abs() <= 0.5 && (target_h - logical_h).abs() <= 0.5 {
            return;
        }

        {
            let mut correcting = state.0.correcting.lock().unwrap();
            correcting.insert(label_key.clone(), true);
        }

        let _ = apply_logical_size(&win, target_w, target_h);

        {
            let mut correcting = state.0.correcting.lock().unwrap();
            correcting.insert(label_key.clone(), false);
        }
    });
}

#[tauri::command]
async fn open_moodboard_tile(
    app: tauri::AppHandle,
    state: tauri::State<'_, MoodboardImageState>,
    id: String,
    kind: String,
) -> Result<(), String> {
    let label = moodboard_label(&id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let is_image = kind == "image";
    let url = format!("moodboard-tile.html?id={}&kind={}", id, kind);
    let (x, y) = moodboard_window_offset(&app);

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Moodboard")
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(!is_image);

    let is_link = kind == "link";

    if is_image {
        builder = builder
            .inner_size(1.0, 1.0)
            .min_inner_size(IMAGE_MIN_W, IMAGE_MIN_H)
            .resizable(true)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .visible(false);
    } else if is_link {
        builder = builder
            .inner_size(300.0, 368.0)
            .min_inner_size(260.0, 300.0)
            .resizable(true)
            .transparent(false)
            .shadow(true);
    } else {
        builder = builder
            .inner_size(300.0, 200.0)
            .min_inner_size(160.0, 100.0)
            .resizable(true)
            .transparent(false)
            .shadow(true);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
        x,
        y,
    }));

    if is_image {
        configure_pure_image_window(&window);
        attach_image_resize_handler(window, label, state.inner().clone());
    }

    Ok(())
}

#[tauri::command]
async fn init_moodboard_image_tile(
    app: tauri::AppHandle,
    state: tauri::State<'_, MoodboardImageState>,
    id: String,
    natural_width: f64,
    natural_height: f64,
) -> Result<(), String> {
    let label = moodboard_label(&id);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Moodboard window not found: {}", label))?;

    let (width, height) = clamp_initial_image_size(natural_width, natural_height);
    let aspect = width / height;

    {
        let mut meta = state.0.meta.lock().unwrap();
        meta.insert(label.clone(), ImageTileMeta { aspect });
    }

    {
        let mut correcting = state.0.correcting.lock().unwrap();
        correcting.insert(label.clone(), true);
    }

    apply_logical_size(&window, width, height)?;
    configure_pure_image_window(&window);

    {
        let mut correcting = state.0.correcting.lock().unwrap();
        correcting.insert(label.clone(), false);
    }

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let normalized = normalize_http_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("FlashcardsMoodboard/1.0 (+https://github.com/meephub/flashcards-windows)")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    match scrape_link_preview(&client, &normalized).await {
        Ok(preview) => Ok(preview),
        Err(_) => Ok(link_preview::fallback_preview(&normalized, None)),
    }
}

#[tauri::command]
async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let normalized = normalize_http_url(&url)?;
    app.shell()
        .open(normalized, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_moodboard_tile(
    app: tauri::AppHandle,
    state: tauri::State<'_, MoodboardImageState>,
    id: String,
) -> Result<(), String> {
    let label = moodboard_label(&id);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    state.0.meta.lock().unwrap().remove(&label);
    state.0.correcting.lock().unwrap().remove(&label);
    Ok(())
}

#[tauri::command]
async fn close_all_moodboard_tiles(
    app: tauri::AppHandle,
    state: tauri::State<'_, MoodboardImageState>,
) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with("moodboard-") {
            let _ = window.close();
        }
    }
    state.0.meta.lock().unwrap().clear();
    state.0.correcting.lock().unwrap().clear();
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
        .manage(SidecarState(std::sync::Mutex::new(None)))
        .manage(MoodboardImageState::default())
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

            window
                .set_size(Size::Physical(tauri::PhysicalSize {
                    width: 680,
                    height: 600,
                }))
                .unwrap();
            window.center().unwrap();

            #[cfg(target_os = "windows")]
            {
                let _ = apply_acrylic(&window, Some((255, 255, 255, 120)));
            }

            #[cfg(target_os = "macos")]
            {
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
            }

            let ctrl_k = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyK);
            app.global_shortcut().register(ctrl_k).unwrap();

            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&app_data_dir);
                let app_data_str = app_data_dir.to_string_lossy().to_string();

                if let Ok(sidecar_command) = app.shell().sidecar("ai-sidecar") {
                    let sidecar_command = sidecar_command.env("APP_DATA_DIR", &app_data_str);
                    if let Ok((_rx, child)) = sidecar_command.spawn() {
                        let state = app.state::<SidecarState>();
                        *state.0.lock().unwrap() = Some(child);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_size,
            get_expanded_window_size,
            hide_to_tray,
            open_sticky_note,
            open_moodboard_tile,
            init_moodboard_image_tile,
            fetch_link_preview,
            open_external_url,
            close_moodboard_tile,
            close_all_moodboard_tiles
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<SidecarState>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        });
}
