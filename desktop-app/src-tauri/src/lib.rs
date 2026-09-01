//! ExamPilot 桌面端核心逻辑（Rust 原生层）。
//!
//! 职责：
//! - 答题窗口（透明置顶 HUD）、设置窗口与系统托盘的生命周期管理
//! - 全局快捷键注册与事件分发（含 Windows 小键盘原生兜底）
//! - 原生截屏：整屏截取 / 区域选择，处理多显示器与高 DPI 坐标换算
//! - 静默模式：命中区监控、真实光标微移（jitter）触发截图
//! - Rust 侧 HTTPS 请求（post_json）与请求取消（CancellationToken）
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
#[cfg(not(target_os = "macos"))]
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
    WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, LogicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio_util::sync::CancellationToken;
use xcap::Monitor;

/// 显示器信息：物理像素坐标/尺寸与 DPI 缩放系数。
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

/// 截屏结果：JPEG data URL + 所在显示器信息 + 实际截取区域。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureResult {
    data_url: String,
    monitor: MonitorInfo,
    capture_rect: Rect,
}

/// 矩形区域（返回给前端时：macOS 为逻辑坐标，Windows 为物理像素）。
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Rust 侧 POST 请求参数：目标 URL、自定义请求头与 JSON 请求体。
#[derive(Clone, Debug, Deserialize, Serialize)]
struct JsonRequest {
    url: String,
    headers: HashMap<String, String>,
    body: Value,
}

/// 以显示器宽高比例（0.0~1.0）表示的命中区，跨分辨率通用。
#[derive(Clone, Debug, Deserialize, Serialize)]
struct PercentTarget {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 单次光标微移的参数：物理像素命中区矩形。
#[derive(Clone, Debug, Deserialize)]
struct MousePoint {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// 已换算为物理像素的命中区；fired 标记本次悬停是否已触发过。
#[derive(Clone, Debug)]
struct MouseTarget {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    fired: bool,
}

/// HTTP 请求状态：自增请求 ID + 当前活跃请求的取消令牌（同时只保留一个）。
struct RequestState {
    next_id: AtomicU64,
    active: Mutex<Option<(u64, CancellationToken)>>,
}
/// 静默模式命中区列表（物理像素），由悬停监控循环消费。
struct SilentState(Mutex<Vec<MouseTarget>>);
/// 静默模式总开关。
struct SilentModeState(Mutex<bool>);
/// 静默模式光标微移偏移量（像素），钳制在 1..=20。
struct SilentCursorOffset(Mutex<i32>);
/// 区域选择时缓存的整屏截图与所在显示器。
struct SelectionCapture {
    image: image::RgbaImage,
    monitor: MonitorInfo,
}
/// 区域截图缓存（None 表示没有进行中的区域选择）。
struct SelectionState(Mutex<Option<SelectionCapture>>);
/// 键盘区域截图：按下 Ctrl+Shift+2 时记录起点，松开时以终点完成截图。
struct KeyboardRegionSelectionState {
    active: Mutex<Option<KeyboardRegionSelection>>,
    generation: AtomicU64,
}

struct KeyboardRegionSelection {
    start: (i32, i32),
    started_at: Instant,
    generation: u64,
}

/// 覆盖层窗口的展示状态，前端通过 get_overlay_state 拉取。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayStateData {
    targets: Vec<PercentTarget>,
    debug: bool,
    selecting: bool,
    monitor: Option<MonitorInfo>,
}

/// 覆盖层状态的共享容器。
struct OverlayState(Mutex<OverlayStateData>);
/// 区域选择期间临时注册的 Esc 快捷键状态。
struct RegionSelectionEscapeState(Mutex<bool>);
/// 全局快捷键注册失败信息列表，供设置页展示。
struct ShortcutErrors(Mutex<Vec<String>>);
/// 答案内容溢出时临时注册的上下滚动快捷键状态。
struct AnswerScrollKeysState(Mutex<bool>);
/// Windows 原生调试命中框的 HWND 列表。
#[cfg(windows)]
struct NativeDebugWindows(Mutex<Vec<isize>>);

/// 静默模式光标微移的默认偏移量（像素）。
const DEFAULT_SILENT_CURSOR_OFFSET: i32 = 5;

/// 全局快捷键的主修饰键：统一为 Ctrl，配合 Shift 使用。
const PRIMARY_SHORTCUT_MODIFIER: Modifiers = Modifiers::CONTROL;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsResult {
    target_count: usize,
}

/// 将任意错误统一转为 String，便于 Tauri command 返回。
fn error<E: std::fmt::Display>(value: E) -> String {
    value.to_string()
}

/// 计算窗口在指定显示器右下角（留 16px 边距）的物理像素位置。
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

/// 将答题窗口摆到主显示器右下角。
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

/// 从 xcap Monitor 提取显示器信息（出错统一转 String）。
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

/// 将 RGBA 图像编码为 90% 质量的 JPEG data URL。
fn image_data_url(image: image::RgbaImage) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
    encoder
        .encode_image(&DynamicImage::ImageRgba8(image))
        .map_err(error)?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// 读取当前鼠标物理坐标（macOS：CGEvent）。
#[cfg(target_os = "macos")]
fn pointer_location() -> Result<(i32, i32), String> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // Reading the pointer does not require Accessibility permission. Keep that
    // permission limited to the silent-mode mouse movement path.
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "无法创建 macOS 鼠标事件源".to_string())?;
    let event = CGEvent::new(source).map_err(|_| "无法读取 macOS 鼠标位置".to_string())?;
    let location = event.location();
    Ok((location.x.round() as i32, location.y.round() as i32))
}

/// 读取当前鼠标物理坐标（非 macOS：enigo）。
#[cfg(not(target_os = "macos"))]
fn pointer_location() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default()).map_err(error)?;
    enigo.location().map_err(error)
}

