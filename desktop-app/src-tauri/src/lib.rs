use std::{
    collections::HashMap,
    fs,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use enigo::{Coordinate, Enigo, Mouse, Settings};
use image::{codecs::jpeg::JpegEncoder, DynamicImage};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::utils::config::Color;
#[cfg(not(target_os = "macos"))]
use tauri::PhysicalSize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, LogicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use tokio_util::sync::CancellationToken;
use xcap::Monitor;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureResult {
    data_url: String,
    monitor: MonitorInfo,
    capture_rect: Rect,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct JsonRequest {
    url: String,
    headers: HashMap<String, String>,
    body: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PercentTarget {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize)]
struct MousePoint {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Clone, Debug)]
struct MouseTarget {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    fired: bool,
}

struct RequestState {
    next_id: AtomicU64,
    active: Mutex<Option<(u64, CancellationToken)>>,
}
struct SilentState(Mutex<Vec<MouseTarget>>);
struct SilentCursorOffset(Mutex<i32>);
struct SelectionCapture {
    image: image::RgbaImage,
    monitor: MonitorInfo,
}
struct SelectionState(Mutex<Option<SelectionCapture>>);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayStateData {
    targets: Vec<PercentTarget>,
    debug: bool,
    selecting: bool,
    monitor: Option<MonitorInfo>,
    preview_data_url: Option<String>,
}

struct OverlayState(Mutex<OverlayStateData>);
struct ShortcutErrors(Mutex<Vec<String>>);
#[cfg(windows)]
struct NativeDebugWindows(Mutex<Vec<isize>>);

const DEFAULT_SILENT_CURSOR_OFFSET: i32 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsResult {
    target_count: usize,
}

fn error<E: std::fmt::Display>(value: E) -> String {
    value.to_string()
}

fn bottom_right_position(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    window_width: u32,
    window_height: u32,
) -> (i32, i32) {
    const MARGIN: i32 = 16;
    (
        monitor_x + monitor_width as i32 - window_width as i32 - MARGIN,
        monitor_y + monitor_height as i32 - window_height as i32 - MARGIN,
    )
}

fn position_answer_window_bottom_right(app: &AppHandle) -> Result<(), tauri::Error> {
    let Some(window) = app.get_webview_window("answer") else {
        return Ok(());
    };
    let Some(monitor) = app.primary_monitor()? else {
        return Ok(());
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size()?;
    let (x, y) = bottom_right_position(
        monitor_position.x,
        monitor_position.y,
        monitor_size.width,
        monitor_size.height,
        window_size.width,
        window_size.height,
    );
    window.set_position(PhysicalPosition::new(x, y))
}

fn monitor_info(monitor: &Monitor) -> Result<MonitorInfo, String> {
    Ok(MonitorInfo {
        id: monitor.id().map_err(error)?,
        x: monitor.x().map_err(error)?,
        y: monitor.y().map_err(error)?,
        width: monitor.width().map_err(error)?,
        height: monitor.height().map_err(error)?,
        scale_factor: monitor.scale_factor().map_err(error)?,
    })
}

fn image_data_url(image: image::RgbaImage) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
    encoder
        .encode_image(&DynamicImage::ImageRgba8(image))
        .map_err(error)?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

fn pointer_location() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default()).map_err(error)?;
    enigo.location().map_err(error)
}

fn current_monitor() -> Result<Monitor, String> {
    let (x, y) = pointer_location()?;
    Monitor::from_point(x, y).map_err(error)
}

fn physical_crop_rect(
    rect: &Rect,
    monitor: &MonitorInfo,
    image_width: u32,
    image_height: u32,
) -> (u32, u32, u32, u32) {
    let scale = f64::from(monitor.scale_factor.max(1.0));
    let max_width = f64::from(image_width);
    let max_height = f64::from(image_height);
    let x = (rect.x * scale).round().clamp(0.0, max_width - 1.0) as u32;
    let y = (rect.y * scale).round().clamp(0.0, max_height - 1.0) as u32;
    let width = (rect.width * scale)
        .round()
        .clamp(1.0, max_width - f64::from(x)) as u32;
    let height = (rect.height * scale)
        .round()
        .clamp(1.0, max_height - f64::from(y)) as u32;
    (x, y, width, height)
}

