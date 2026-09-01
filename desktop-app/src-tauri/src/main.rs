#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// ExamPilot 桌面应用入口：release 模式下隐藏 Windows 控制台窗口，实际逻辑在 lib 中。

fn main() {
    exampilot_desktop_lib::run();
}