/// 返回鼠标当前所在的显示器。
fn current_monitor() -> Result<Monitor, String> {
    let (x, y) = pointer_location()?;
    Monitor::from_point(x, y).map_err(error)
}

/// 将逻辑坐标矩形换算为截图图像上的物理像素裁剪区（乘 DPI 缩放并钳制在图像范围内）。
fn physical_crop_rect(
    rect: &Rect,
    monitor: &MonitorInfo,
    image_width: u32,
    image_height: u32,
) -> (u32, u32, u32, u32) {
    // 逻辑坐标 -> 物理像素
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

/// 物理像素裁剪区转回逻辑坐标（macOS 前端使用逻辑坐标）。
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

/// 将两个全局屏幕坐标换算成某块显示器内的选区坐标。
/// macOS 的屏幕坐标已经是逻辑坐标；Windows 的屏幕坐标是物理像素，
/// 必须先除以 DPI，避免 physical_crop_rect 再次缩放。
fn region_rect_from_screen_points(
    start: (i32, i32),
    end: (i32, i32),
    monitor: &MonitorInfo,
) -> Rect {
    let monitor_width = i64::from(monitor.width);
    let monitor_height = i64::from(monitor.height);
    let start_x = (i64::from(start.0) - i64::from(monitor.x)).clamp(0, monitor_width);
    let start_y = (i64::from(start.1) - i64::from(monitor.y)).clamp(0, monitor_height);
    let end_x = (i64::from(end.0) - i64::from(monitor.x)).clamp(0, monitor_width);
    let end_y = (i64::from(end.1) - i64::from(monitor.y)).clamp(0, monitor_height);
    let physical_rect = Rect {
        x: start_x.min(end_x) as f64,
        y: start_y.min(end_y) as f64,
        width: (start_x - end_x).unsigned_abs() as f64,
        height: (start_y - end_y).unsigned_abs() as f64,
    };
    #[cfg(windows)]
    {
        let scale = f64::from(monitor.scale_factor.max(1.0));
        return Rect {
            x: physical_rect.x / scale,
            y: physical_rect.y / scale,
            width: physical_rect.width / scale,
            height: physical_rect.height / scale,
        };
    }
    #[cfg(not(windows))]
    {
        physical_rect
    }
}

/// 非 macOS（Windows/Linux）屏幕坐标即物理像素，原样返回。
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

/// macOS 屏幕坐标本身即逻辑值，原样返回。
#[cfg(target_os = "macos")]
fn window_logical_value(value: i32, _monitor: &MonitorInfo) -> f64 {
    f64::from(value)
}

/// 将物理像素换算为逻辑坐标（除以 DPI 缩放），供窗口定位使用。
#[cfg(not(target_os = "macos"))]
fn window_logical_value(value: i32, monitor: &MonitorInfo) -> f64 {
    f64::from(value) / f64::from(monitor.scale_factor.max(1.0))
}

/// 覆盖层窗口位置：macOS 用逻辑坐标。
#[cfg(target_os = "macos")]
fn overlay_window_position(monitor: &MonitorInfo) -> LogicalPosition<i32> {
    LogicalPosition::new(monitor.x, monitor.y)
}

/// 覆盖层窗口位置：Windows/Linux 用物理坐标。
#[cfg(not(target_os = "macos"))]
fn overlay_window_position(monitor: &MonitorInfo) -> PhysicalPosition<i32> {
    PhysicalPosition::new(monitor.x, monitor.y)
}

/// 覆盖层窗口尺寸：macOS 用逻辑尺寸。
#[cfg(target_os = "macos")]
fn overlay_window_size(monitor: &MonitorInfo) -> LogicalSize<u32> {
    LogicalSize::new(monitor.width, monitor.height)
}

/// 覆盖层窗口尺寸：Windows/Linux 用物理尺寸。
#[cfg(not(target_os = "macos"))]
fn overlay_window_size(monitor: &MonitorInfo) -> PhysicalSize<u32> {
    PhysicalSize::new(monitor.width, monitor.height)
}

/// 截取鼠标所在显示器的整屏。
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

/// 从缓存的整屏截图中裁出前端选定的区域。
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

/// 在 Rust 侧发起 POST 请求（规避前端 CORS 限制），仅允许 HTTPS。
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
        // 新请求会取消上一个仍在进行的请求（同一时刻只保留一个活跃请求）。
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
    // 响应到达或收到取消信号，谁先完成用谁。
    let response_result = tokio::select! {
      _ = token.cancelled() => Err("已取消".to_string()),
      result = builder.send() => result.map_err(error)
    };
    // 仅当活跃槽仍是本请求时才清空，避免误删后续新请求的令牌。
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

/// 取消当前进行中的 post_json 请求。
#[tauri::command]
fn cancel_request(state: State<'_, RequestState>) {
    if let Ok(slot) = state.active.lock() {
        if let Some((_, token)) = slot.as_ref() {
            token.cancel();
        }
    }
}

/// 将文本写入系统剪贴板。
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(error)?;
    clipboard.set_text(text).map_err(error)
}

/// 返回当前鼠标物理坐标。
#[tauri::command]
fn mouse_location() -> Result<(i32, i32), String> {
    pointer_location()
}

/// 将光标微移偏移钳制到 1..=20 像素，避免移动过小或过大。
fn normalize_silent_cursor_offset(value: i32) -> i32 {
    value.clamp(1, 20)
}