#[cfg(target_os = "macos")]
fn capture_rect_from_physical(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    monitor: &MonitorInfo,
) -> Rect {
    let scale = f64::from(monitor.scale_factor.max(1.0));
    Rect {
        x: f64::from(x) / scale,
        y: f64::from(y) / scale,
        width: f64::from(width) / scale,
        height: f64::from(height) / scale,
    }
}

#[cfg(not(target_os = "macos"))]
fn capture_rect_from_physical(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    _monitor: &MonitorInfo,
) -> Rect {
    Rect {
        x: f64::from(x),
        y: f64::from(y),
        width: f64::from(width),
        height: f64::from(height),
    }
}

#[cfg(target_os = "macos")]
fn window_logical_value(value: i32, _monitor: &MonitorInfo) -> f64 {
    f64::from(value)
}

#[cfg(not(target_os = "macos"))]
fn window_logical_value(value: i32, monitor: &MonitorInfo) -> f64 {
    f64::from(value) / f64::from(monitor.scale_factor.max(1.0))
}

#[cfg(target_os = "macos")]
fn overlay_window_position(monitor: &MonitorInfo) -> LogicalPosition<i32> {
    LogicalPosition::new(monitor.x, monitor.y)
}

#[cfg(not(target_os = "macos"))]
fn overlay_window_position(monitor: &MonitorInfo) -> PhysicalPosition<i32> {
    PhysicalPosition::new(monitor.x, monitor.y)
}

#[cfg(target_os = "macos")]
fn overlay_window_size(monitor: &MonitorInfo) -> LogicalSize<u32> {
    LogicalSize::new(monitor.width, monitor.height)
}

#[cfg(not(target_os = "macos"))]
fn overlay_window_size(monitor: &MonitorInfo) -> PhysicalSize<u32> {
    PhysicalSize::new(monitor.width, monitor.height)
}