/// macOS：用 CGEvent 把真实光标移入命中区（需要辅助功能权限）。
#[cfg(target_os = "macos")]
fn perform_jitter(point: MousePoint, offset: i32) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventType, CGMouseButton};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "无法创建 macOS 鼠标事件源".to_string())?;
    let current = CGEvent::new(source.clone())
        .map_err(|_| "无法读取 macOS 鼠标位置".to_string())?
        .location();
    let original_x = current.x.round() as i32;
    let original_y = current.y.round() as i32;
    let nudged_x = jitter_x(original_x, &point, offset);
    let nudged_y = original_y.clamp(point.y, point.y + point.height - 1);
    let event = CGEvent::new_mouse_event(
        source,
        CGEventType::MouseMoved,
        CGPoint::new(nudged_x as f64, nudged_y as f64),
        CGMouseButton::Left,
    )
    .map_err(|_| "无法创建 macOS 鼠标移动事件".to_string())?;
    event.post(core_graphics::event::CGEventTapLocation::HID);
    Ok(())
}

/// 非 macOS：用 enigo 把真实光标移入命中区。
#[cfg(not(target_os = "macos"))]
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
        .map_err(error)?;
    Ok(())
}

/// 计算微移后的 X 坐标：向右偏移 offset，并钳制在命中区内（右边界内收 2px 防滑出）。
fn jitter_x(original_x: i32, point: &MousePoint, offset: i32) -> i32 {
    let right = (point.x + point.width - 2).max(point.x);
    (original_x + normalize_silent_cursor_offset(offset))
        .min(right)
        .max(point.x)
}

/// 将比例命中区映射为指定显示器上的物理像素矩形，并钳制在显示器范围内。
fn mouse_target(target: &PercentTarget, monitor: &MonitorInfo) -> MouseTarget {
    let monitor_width = monitor.width.max(1).min(i32::MAX as u32) as i32;
    let monitor_height = monitor.height.max(1).min(i32::MAX as u32) as i32;
    // 最小 8px，保证区域可被命中。
    let width = (target.width.clamp(0.001, 1.0) * f64::from(monitor.width))
        .round()
        .max(8.0)
        .min(f64::from(monitor_width)) as i32;
    let height = (target.height.clamp(0.001, 1.0) * f64::from(monitor.height))
        .round()
        .max(8.0)
        .min(f64::from(monitor_height)) as i32;
    let x = monitor
        .x
        .saturating_add((target.x.clamp(0.0, 1.0) * f64::from(monitor.width)).round() as i32)
        .clamp(monitor.x, monitor.x.saturating_add(monitor_width - width));
    let y = monitor
        .y
        .saturating_add((target.y.clamp(0.0, 1.0) * f64::from(monitor.height)).round() as i32)
        .clamp(monitor.y, monitor.y.saturating_add(monitor_height - height));
    MouseTarget {
        x,
        y,
        width,
        height,
        fired: false,
    }
}

/// 手动触发一次光标微移（offset 缺省时用默认值）。
#[tauri::command]
async fn jitter_mouse(point: MousePoint, offset: Option<i32>) -> Result<(), String> {
    let offset = normalize_silent_cursor_offset(offset.unwrap_or(DEFAULT_SILENT_CURSOR_OFFSET));
    tauri::async_runtime::spawn_blocking(move || perform_jitter(point, offset))
        .await
        .map_err(error)?
}

/// 创建（或复用）全屏透明的选区覆盖层窗口，位置/尺寸随目标显示器与 DPI 适配。
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
    // 覆盖层需要接收鼠标事件，但不能激活窗口，否则会让用户当前操作的应用失焦。
    .focusable(false)
    // On Windows an undecorated but resizable window keeps the invisible
    // WS_THICKFRAME resize border, which insets the webview client area and
    // shifts the mask away from the screen's left/top edge. The overlay never
    // resizes by dragging, so disable both the resize border and the shadow.
    .resizable(false)
    .shadow(false)
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

/// 显示选区覆盖层但不激活 ExamPilot（macOS 的 `show` 会调用 makeKeyAndOrderFront）。
#[cfg(target_os = "macos")]
fn show_overlay_window(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(error)? as usize;
    app.run_on_main_thread(move || unsafe {
        let window = &*(ns_window as *mut objc2_app_kit::NSWindow);
        window.orderFrontRegardless();
    })
    .map_err(error)
}

#[cfg(not(target_os = "macos"))]
fn show_overlay_window(_app: &AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(error)
}

/// 隐藏 debug-target-* 调试窗口（非 Windows：遍历 webview 窗口）。
#[cfg(not(windows))]
fn hide_debug_windows(app: &AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with("debug-target-") {
            window.hide().map_err(error)?;
        }
    }
    Ok(())
}

/// 隐藏 Windows 原生调试命中框（直接对 HWND 调 ShowWindow）。
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

/// 关闭 debug-target-* 调试窗口（非 Windows：遍历 webview 窗口）。
#[cfg(not(windows))]
fn close_debug_windows(app: &AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with("debug-target-") {
            window.close().map_err(error)?;
        }
    }
    Ok(())
}

/// 销毁 Windows 原生调试命中框并关闭残余 webview 调试窗口。
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

/// 原生调试框的默认窗口过程（无自定义消息处理）。
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

/// 在 Windows 上创建原生调试命中框：分层透明置顶窗口，用区域剪裁画出边框 + 中心圆点。
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

/// 显示调试命中框（非 Windows：每个命中区一个透明 webview 窗口）。
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

/// 显示调试命中框（Windows：原生分层窗口；中途失败会回滚已创建的窗口）。
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

/// 保存前端下发的命中区：同时更新静默监控目标与 overlay 状态，debug 时显示调试框。
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
    };
    hide_debug_windows(&app)?;
    if debug {
        show_debug_windows(&app, &targets, &monitor)?;
    }
    Ok(())
}

/// 切换调试命中框的显示开关。
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

/// 应用静默模式设置：更新开关与光标偏移，并按需显隐答题窗口与调试框。
#[tauri::command]
fn apply_silent_settings(
    app: AppHandle,
    silent_mode_enabled: bool,
    silent_debug_frame_enabled: bool,
    silent_cursor_offset: i32,
    cursor_offset: State<'_, SilentCursorOffset>,
) -> Result<RuntimeSettingsResult, String> {
    *app.state::<SilentModeState>().0.lock().map_err(error)? = silent_mode_enabled;
    *cursor_offset.0.lock().map_err(error)? = normalize_silent_cursor_offset(silent_cursor_offset);
    if !silent_mode_enabled {
        app.state::<SilentState>().0.lock().map_err(error)?.clear();
        *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
        hide_debug_windows(&app)?;
        show_answer_window(app.clone())?;
        return Ok(RuntimeSettingsResult { target_count: 0 });
    }

    hide_answer_window(app.clone())?;
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

/// 清空全部命中区并隐藏覆盖层与调试框。
#[tauri::command]
fn clear_overlay_targets(app: AppHandle, state: State<'_, SilentState>) -> Result<(), String> {
    let _ = update_region_selection_escape(&app, false);
    let keyboard_selection = app.state::<KeyboardRegionSelectionState>();
    keyboard_selection
        .generation
        .fetch_add(1, Ordering::Relaxed);
    keyboard_selection.active.lock().map_err(error)?.take();
    state.0.lock().map_err(error)?.clear();
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
    close_debug_windows(&app)?;
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(error)?;
    }
    Ok(())
}

/// 快捷键区域截图开始时仅隐藏 ExamPilot 自身窗口并记录鼠标起点。
/// 这里不能调用会注销全局快捷键的逻辑，避免在快捷键回调中发生阻塞。
fn begin_keyboard_region_selection(app: &AppHandle) -> Result<(), String> {
    let start = pointer_location()?;
    if let Some(window) = app.get_webview_window("answer") {
        window.hide().map_err(error)?;
        let _ = app.emit("answer-window-hidden", ());
    }
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(error)?;
    }
    hide_debug_windows(app)?;

    let state = app.state::<KeyboardRegionSelectionState>();
    let generation = state.generation.fetch_add(1, Ordering::Relaxed) + 1;
    *state.active.lock().map_err(error)? = Some(KeyboardRegionSelection {
        start,
        started_at: Instant::now(),
        generation,
    });
    Ok(())
}

/// 释放 Ctrl+Shift+2 后，按两个鼠标位置在起点所在显示器截取矩形区域。
fn finish_keyboard_region_selection(app: &AppHandle) {
    let state = app.state::<KeyboardRegionSelectionState>();
    let selection = match state.active.lock() {
        Ok(mut active) => active.take(),
        Err(_) => None,
    };
    let Some(selection) = selection else {
        return;
    };
    let end = match pointer_location() {
        Ok(point) => point,
        Err(capture_error) => {
            let _ = app.emit("region-selection-failed", capture_error);
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // 给隐藏的答案窗口一个完整的合成帧，避免它出现在截图中。
        let elapsed = selection.started_at.elapsed();
        let generation = selection.generation;
        let start = selection.start;
        if elapsed < Duration::from_millis(100) {
            tokio::time::sleep(Duration::from_millis(100) - elapsed).await;
        }
        let result = tauri::async_runtime::spawn_blocking(move || {
            let monitor = Monitor::from_point(start.0, start.1).map_err(error)?;
            let info = monitor_info(&monitor)?;
            let rect = region_rect_from_screen_points(start, end, &info);
            if rect.width < 5.0 || rect.height < 5.0 {
                return Ok::<_, String>(None);
            }
            let image = monitor.capture_image().map_err(error)?;
            Ok(Some((
                SelectionCapture {
                    image,
                    monitor: info,
                },
                rect,
            )))
        })
        .await
        .map_err(error);

        if app
            .state::<KeyboardRegionSelectionState>()
            .generation
            .load(Ordering::Relaxed)
            != generation
        {
            return;
        }
        match result {
            Ok(Ok(Some((capture, rect)))) => {
                if let Ok(mut slot) = app.state::<SelectionState>().0.lock() {
                    *slot = Some(capture);
                    let _ = app.emit("region-selected", serde_json::json!({ "rect": rect }));
                }
            }
            Ok(Ok(None)) => {
                let _ = app.emit("region-cancelled", ());
            }
            Ok(Err(capture_error)) | Err(capture_error) => {
                let _ = app.emit("region-selection-failed", capture_error);
            }
        }
    });
}

/// 开始区域选择：缓存鼠标所在显示器整屏以供裁剪，弹出透明覆盖层并通知前端。
#[tauri::command]
async fn begin_region_selection(
    app: AppHandle,
    selection: State<'_, SelectionState>,
) -> Result<MonitorInfo, String> {
    hide_capture_windows(&app)?;
    // 等待答题/调试窗口完全隐藏后再截屏，避免 UI 入镜。
    tokio::time::sleep(Duration::from_millis(100)).await;
    let (image, info) = tauri::async_runtime::spawn_blocking(|| {
        let monitor = current_monitor()?;
        let info = monitor_info(&monitor)?;
        let image = monitor.capture_image().map_err(error)?;
        Ok::<_, String>((image, info))
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
    };
    let _ = update_region_selection_escape(&app, true);
    overlay.emit("region-selection", &info).map_err(error)?;
    show_overlay_window(&app, &overlay)?;
    Ok(info)
}

/// 覆盖层前端就绪回调：选区模式下允许接收鼠标事件，但不激活窗口。
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
    show_overlay_window(&app, &overlay)?;
    Ok(())
}

/// 结束区域选择：清空截图缓存并隐藏覆盖层。
#[tauri::command]
fn finish_region_selection(
    app: AppHandle,
    selection: State<'_, SelectionState>,
) -> Result<(), String> {
    let _ = update_region_selection_escape(&app, false);
    let keyboard_selection = app.state::<KeyboardRegionSelectionState>();
    keyboard_selection
        .generation
        .fetch_add(1, Ordering::Relaxed);
    keyboard_selection.active.lock().map_err(error)?.take();
    selection.0.lock().map_err(error)?.take();
    *app.state::<OverlayState>().0.lock().map_err(error)? = OverlayStateData::default();
    if let Some(window) = app.get_webview_window("overlay") {
        window.set_ignore_cursor_events(true).map_err(error)?;
        window.hide().map_err(error)?;
    }
    Ok(())
}