#[tauri::command]
async fn capture_current_monitor() -> Result<CaptureResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let monitor = current_monitor()?;
        let info = monitor_info(&monitor)?;
        let image = monitor.capture_image().map_err(error)?;
        let capture_rect = Rect {
            x: 0.0,
            y: 0.0,
            width: f64::from(info.width),
            height: f64::from(info.height),
        };
        Ok(CaptureResult {
            data_url: image_data_url(image)?,
            monitor: info,
            capture_rect,
        })
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn capture_region(
    rect: Rect,
    state: State<'_, SelectionState>,
) -> Result<CaptureResult, String> {
    let selection = state
        .0
        .lock()
        .map_err(error)?
        .take()
        .ok_or("没有可用的区域截图")?;
    tauri::async_runtime::spawn_blocking(move || {
        let info = selection.monitor;
        let (x, y, width, height) = physical_crop_rect(
            &rect,
            &info,
            selection.image.width(),
            selection.image.height(),
        );
        let image = image::imageops::crop_imm(&selection.image, x, y, width, height).to_image();
        let capture_rect = capture_rect_from_physical(x, y, width, height, &info);
        Ok(CaptureResult {
            data_url: image_data_url(image)?,
            monitor: info,
            capture_rect,
        })
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn post_json(request: JsonRequest, state: State<'_, RequestState>) -> Result<Value, String> {
    let url = reqwest::Url::parse(&request.url)
        .map_err(|_| "接口地址无效，请填写完整的 HTTPS URL".to_string())?;
    if url.scheme() != "https" {
        return Err("接口地址必须使用 HTTPS".to_string());
    }
    let request_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let token = CancellationToken::new();
    {
        let mut slot = state.active.lock().map_err(error)?;
        if let Some((_, previous)) = slot.take() {
            previous.cancel();
        }
        *slot = Some((request_id, token.clone()));
    }
    let client = Client::new();
    let mut builder = client.post(url).json(&request.body);
    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }
    let response_result = tokio::select! {
      _ = token.cancelled() => Err("已取消".to_string()),
      result = builder.send() => result.map_err(error)
    };
    let clear_active = || {
        if let Ok(mut slot) = state.active.lock() {
            if slot.as_ref().is_some_and(|(id, _)| *id == request_id) {
                slot.take();
            }
        }
    };
    let response = match response_result {
        Ok(response) => response,
        Err(request_error) => {
            clear_active();
            return Err(request_error);
        }
    };
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        clear_active();
        return Err(format!(
            "API 调用失败 ({}): {}",
            status,
            detail.chars().take(300).collect::<String>()
        ));
    }
    let result = response
        .json::<Value>()
        .await
        .map_err(|_| "API 返回内容不是有效的 JSON".to_string());
    clear_active();
    result
}

#[tauri::command]
fn cancel_request(state: State<'_, RequestState>) {
    if let Ok(slot) = state.active.lock() {
        if let Some((_, token)) = slot.as_ref() {
            token.cancel();
        }
    }
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(error)?;
    clipboard.set_text(text).map_err(error)
}

#[tauri::command]
fn mouse_location() -> Result<(i32, i32), String> {
    pointer_location()
}

fn normalize_silent_cursor_offset(value: i32) -> i32 {
    value.clamp(1, 20)
}

fn perform_jitter(point: MousePoint, offset: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(error)?;
    let (original_x, original_y) = enigo.location().map_err(error)?;
    let nudged_x = jitter_x(original_x, &point, offset);
    enigo
        .move_mouse(
            nudged_x,
            original_y.clamp(point.y, point.y + point.height - 1),
            Coordinate::Abs,
        )
        .map_err(error)
}

fn jitter_x(original_x: i32, point: &MousePoint, offset: i32) -> i32 {
    let right = (point.x + point.width - 2).max(point.x);
    (original_x + normalize_silent_cursor_offset(offset))
        .min(right)
        .max(point.x)
}

fn mouse_target(target: &PercentTarget, monitor: &MonitorInfo) -> MouseTarget {
    MouseTarget {
        x: monitor.x + (target.x.clamp(0.0, 1.0) * f64::from(monitor.width)).round() as i32,
        y: monitor.y + (target.y.clamp(0.0, 1.0) * f64::from(monitor.height)).round() as i32,
        width: (target.width.clamp(0.001, 1.0) * f64::from(monitor.width))
            .round()
            .max(8.0) as i32,
        height: (target.height.clamp(0.001, 1.0) * f64::from(monitor.height))
            .round()
            .max(8.0) as i32,
        fired: false,
    }
}

#[tauri::command]
async fn jitter_mouse(point: MousePoint, offset: Option<i32>) -> Result<(), String> {
    let offset = normalize_silent_cursor_offset(offset.unwrap_or(DEFAULT_SILENT_CURSOR_OFFSET));
    tauri::async_runtime::spawn_blocking(move || perform_jitter(point, offset))
        .await
        .map_err(error)?
}

fn create_overlay(app: &AppHandle, monitor: &MonitorInfo) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("overlay") {
        window
            .set_position(overlay_window_position(monitor))
            .map_err(error)?;
        window
            .set_size(overlay_window_size(monitor))
            .map_err(error)?;
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        "overlay",
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("ExamPilot overlay")
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible_on_all_workspaces(true)
    .visible(false)
    .position(
        window_logical_value(monitor.x, monitor),
        window_logical_value(monitor.y, monitor),
    )
    .inner_size(
        window_logical_value(monitor.width as i32, monitor),
        window_logical_value(monitor.height as i32, monitor),
    )
    .build()
    .map_err(error)?;
    window.set_ignore_cursor_events(true).map_err(error)?;
    Ok(window)
}

#[cfg(not(windows))]
fn hide_debug_windows(app: &AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with("debug-target-") {
            window.hide().map_err(error)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn hide_debug_windows(app: &AppHandle) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    let state = app.state::<NativeDebugWindows>();
    for handle in state.0.lock().map_err(error)?.iter().copied() {
        unsafe {
            ShowWindow(handle as *mut _, SW_HIDE);
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn close_debug_windows(app: &AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with("debug-target-") {
            window.close().map_err(error)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn close_debug_windows(app: &AppHandle) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;

    let state = app.state::<NativeDebugWindows>();
    let mut handles = state.0.lock().map_err(error)?;
    for handle in handles.drain(..) {
        unsafe {
            DestroyWindow(handle as *mut _);
        }
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("debug-target-") {
            window.close().map_err(error)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
unsafe extern "system" fn debug_window_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, message, wparam, lparam)
    }
}

#[cfg(windows)]
fn create_native_debug_window(rect: &MouseTarget) -> Result<isize, String> {
    use std::{ptr, sync::OnceLock};
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateEllipticRgn, CreateRectRgn, CreateSolidBrush, DeleteObject, RedrawWindow,
        SetWindowRgn, RDW_ERASE, RDW_INVALIDATE, RDW_UPDATENOW, RGN_DIFF, RGN_OR,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, RegisterClassW, SetLayeredWindowAttributes, SetWindowPos, HWND_TOPMOST,
        LWA_ALPHA, SWP_NOACTIVATE, SWP_SHOWWINDOW, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    };

    static CLASS_READY: OnceLock<Result<(), String>> = OnceLock::new();
    let class_name: Vec<u16> = "ExamPilotNativeTarget\0".encode_utf16().collect();
    match CLASS_READY.get_or_init(|| unsafe {
        let instance = GetModuleHandleW(ptr::null());
        let class = WNDCLASSW {
            lpfnWndProc: Some(debug_window_proc),
            hInstance: instance,
            hbrBackground: CreateSolidBrush(0x0044_44ef),
            lpszClassName: class_name.as_ptr(),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            Err(format!(
                "注册原生命中框失败：{}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }) {
        Ok(()) => {}
        Err(message) => return Err(message.clone()),
    }

    let width = rect.width.max(8);
    let height = rect.height.max(8);
    let title: Vec<u16> = "ExamPilot red target\0".encode_utf16().collect();
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            rect.x,
            rect.y,
            width,
            height,
            ptr::null_mut(),
            ptr::null_mut(),
            GetModuleHandleW(ptr::null()),
            ptr::null(),
        )
    };
    if hwnd.is_null() {
        return Err(format!(
            "创建原生命中框失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    unsafe {
        let outer = CreateRectRgn(0, 0, width, height);
        let inner = CreateRectRgn(2, 2, (width - 2).max(2), (height - 2).max(2));
        let center =
            CreateEllipticRgn(width / 2 - 5, height / 2 - 5, width / 2 + 5, height / 2 + 5);
        CombineRgn(outer, outer, inner, RGN_DIFF);
        CombineRgn(outer, outer, center, RGN_OR);
        DeleteObject(inner);
        DeleteObject(center);
        if SetWindowRgn(hwnd, outer, 1) == 0 {
            DeleteObject(outer);
            return Err(format!(
                "设置原生命中框形状失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        SetLayeredWindowAttributes(hwnd, 0, 230, LWA_ALPHA);
        if SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            rect.x,
            rect.y,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err(format!(
                "显示原生命中框失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        RedrawWindow(
            hwnd,
            ptr::null(),
            ptr::null_mut(),
            RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW,
        );
    }
    Ok(hwnd as isize)
}

#[cfg(not(windows))]
fn show_debug_windows(
    app: &AppHandle,
    targets: &[PercentTarget],
    monitor: &MonitorInfo,
) -> Result<(), String> {
    hide_debug_windows(app)?;
    for (index, target) in targets.iter().enumerate() {
        let rect = mouse_target(target, monitor);
        let label = format!("debug-target-{}", index);
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App("index.html?window=debug".into()),
        )
        .title("ExamPilot debug target")
        .decorations(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .resizable(false)
        .shadow(false)
        .visible_on_all_workspaces(true)
        .visible(true)
        .position(
            window_logical_value(rect.x, monitor),
            window_logical_value(rect.y, monitor),
        )
        .inner_size(
            window_logical_value(rect.width.max(8), monitor),
            window_logical_value(rect.height.max(8), monitor),
        )
        .build()
        .map_err(error)?;
        window.set_ignore_cursor_events(true).map_err(error)?;
    }
    Ok(())
}

#[cfg(windows)]
fn show_debug_windows(
    app: &AppHandle,
    targets: &[PercentTarget],
    monitor: &MonitorInfo,
) -> Result<(), String> {
    close_debug_windows(app)?;
    let mut handles = Vec::with_capacity(targets.len());
    for target in targets {
        let rect = mouse_target(target, monitor);
        match create_native_debug_window(&rect) {
            Ok(handle) => handles.push(handle),
            Err(message) => {
                for handle in handles.drain(..) {
                    unsafe {
                        windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(
                            handle as *mut _,
                        );
                    }
                }
                return Err(message);
            }
        }
    }
    *app.state::<NativeDebugWindows>().0.lock().map_err(error)? = handles;
    Ok(())
}

#[tauri::command]
fn set_overlay_targets(
    app: AppHandle,
    targets: Vec<PercentTarget>,
    monitor: MonitorInfo,
    debug: bool,
    state: State<'_, SilentState>,
) -> Result<(), String> {
    let native_targets = targets
        .iter()
        .map(|target| mouse_target(target, &monitor))
        .collect();
    *state.0.lock().map_err(error)? = native_targets;
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData {
        targets: targets.clone(),
        debug,
        selecting: false,
        monitor: Some(monitor.clone()),
        preview_data_url: None,
    };
    hide_debug_windows(&app)?;
    if debug {
        show_debug_windows(&app, &targets, &monitor)?;
    }
    Ok(())
}

#[tauri::command]
fn set_overlay_debug(
    app: AppHandle,
    debug: bool,
    state: State<'_, OverlayState>,
) -> Result<(), String> {
    let overlay_state = {
        let mut stored = state.0.lock().map_err(error)?;
        stored.debug = debug;
        stored.clone()
    };
    if !debug {
        hide_debug_windows(&app)?;
        return Ok(());
    }
    let Some(monitor) = overlay_state.monitor else {
        return Ok(());
    };
    if overlay_state.targets.is_empty() {
        return Ok(());
    }
    show_debug_windows(&app, &overlay_state.targets, &monitor)
}

#[tauri::command]
fn apply_silent_settings(
    app: AppHandle,
    silent_mode_enabled: bool,
    silent_debug_frame_enabled: bool,
    silent_cursor_offset: i32,
    cursor_offset: State<'_, SilentCursorOffset>,
) -> Result<RuntimeSettingsResult, String> {
    *cursor_offset.0.lock().map_err(error)? = normalize_silent_cursor_offset(silent_cursor_offset);
    if !silent_mode_enabled {
        app.state::<SilentState>().0.lock().map_err(error)?.clear();
        *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
        hide_debug_windows(&app)?;
        if let Some(window) = app.get_webview_window("answer") {
            window.show().map_err(error)?;
            window.set_always_on_top(true).map_err(error)?;
            window.set_visible_on_all_workspaces(true).map_err(error)?;
        }
        return Ok(RuntimeSettingsResult { target_count: 0 });
    }

    if let Some(window) = app.get_webview_window("answer") {
        window.hide().map_err(error)?;
    }
    let overlay_state_handle = app.state::<OverlayState>();
    let overlay_state = {
        let mut stored = overlay_state_handle.0.lock().map_err(error)?;
        stored.debug = silent_debug_frame_enabled;
        stored.clone()
    };
    hide_debug_windows(&app)?;
    if silent_debug_frame_enabled {
        if let Some(monitor) = &overlay_state.monitor {
            if !overlay_state.targets.is_empty() {
                show_debug_windows(&app, &overlay_state.targets, monitor)?;
            }
        }
    }
    Ok(RuntimeSettingsResult {
        target_count: overlay_state.targets.len(),
    })
}

#[tauri::command]
fn clear_overlay_targets(app: AppHandle, state: State<'_, SilentState>) -> Result<(), String> {
    state.0.lock().map_err(error)?.clear();
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
    close_debug_windows(&app)?;
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
async fn begin_region_selection(
    app: AppHandle,
    selection: State<'_, SelectionState>,
) -> Result<MonitorInfo, String> {
    hide_capture_windows(&app)?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let (image, info, preview_data_url) = tauri::async_runtime::spawn_blocking(|| {
        let monitor = current_monitor()?;
        let info = monitor_info(&monitor)?;
        let image = monitor.capture_image().map_err(error)?;
        let preview_data_url = image_data_url(image.clone())?;
        Ok::<_, String>((image, info, preview_data_url))
    })
    .await
    .map_err(error)??;
    *selection.0.lock().map_err(error)? = Some(SelectionCapture {
        image,
        monitor: info.clone(),
    });
    let overlay = create_overlay(&app, &info)?;
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData {
        targets: Vec::new(),
        debug: false,
        selecting: true,
        monitor: Some(info.clone()),
        preview_data_url: Some(preview_data_url),
    };
    overlay.emit("region-selection", &info).map_err(error)?;
    overlay.show().map_err(error)?;
    overlay.set_focus().map_err(error)?;
    Ok(info)
}

#[tauri::command]
fn overlay_ready(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    let overlay_state = state.0.lock().map_err(error)?.clone();
    if !overlay_state.selecting {
        return Ok(());
    }
    let overlay = app.get_webview_window("overlay").ok_or("选区窗口不存在")?;
    overlay
        .set_ignore_cursor_events(!overlay_state.selecting)
        .map_err(error)?;
    overlay.show().map_err(error)?;
    if overlay_state.selecting {
        overlay.set_focus().map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
fn finish_region_selection(
    app: AppHandle,
    selection: State<'_, SelectionState>,
) -> Result<(), String> {
    selection.0.lock().map_err(error)?.take();
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
    if let Some(window) = app.get_webview_window("overlay") {
        window.set_ignore_cursor_events(true).map_err(error)?;
        window.hide().map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
fn get_overlay_state(state: State<'_, OverlayState>) -> Result<OverlayStateData, String> {
    state.0.lock().map(|value| value.clone()).map_err(error)
}

#[tauri::command]
fn get_shortcut_errors(state: State<'_, ShortcutErrors>) -> Result<Vec<String>, String> {
    state.0.lock().map(|value| value.clone()).map_err(error)
}

fn hide_capture_windows(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("answer") {
        window.hide().map_err(error)?;
    }
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(error)?;
    }
    hide_debug_windows(app)?;
    Ok(())
}

#[tauri::command]
fn hide_capture_ui(app: AppHandle) -> Result<(), String> {
    hide_capture_windows(&app)
}

#[tauri::command]
fn show_answer_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("answer").ok_or("答案窗口不存在")?;
    window.show().map_err(error)?;
    window.set_always_on_top(true).map_err(error)?;
    window.set_visible_on_all_workspaces(true).map_err(error)
}

#[tauri::command]
fn hide_answer_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("answer").ok_or("答案窗口不存在")?;
    window.hide().map_err(error)
}

#[tauri::command]
fn set_answer_opacity(_app: AppHandle, _opacity: f64) -> Result<(), String> {
    // Tauri has no cross-platform native opacity setter. The HUD owns opacity in CSS.
    Ok(())
}

#[tauri::command]
fn read_settings_backup(path: String) -> Result<Value, String> {
    serde_json::from_str(&fs::read_to_string(path).map_err(error)?).map_err(error)
}

#[tauri::command]
fn write_settings_backup(path: String, settings: Value) -> Result<(), String> {
    let output = serde_json::to_string_pretty(&settings).map_err(error)?;
    fs::write(path, output).map_err(error)
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn start_hover_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut entered_at: Option<Instant> = None;
        let mut active: Option<usize> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let location = tauri::async_runtime::spawn_blocking(pointer_location)
                .await
                .ok()
                .and_then(Result::ok);
            let Some((mouse_x, mouse_y)) = location else {
                continue;
            };
            let target = app
                .state::<SilentState>()
                .0
                .lock()
                .ok()
                .and_then(|targets| {
                    targets.iter().position(|item| {
                        mouse_x >= item.x
                            && mouse_x < item.x + item.width
                            && mouse_y >= item.y
                            && mouse_y < item.y + item.height
                    })
                });
            if target != active {
                if let Some(previous) = active {
                    if let Ok(mut targets) = app.state::<SilentState>().0.lock() {
                        if let Some(item) = targets.get_mut(previous) {
                            item.fired = false;
                        }
                    }
                }
                active = target;
                entered_at = active.map(|_| Instant::now());
            }
            if let (Some(index), Some(start)) = (active, entered_at) {
                if start.elapsed() < Duration::from_millis(350) {
                    continue;
                }
                let point = app
                    .state::<SilentState>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut targets| {
                        let item = targets.get_mut(index)?;
                        if item.fired {
                            return None;
                        }
                        item.fired = true;
                        Some(MousePoint {
                            x: item.x,
                            y: item.y,
                            width: item.width,
                            height: item.height,
                        })
                    });
                if let Some(point) = point {
                    let offset = app
                        .state::<SilentCursorOffset>()
                        .0
                        .lock()
                        .map(|value| *value)
                        .unwrap_or(DEFAULT_SILENT_CURSOR_OFFSET);
                    let _ =
                        tauri::async_runtime::spawn_blocking(move || perform_jitter(point, offset))
                            .await;
                    let _ = app.emit("silent-triggered", ());
                }
            }
        }
    });
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RequestState {
            next_id: AtomicU64::new(1),
            active: Mutex::new(None),
        })
        .manage(SilentState(Mutex::new(Vec::new())))
        .manage(SilentCursorOffset(Mutex::new(DEFAULT_SILENT_CURSOR_OFFSET)))
        .manage(SelectionState(Mutex::new(None)))
        .manage(OverlayState(Mutex::new(OverlayStateData::default())))
        .manage(ShortcutErrors(Mutex::new(Vec::new())));
    #[cfg(windows)]
    let builder = builder.manage(NativeDebugWindows(Mutex::new(Vec::new())));
    builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
                    let event_name = if shortcut.matches(modifiers, Code::Digit1) {
                        "shortcut-capture-full"
                    } else if shortcut.matches(modifiers, Code::Digit2) {
                        "shortcut-capture-region"
                    } else if shortcut.matches(modifiers, Code::Digit3) {
                        "shortcut-switch-config"
                    } else if shortcut.matches(modifiers, Code::Digit4) {
                        "shortcut-clear"
                    } else {
                        return;
                    };
                    let _ = app.emit(event_name, ());
                })
                .build(),
        )
        .setup(|app| {
            if let Some(answer) = app.get_webview_window("answer") {
                answer.set_focusable(false)?;
            }
            position_answer_window_bottom_right(app.handle())?;
            let settings = WebviewWindowBuilder::new(
                app.handle(),
                "settings",
                WebviewUrl::App("index.html?window=settings".into()),
            )
            .title("ExamPilot 设置")
            .inner_size(760.0, 760.0)
            .min_inner_size(620.0, 560.0)
            .visible(false)
            .build()?;
            settings.set_visible_on_all_workspaces(true)?;
            let open_settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_settings, &quit])?;
            TrayIconBuilder::with_id("exampilot")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("application icon is required"),
                )
                .tooltip("ExamPilot")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => show_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            for shortcut in [
                "CTRL+SHIFT+1",
                "CTRL+SHIFT+2",
                "CTRL+SHIFT+3",
                "CTRL+SHIFT+4",
            ] {
                if let Err(register_error) = app.global_shortcut().register(shortcut) {
                    let message = format!("{} 无法注册: {}", shortcut, register_error);
                    eprintln!("{}", message);
                    app.state::<ShortcutErrors>()
                        .0
                        .lock()
                        .map_err(|_| "快捷键状态锁不可用")?
                        .push(message);
                }
            }
            start_hover_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_current_monitor,
            capture_region,
            post_json,
            cancel_request,
            copy_text,
            mouse_location,
            jitter_mouse,
            set_overlay_targets,
            set_overlay_debug,
            apply_silent_settings,
            clear_overlay_targets,
            begin_region_selection,
            finish_region_selection,
            overlay_ready,
            hide_capture_ui,
            get_overlay_state,
            get_shortcut_errors,
            show_answer_window,
            hide_answer_window,
            set_answer_opacity,
            read_settings_backup,
            write_settings_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running ExamPilot desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_target_maps_to_physical_monitor_coordinates() {
        let monitor = MonitorInfo {
            id: 1,
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        let target = mouse_target(
            &PercentTarget {
                x: 0.5,
                y: 0.25,
                width: 0.2,
                height: 0.1,
            },
            &monitor,
        );
        assert_eq!(target.x, -960);
        assert_eq!(target.y, 270);
        assert_eq!(target.width, 384);
        assert_eq!(target.height, 108);
    }

    #[test]
    fn jitter_stays_inside_the_target() {
        let point = MousePoint {
            x: 100,
            y: 200,
            width: 8,
            height: 24,
        };
        assert_eq!(jitter_x(106, &point, 5), 106);
        assert_eq!(jitter_x(96, &point, 5), 101);
        assert_eq!(jitter_x(96, &point, 20), 106);
    }

    #[test]
    fn cursor_offset_is_clamped_to_the_supported_range() {
        assert_eq!(normalize_silent_cursor_offset(-1), 1);
        assert_eq!(normalize_silent_cursor_offset(5), 5);
        assert_eq!(normalize_silent_cursor_offset(99), 20);
    }

    #[test]
    fn region_crop_is_scaled_and_clamped_to_the_monitor() {
        let monitor = MonitorInfo {
            id: 1,
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
            scale_factor: 2.0,
        };
        assert_eq!(
            physical_crop_rect(
                &Rect {
                    x: 100.0,
                    y: 50.0,
                    width: 400.0,
                    height: 300.0
                },
                &monitor,
                3840,
                2160
            ),
            (200, 100, 800, 600)
        );
        assert_eq!(
            physical_crop_rect(
                &Rect {
                    x: 1900.0,
                    y: 1000.0,
                    width: 400.0,
                    height: 300.0
                },
                &monitor,
                3840,
                2160
            ),
            (3800, 2000, 40, 160)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_logical_screen_coordinates_for_overlays() {
        let monitor = MonitorInfo {
            id: 1,
            x: -1512,
            y: 0,
            width: 1512,
            height: 982,
            scale_factor: 2.0,
        };
        assert_eq!(window_logical_value(756, &monitor), 756.0);
        assert_eq!(overlay_window_position(&monitor).x, -1512);
        assert_eq!(overlay_window_size(&monitor).width, 1512);
        assert_eq!(
            physical_crop_rect(
                &Rect {
                    x: 756.0,
                    y: 491.0,
                    width: 100.0,
                    height: 50.0,
                },
                &monitor,
                3024,
                1964,
            ),
            (1512, 982, 200, 100)
        );
        let rect = capture_rect_from_physical(1512, 982, 200, 100, &monitor);
        assert_eq!(rect.x, 756.0);
        assert_eq!(rect.y, 491.0);
        assert_eq!(rect.width, 100.0);
        assert_eq!(rect.height, 50.0);
    }

    #[test]
    fn answer_window_defaults_to_bottom_right_with_a_margin() {
        assert_eq!(
            bottom_right_position(0, 0, 1920, 1080, 360, 180),
            (1544, 884)
        );
        assert_eq!(
            bottom_right_position(-1920, 0, 1920, 1080, 360, 180),
            (-376, 884)
        );
    }
}