/// 读取覆盖层状态（供前端初始化）。
#[tauri::command]
fn get_overlay_state(state: State<'_, OverlayState>) -> Result<OverlayStateData, String> {
    state.0.lock().map(|value| value.clone()).map_err(error)
}

/// 读取全局快捷键注册失败信息。
#[tauri::command]
fn get_shortcut_errors(state: State<'_, ShortcutErrors>) -> Result<Vec<String>, String> {
    state.0.lock().map(|value| value.clone()).map_err(error)
}

/// 隐藏答题窗口、覆盖层与调试框（截屏前调用，避免 UI 入镜）。
fn hide_capture_windows(app: &AppHandle) -> Result<(), String> {
    let _ = update_region_selection_escape(app, false);
    if let Some(window) = app.get_webview_window("answer") {
        let _ = update_answer_scroll_keys(app, false);
        window.hide().map_err(error)?;
        let _ = app.emit("answer-window-hidden", ());
    }
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(error)?;
    }
    hide_debug_windows(app)?;
    Ok(())
}

/// 前端主动隐藏所有截屏相关 UI。
#[tauri::command]
fn hide_capture_ui(app: AppHandle) -> Result<(), String> {
    hide_capture_windows(&app)
}

/// 显示答题窗口并保持置顶、跨工作区可见。
#[tauri::command]
fn show_answer_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("answer").ok_or("答案窗口不存在")?;
    window.set_ignore_cursor_events(true).map_err(error)?;
    window.show().map_err(error)?;
    window.set_always_on_top(true).map_err(error)?;
    window.set_visible_on_all_workspaces(true).map_err(error)?;
    app.emit("answer-window-shown", ()).map_err(error)
}

/// 隐藏答题窗口。
#[tauri::command]
fn hide_answer_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("answer").ok_or("答案窗口不存在")?;
    let _ = update_answer_scroll_keys(&app, false);
    window.hide().map_err(error)?;
    app.emit("answer-window-hidden", ()).map_err(error)
}

/// 切换答题窗口显示/隐藏（快捷键 toggle-answer 使用）。
fn toggle_answer_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("answer")
        .ok_or_else(|| "answer window unavailable".to_string())?;
    if window.is_visible().map_err(error)? {
        window.hide().map_err(error)?;
        app.emit("answer-window-hidden", ()).map_err(error)
    } else {
        window.set_ignore_cursor_events(true).map_err(error)?;
        window.show().map_err(error)?;
        window.set_always_on_top(true).map_err(error)?;
        window.set_visible_on_all_workspaces(true).map_err(error)?;
        app.emit("answer-window-shown", ()).map_err(error)
    }
}

/// 设置答题窗口透明度（占位：Tauri 无跨平台原生透明度 API，由前端 CSS 实现）。
#[tauri::command]
fn set_answer_opacity(_app: AppHandle, _opacity: f64) -> Result<(), String> {
    // Tauri has no cross-platform native opacity setter. The HUD owns opacity in CSS.
    Ok(())
}

/// 内容溢出时注册上下方向键；内容恢复可见时立即释放，避免影响原应用的键盘操作。
#[tauri::command]
fn set_answer_scroll_keys_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    update_answer_scroll_keys(&app, enabled)
}

fn update_region_selection_escape(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<RegionSelectionEscapeState>();
    let mut registered = state.0.lock().map_err(error)?;
    if *registered == enabled {
        return Ok(());
    }
    if enabled {
        app.global_shortcut().register("ESCAPE").map_err(error)?;
    } else {
        app.global_shortcut().unregister("ESCAPE").map_err(error)?;
    }
    *registered = enabled;
    Ok(())
}

fn update_answer_scroll_keys(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AnswerScrollKeysState>();
    let mut registered = state.0.lock().map_err(error)?;
    if *registered == enabled {
        return Ok(());
    }
    if enabled {
        app.global_shortcut().register("ARROWUP").map_err(error)?;
        if let Err(register_error) = app.global_shortcut().register("ARROWDOWN") {
            let _ = app.global_shortcut().unregister("ARROWUP");
            return Err(error(register_error));
        }
    } else {
        app.global_shortcut().unregister("ARROWUP").map_err(error)?;
        app.global_shortcut()
            .unregister("ARROWDOWN")
            .map_err(error)?;
    }
    *registered = enabled;
    Ok(())
}

/// 读取指定路径的设置备份 JSON。
#[tauri::command]
fn read_settings_backup(path: String) -> Result<Value, String> {
    serde_json::from_str(&fs::read_to_string(path).map_err(error)?).map_err(error)
}

/// 将设置以格式化 JSON 写入指定路径（本地备份）。
#[tauri::command]
fn write_settings_backup(path: String, settings: Value) -> Result<(), String> {
    let output = serde_json::to_string_pretty(&settings).map_err(error)?;
    fs::write(path, output).map_err(error)
}

/// 显示并聚焦设置窗口。
fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 将 Ctrl+Shift+1~5（含小键盘数字）映射为对应的前端事件名。
fn shortcut_event_name(shortcut: &Shortcut, modifiers: Modifiers) -> Option<&'static str> {
    if shortcut.matches(modifiers, Code::Digit1) || shortcut.matches(modifiers, Code::Numpad1) {
        Some("shortcut-capture-full")
    } else if shortcut.matches(modifiers, Code::Digit3)
        || shortcut.matches(modifiers, Code::Numpad3)
    {
        Some("shortcut-switch-config")
    } else if shortcut.matches(modifiers, Code::Digit4)
        || shortcut.matches(modifiers, Code::Numpad4)
    {
        Some("shortcut-clear")
    } else if shortcut.matches(modifiers, Code::Digit5)
        || shortcut.matches(modifiers, Code::Numpad5)
    {
        Some("shortcut-toggle-answer")
    } else {
        None
    }
}

/// Ctrl+Shift+2 的按下和松开分别记录区域截图的两个顶点。
fn is_keyboard_region_shortcut(shortcut: &Shortcut) -> bool {
    let modifiers = PRIMARY_SHORTCUT_MODIFIER | Modifiers::SHIFT;
    shortcut.matches(modifiers, Code::Digit2) || shortcut.matches(modifiers, Code::Numpad2)
}

/// 未带修饰键的方向键仅在答案内容溢出时动态注册，用于滚动点击穿透的答案窗。
fn answer_scroll_event_name(shortcut: &Shortcut) -> Option<&'static str> {
    if shortcut.matches(Modifiers::empty(), Code::ArrowUp) {
        Some("answer-scroll-up")
    } else if shortcut.matches(Modifiers::empty(), Code::ArrowDown) {
        Some("answer-scroll-down")
    } else {
        None
    }
}

fn region_selection_escape_event_name(shortcut: &Shortcut) -> Option<&'static str> {
    if shortcut.matches(Modifiers::empty(), Code::Escape) {
        Some("region-selection-escape")
    } else {
        None
    }
}

/// 分发快捷键事件：静默模式下忽略 toggle-answer（不弹出答题窗口），其余广播给前端。
fn dispatch_shortcut_event(app: &AppHandle, event_name: &str) {
    if event_name == "region-selection-escape" {
        let selecting = app
            .state::<OverlayState>()
            .0
            .lock()
            .map(|value| value.selecting)
            .unwrap_or(false);
        if selecting {
            let _ = app.emit("region-cancel-request", ());
        }
        return;
    }
    if event_name == "shortcut-toggle-answer" {
        let silent_mode = app
            .state::<SilentModeState>()
            .0
            .lock()
            .map(|value| *value)
            .unwrap_or(false);
        if !silent_mode {
            let _ = toggle_answer_window(app);
        }
    } else {
        let _ = app.emit(event_name, ());
    }
}

/// Windows 小键盘 2 松开后完成两点区域截图。
#[cfg(windows)]
fn finish_windows_region_selection_on_release(app: AppHandle, virtual_key: i32) {
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

        loop {
            let key_state = unsafe { GetAsyncKeyState(virtual_key) } as u16;
            if key_state & 0x8000 == 0 {
                finish_keyboard_region_selection(&app);
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    });
}

/// Windows 原生快捷键消息窗口过程：收到 WM_HOTKEY 时按 id 映射事件并分发。
#[cfg(windows)]
unsafe extern "system" fn native_shortcut_window_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    _lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_DOWN, VK_NUMPAD2};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_USERDATA, WM_DESTROY, WM_HOTKEY,
    };

    unsafe {
        if message == WM_HOTKEY {
            let app = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const AppHandle;
            if matches!(wparam, 12 | 22) && !app.is_null() {
                let app = (&*app).clone();
                match begin_keyboard_region_selection(&app) {
                    Ok(()) => finish_windows_region_selection_on_release(
                        app,
                        if wparam == 12 {
                            VK_NUMPAD2 as i32
                        } else {
                            VK_DOWN as i32
                        },
                    ),
                    Err(region_error) => {
                        let _ = app.emit("region-selection-failed", region_error);
                    }
                }
                return 0;
            }
            let event_name = match wparam {
                1 | 11 | 21 => Some("shortcut-capture-full"),
                3 | 13 | 23 => Some("shortcut-switch-config"),
                4 | 14 | 24 => Some("shortcut-clear"),
                5 | 15 | 25 => Some("shortcut-toggle-answer"),
                _ => None,
            };
            if let (Some(event_name), app) = (event_name, app) {
                if !app.is_null() {
                    dispatch_shortcut_event(&*app, event_name);
                }
            }
            return 0;
        }

        if message == WM_DESTROY {
            let app = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppHandle;
            if !app.is_null() {
                drop(Box::from_raw(app));
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
        }

        DefWindowProcW(hwnd, message, wparam, _lparam)
    }
}

/// Windows 小键盘快捷键兜底：tauri global-shortcut 不支持小键盘数字，
/// 改用原生 RegisterHotKey 在隐藏消息窗口上注册 CTRL+SHIFT+NUM1~5。
#[cfg(windows)]
fn register_windows_numpad_fallbacks(app: &AppHandle) -> Result<Vec<String>, String> {
    use std::{ptr, sync::OnceLock};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_CLEAR, VK_DOWN, VK_END, VK_LEFT,
        VK_NEXT, VK_NUMPAD1, VK_NUMPAD2, VK_NUMPAD3, VK_NUMPAD4, VK_NUMPAD5,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, RegisterClassW, SetWindowLongPtrW, GWLP_USERDATA,
        HWND_MESSAGE, WNDCLASSW,
    };

    static CLASS_READY: OnceLock<Result<(), String>> = OnceLock::new();
    let class_name: Vec<u16> = "ExamPilotNativeShortcuts\0".encode_utf16().collect();
    match CLASS_READY.get_or_init(|| unsafe {
        let instance = GetModuleHandleW(ptr::null());
        let class = WNDCLASSW {
            lpfnWndProc: Some(native_shortcut_window_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            Err(format!(
                "注册小键盘快捷键窗口失败：{}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }) {
        Ok(()) => {}
        Err(message) => return Err(message.clone()),
    }

    let title: Vec<u16> = "ExamPilot shortcuts\0".encode_utf16().collect();
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            ptr::null_mut(),
            GetModuleHandleW(ptr::null()),
            ptr::null(),
        )
    };
    if hwnd.is_null() {
        return Err(format!(
            "创建小键盘快捷键窗口失败：{}",
            std::io::Error::last_os_error()
        ));
    }

    // id 1x：小键盘数字键；id 2x：NumLock 关闭时数字区对应的导航键（等价兜底）。
    let fallbacks: [(i32, u16, &str); 10] = [
        (11, VK_NUMPAD1, "CTRL+SHIFT+NUM1"),
        (12, VK_NUMPAD2, "CTRL+SHIFT+NUM2"),
        (13, VK_NUMPAD3, "CTRL+SHIFT+NUM3"),
        (14, VK_NUMPAD4, "CTRL+SHIFT+NUM4"),
        (15, VK_NUMPAD5, "CTRL+SHIFT+NUM5"),
        (21, VK_END, "CTRL+SHIFT+NUM1"),
        (22, VK_DOWN, "CTRL+SHIFT+NUM2"),
        (23, VK_NEXT, "CTRL+SHIFT+NUM3"),
        (24, VK_LEFT, "CTRL+SHIFT+NUM4"),
        (25, VK_CLEAR, "CTRL+SHIFT+NUM5"),
    ];
    let mut errors = Vec::new();
    let mut registered_count = 0;
    for (id, key, label) in fallbacks {
        if unsafe { RegisterHotKey(hwnd, id, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, key as u32) }
            == 0
        {
            errors.push(format!(
                "{} 无法注册: {}",
                label,
                std::io::Error::last_os_error()
            ));
        } else {
            registered_count += 1;
        }
    }

    if registered_count == 0 {
        unsafe { DestroyWindow(hwnd) };
        return Ok(errors);
    }

    unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_USERDATA,
            Box::into_raw(Box::new(app.clone())) as isize,
        )
    };
    Ok(errors)
}

/// 静默模式核心循环：每 40ms 轮询光标位置，进入命中区停留 350ms 后微移真实光标并广播触发事件。
fn start_hover_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut entered_at: Option<Instant> = None;
        let mut active: Option<usize> = None;
        let mut last_jitter_failure: Option<Instant> = None;
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
            // 切换到新的命中区：重置上个区域的触发标记，重新计时。
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
                last_jitter_failure = None;
            }
            if let (Some(index), Some(start)) = (active, entered_at) {
                // 停留不足 350ms 不触发，避免光标划过时误触发。
                if start.elapsed() < Duration::from_millis(350) {
                    continue;
                }
                // 微移失败后 1 秒内不重试，防止持续报错。
                if last_jitter_failure
                    .is_some_and(|failed_at| failed_at.elapsed() < Duration::from_secs(1))
                {
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
                    let jitter_result = match tauri::async_runtime::spawn_blocking(move || {
                        perform_jitter(point, offset)
                    })
                    .await
                    {
                        Ok(result) => result,
                        Err(join_error) => Err(error(join_error)),
                    };
                    if let Err(message) = jitter_result {
                        last_jitter_failure = Some(Instant::now());
                        let _ = app.emit("silent-trigger-failed", message);
                        continue;
                    }
                    if let Ok(mut targets) = app.state::<SilentState>().0.lock() {
                        if let Some(item) = targets.get_mut(index) {
                            item.fired = true;
                        }
                    }
                    let _ = app.emit("silent-triggered", ());
                }
            }
        }
    });
}

/// 应用入口：注册共享状态、插件、窗口事件、托盘、全局快捷键，并启动 Tauri 运行时。
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RequestState {
            next_id: AtomicU64::new(1),
            active: Mutex::new(None),
        })
        .manage(SilentState(Mutex::new(Vec::new())))
        .manage(SilentModeState(Mutex::new(false)))
        .manage(SilentCursorOffset(Mutex::new(DEFAULT_SILENT_CURSOR_OFFSET)))
        .manage(SelectionState(Mutex::new(None)))
        .manage(KeyboardRegionSelectionState {
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
        .manage(OverlayState(Mutex::new(OverlayStateData::default())))
        .manage(RegionSelectionEscapeState(Mutex::new(false)))
        .manage(ShortcutErrors(Mutex::new(Vec::new())))
        .manage(AnswerScrollKeysState(Mutex::new(false)));
    #[cfg(windows)]
    let builder = builder.manage(NativeDebugWindows(Mutex::new(Vec::new())));
    builder
        // 设置窗口点关闭时仅隐藏，便于再次打开。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if is_keyboard_region_shortcut(shortcut) {
                        match event.state() {
                            ShortcutState::Pressed => {
                                if let Err(region_error) = begin_keyboard_region_selection(app) {
                                    let _ = app.emit("region-selection-failed", region_error);
                                }
                            }
                            ShortcutState::Released => finish_keyboard_region_selection(app),
                        }
                        return;
                    }
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let modifiers = PRIMARY_SHORTCUT_MODIFIER | Modifiers::SHIFT;
                    let Some(event_name) = shortcut_event_name(shortcut, modifiers)
                        .or_else(|| region_selection_escape_event_name(shortcut))
                        .or_else(|| answer_scroll_event_name(shortcut))
                    else {
                        return;
                    };
                    dispatch_shortcut_event(app, event_name);
                })
                .build(),
        )
        .setup(|app| {
            if let Some(answer) = app.get_webview_window("answer") {
                answer.set_focusable(false)?;
                answer.set_ignore_cursor_events(true)?;
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
            // 主键盘 Ctrl+Shift+1~5，注册失败记录到 ShortcutErrors。
            for shortcut in [
                "CTRL+SHIFT+1",
                "CTRL+SHIFT+2",
                "CTRL+SHIFT+3",
                "CTRL+SHIFT+4",
                "CTRL+SHIFT+5",
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
            // 非 Windows：小键盘快捷键可由 global-shortcut 直接注册。
            #[cfg(not(windows))]
            for shortcut in [
                "CTRL+SHIFT+NUM1",
                "CTRL+SHIFT+NUM2",
                "CTRL+SHIFT+NUM3",
                "CTRL+SHIFT+NUM4",
                "CTRL+SHIFT+NUM5",
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
            // Windows：小键盘快捷键走原生 RegisterHotKey 兜底。
            #[cfg(windows)]
            match register_windows_numpad_fallbacks(app.handle()) {
                Ok(messages) => {
                    for message in messages {
                        eprintln!("{}", message);
                        if let Ok(mut errors) = app.state::<ShortcutErrors>().0.lock() {
                            errors.push(message);
                        }
                    }
                }
                Err(message) => {
                    eprintln!("{}", message);
                    if let Ok(mut errors) = app.state::<ShortcutErrors>().0.lock() {
                        errors.push(message);
                    }
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
            set_answer_scroll_keys_enabled,
            read_settings_backup,
            write_settings_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running ExamPilot desktop");
}

// 单元测试：覆盖坐标换算、命中区映射与钳制、光标偏移范围、快捷键映射等纯函数逻辑。
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
    fn percent_target_is_clamped_inside_monitor_bounds() {
        let monitor = MonitorInfo {
            id: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            scale_factor: 1.0,
        };
        let target = mouse_target(
            &PercentTarget {
                x: 1.0,
                y: 1.0,
                width: 0.02,
                height: 0.02,
            },
            &monitor,
        );
        assert_eq!(target.x + target.width, 100);
        assert_eq!(target.y + target.height, 80);
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
    fn global_shortcuts_accept_main_and_numpad_digits() {
        let modifiers = PRIMARY_SHORTCUT_MODIFIER | Modifiers::SHIFT;
        let cases = [
            (Code::Digit1, Code::Numpad1, "shortcut-capture-full"),
            (Code::Digit3, Code::Numpad3, "shortcut-switch-config"),
            (Code::Digit4, Code::Numpad4, "shortcut-clear"),
            (Code::Digit5, Code::Numpad5, "shortcut-toggle-answer"),
        ];

        for (digit, numpad, event_name) in cases {
            let digit_shortcut = Shortcut::new(Some(modifiers), digit);
            let numpad_shortcut = Shortcut::new(Some(modifiers), numpad);
            assert_eq!(
                shortcut_event_name(&digit_shortcut, modifiers),
                Some(event_name)
            );
            assert_eq!(
                shortcut_event_name(&numpad_shortcut, modifiers),
                Some(event_name)
            );
        }
    }

    #[test]
    fn keyboard_region_shortcut_uses_ctrl_shift_2() {
        let digit_shortcut = Shortcut::new(
            Some(PRIMARY_SHORTCUT_MODIFIER | Modifiers::SHIFT),
            Code::Digit2,
        );
        let numpad_shortcut = Shortcut::new(
            Some(PRIMARY_SHORTCUT_MODIFIER | Modifiers::SHIFT),
            Code::Numpad2,
        );
        assert!(is_keyboard_region_shortcut(&digit_shortcut));
        assert!(is_keyboard_region_shortcut(&numpad_shortcut));
    }

    #[test]
    fn keyboard_region_rect_uses_the_two_global_pointer_positions() {
        let monitor = MonitorInfo {
            id: 1,
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        let rect = region_rect_from_screen_points((-1700, 120), (-900, 720), &monitor);
        assert_eq!(rect.x, 220.0);
        assert_eq!(rect.y, 120.0);
        assert_eq!(rect.width, 800.0);
        assert_eq!(rect.height, 600.0);
    }

    #[test]
    fn keyboard_region_rect_clips_points_outside_the_start_monitor() {
        let monitor = MonitorInfo {
            id: 1,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        let top_left = region_rect_from_screen_points((100, 80), (-500, -300), &monitor);
        assert_eq!(top_left.x, 0.0);
        assert_eq!(top_left.y, 0.0);
        assert_eq!(top_left.width, 100.0);
        assert_eq!(top_left.height, 80.0);

        let bottom_right = region_rect_from_screen_points((1800, 900), (2400, 1400), &monitor);
        assert_eq!(bottom_right.x, 1800.0);
        assert_eq!(bottom_right.y, 900.0);
        assert_eq!(bottom_right.width, 120.0);
        assert_eq!(bottom_right.height, 180.0);
    }

    #[cfg(windows)]
    #[test]
    fn windows_keyboard_region_rect_is_not_scaled_twice_at_high_dpi() {
        let monitor = MonitorInfo {
            id: 1,
            x: -3840,
            y: 0,
            width: 3840,
            height: 2160,
            scale_factor: 2.0,
        };
        let rect = region_rect_from_screen_points((-3640, 100), (-2840, 700), &monitor);
        assert_eq!(rect.x, 100.0);
        assert_eq!(rect.y, 50.0);
        assert_eq!(rect.width, 400.0);
        assert_eq!(rect.height, 300.0);
        assert_eq!(
            physical_crop_rect(&rect, &monitor, 3840, 2160),
            (200, 100, 800, 600)
        );
    }

    #[test]
    fn region_selection_escape_shortcut_is_unmodified() {
        let shortcut = Shortcut::new(None, Code::Escape);
        assert_eq!(
            region_selection_escape_event_name(&shortcut),
            Some("region-selection-escape")
        );
    }

    #[test]
    fn answer_scroll_shortcuts_accept_unmodified_arrow_keys() {
        assert_eq!(
            answer_scroll_event_name(&Shortcut::new(None, Code::ArrowUp)),
            Some("answer-scroll-up")
        );
        assert_eq!(
            answer_scroll_event_name(&Shortcut::new(None, Code::ArrowDown)),
            Some("answer-scroll-down")
        );
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
