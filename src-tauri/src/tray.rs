use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Monitor, Rect, WebviewWindow, Window, WindowEvent,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

const POPOVER_LABEL: &str = "main";
const TRAY_ID: &str = "main";

// The menu bar icon says whether something is playing: level bars while it
// is, a pause sign otherwise. Both are template images (shape only), so macOS
// tints them for light and dark menu bars. Sources in design/icons.
const ICON_PLAYING: &[u8] = include_bytes!("../icons/tray-playing.png");
const ICON_PAUSED: &[u8] = include_bytes!("../icons/tray-paused.png");

// Logical points; scaled by the target monitor's scale factor before use.
const GAP_BELOW_ICON: f64 = 6.0;
const SCREEN_MARGIN: f64 = 8.0;

// Clicking the tray icon while the popover is open blurs it first (hiding it)
// and then delivers the click. Without this guard the click would reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(200);

// The webview saves the playback position on this event and then calls
// `quit_app`. If it doesn't answer in time, the app quits anyway.
pub const QUIT_REQUESTED_EVENT: &str = "quit-requested";
const QUIT_FLUSH_DEADLINE: Duration = Duration::from_millis(1500);

// The popover is a panel rather than a plain window: a panel can take the
// keyboard without making the app the active one, which is what lets it open
// over another app's full screen space and leaves that app in front.
tauri_panel! {
    panel!(PopoverPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

#[derive(Default)]
pub struct PopoverState {
    hidden_by_blur_at: Mutex<Option<Instant>>,
}

/// Play/pause or next chosen in the tray menu; the webview carries it out.
pub const TRAY_ACTION_EVENT: &str = "tray-action";

// Longer titles are cut so the menu keeps a sensible width.
const MENU_TITLE_CHARS: usize = 44;

/// What the tray menu shows of the player, as the webview last reported it.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    title: Option<String>,
    playing: bool,
    can_toggle: bool,
    can_next: bool,
}

#[derive(Default)]
pub struct TrayMenu(Mutex<MenuState>);

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &MenuState::default())?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON_PAUSED)?)
        .icon_as_template(true)
        .tooltip("Menubar Player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" | "next" => {
                let _ = app.emit(TRAY_ACTION_EVENT, event.id.as_ref());
            }
            "login" => {
                crate::login_item::toggle();
                // The check mark shows what the system ended up with, not what was asked for.
                let _ = refresh_menu(app);
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), rect);
            }
        });

    builder.build(app)?;
    Ok(())
}

/// Turns the popover's window into a panel. Called once, at startup.
pub fn make_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(window) = app.get_webview_window(POPOVER_LABEL) else {
        return Ok(());
    };
    let panel = window.to_panel::<PopoverPanel<tauri::Wry>>()?;

    panel.add_style_mask(StyleMask::empty().nonactivating_panel().into())?;
    // Just above the menu bar, as the system's own menus are.
    panel.set_level(PanelLevel::MainMenu.value() + 1);
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .into(),
    );
    Ok(())
}

/// The menu behind a right click: the track loaded, play/pause, next, and the
/// two things that have no place in the popover.
fn build_menu(app: &AppHandle, state: &MenuState) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;

    if let Some(title) = &state.title {
        menu.append(&MenuItem::with_id(
            app,
            "title",
            menu_title(title),
            false,
            None::<&str>,
        )?)?;
    }
    let toggle = if state.playing { "Pause" } else { "Play" };
    menu.append(&MenuItem::with_id(
        app,
        "toggle",
        toggle,
        state.can_toggle,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "next",
        "Next Track",
        state.can_next,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let opens_at_login = crate::login_item::is_enabled();
    menu.append(&CheckMenuItem::with_id(
        app,
        "login",
        "Launch at Login",
        true,
        opens_at_login,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}

fn menu_title(title: &str) -> String {
    if title.chars().count() <= MENU_TITLE_CHARS {
        return title.to_string();
    }
    let cut: String = title.chars().take(MENU_TITLE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

pub fn set_menu(app: &AppHandle, state: MenuState) -> tauri::Result<()> {
    *app.state::<TrayMenu>().0.lock().unwrap() = state;
    refresh_menu(app)
}

fn refresh_menu(app: &AppHandle) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let state = app.state::<TrayMenu>().0.lock().unwrap().clone();
    tray.set_menu(Some(build_menu(app, &state)?))
}

/// Switches the menu bar icon between its playing and not-playing shapes.
pub fn set_playing(app: &AppHandle, playing: bool) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let icon = Image::from_bytes(if playing { ICON_PLAYING } else { ICON_PAUSED })?;
    tray.set_icon(Some(icon))?;
    // Replacing the image drops the template flag, so it is set again.
    tray.set_icon_as_template(true)
}

fn request_quit(app: &AppHandle) {
    if app.emit(QUIT_REQUESTED_EVENT, ()).is_err() {
        app.exit(0);
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FLUSH_DEADLINE);
        app.exit(0);
    });
}

/// Hides the popover. The app in front never stopped being the active one, so
/// the keyboard goes back to it by itself.
pub fn hide_popover(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        let _ = window.hide();
    }
}

fn toggle_popover(app: &AppHandle, icon_rect: Rect) {
    let Some(window) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        hide_popover(app);
        return;
    }

    let state = app.state::<PopoverState>();
    let just_hidden = state
        .hidden_by_blur_at
        .lock()
        .unwrap()
        .is_some_and(|at| at.elapsed() < REOPEN_GUARD);
    if just_hidden {
        return;
    }

    show_under_icon(&window, icon_rect);
}

/// Opens the popover without a click on the icon, e.g. to show why an action
/// taken from the tray menu failed.
pub fn show_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    let Some(icon_rect) = app
        .tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok().flatten())
    else {
        return;
    };
    show_under_icon(&window, icon_rect);
}

fn show_under_icon(window: &WebviewWindow, icon_rect: Rect) {
    position_under_icon(window, icon_rect);

    // Not `set_focus`, which would activate the app. The panel is brought
    // forward and given the keyboard as it is, with the webview still its
    // first responder.
    let app = window.app_handle().clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(panel) = app.get_webview_panel(POPOVER_LABEL) {
            panel.order_front_regardless();
            panel.make_key_window();
        }
    });
}

fn position_under_icon(window: &WebviewWindow, icon_rect: Rect) {
    let Some((monitor, icon)) = locate_icon(window, icon_rect) else {
        eprintln!("[tray] no monitor contains the icon rect {icon_rect:?}; popover not moved");
        return;
    };
    let scale = monitor.scale_factor();
    let screen = monitor_bounds(&monitor);

    // outer_size() is in pixels of the monitor the window is on *now*, which
    // may not be the one it is moving to.
    let Ok(current_size) = window.outer_size() else {
        return;
    };
    let current_scale = window.scale_factor().unwrap_or(scale);
    let width = f64::from(current_size.width) / current_scale * scale;

    let (x, y) = popover_origin(icon, screen, width, scale);

    // Handed over as logical points of the target monitor: a physical position
    // would be converted with the window's current scale factor, which is the
    // wrong one when the popover jumps between monitors of different density.
    let _ = window.set_position(LogicalPosition::new(x / scale, y / scale));
}

/// Finds the monitor showing the clicked icon and the icon's rect in that
/// monitor's physical pixels.
fn locate_icon(window: &WebviewWindow, icon_rect: Rect) -> Option<(Monitor, Bounds)> {
    let physical = |scale: f64| {
        let position = icon_rect.position.to_physical::<f64>(scale);
        let size = icon_rect.size.to_physical::<f64>(scale);
        Bounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    };
    let center = |icon: Bounds| (icon.x + icon.width / 2.0, icon.y + icon.height / 2.0);

    // Scale is irrelevant when the rect is already physical (the macOS case).
    let icon = physical(1.0);
    let (cx, cy) = center(icon);
    if let Ok(Some(monitor)) = window.monitor_from_point(cx, cy) {
        let icon = physical(monitor.scale_factor());
        return Some((monitor, icon));
    }

    // A logical rect only becomes comparable once scaled per candidate monitor.
    window
        .available_monitors()
        .ok()?
        .into_iter()
        .find_map(|monitor| {
            let icon = physical(monitor.scale_factor());
            let (cx, cy) = center(icon);
            monitor_bounds(&monitor)
                .contains(cx, cy)
                .then_some((monitor, icon))
        })
}

fn monitor_bounds(monitor: &Monitor) -> Bounds {
    Bounds {
        x: f64::from(monitor.position().x),
        y: f64::from(monitor.position().y),
        width: f64::from(monitor.size().width),
        height: f64::from(monitor.size().height),
    }
}

/// Top-left corner of the popover, in physical pixels: centered under the
/// icon and kept inside the monitor horizontally.
fn popover_origin(icon: Bounds, screen: Bounds, popover_width: f64, scale: f64) -> (f64, f64) {
    let margin = SCREEN_MARGIN * scale;
    let min_x = screen.x + margin;
    let max_x = (screen.x + screen.width - popover_width - margin).max(min_x);

    let centered = icon.x + icon.width / 2.0 - popover_width / 2.0;
    let x = centered.clamp(min_x, max_x);
    let y = icon.y + icon.height + GAP_BELOW_ICON * scale;

    (x.round(), y.round())
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != POPOVER_LABEL {
        return;
    }

    if let WindowEvent::Focused(false) = event {
        let state = window.state::<PopoverState>();
        *state.hidden_by_blur_at.lock().unwrap() = Some(Instant::now());
        // Hide instead of close so the webview (and its <audio>) keeps playing.
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RETINA: Bounds = Bounds {
        x: 0.0,
        y: 0.0,
        width: 3024.0,
        height: 1964.0,
    };
    // 1x external display placed to the left of the primary one.
    const EXTERNAL_LEFT: Bounds = Bounds {
        x: -1920.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    fn icon_at(x: f64, scale: f64) -> Bounds {
        Bounds {
            x,
            y: 0.0,
            width: 24.0 * scale,
            height: 24.0 * scale,
        }
    }

    #[test]
    fn cuts_long_titles_for_the_menu() {
        assert_eq!(
            menu_title("Burial – Untrue (Full Album)"),
            "Burial – Untrue (Full Album)"
        );

        let long = "Aphex Twin Live at Field Day 2017 (full set, soundboard recording)";
        let cut = menu_title(long);
        assert_eq!(cut.chars().count(), MENU_TITLE_CHARS);
        assert!(cut.ends_with('…') && long.starts_with(cut.trim_end_matches('…')));
    }

    #[test]
    fn centers_under_icon_with_scaled_gap() {
        let (x, y) = popover_origin(icon_at(1000.0, 2.0), RETINA, 640.0, 2.0);
        assert_eq!(x, 1000.0 + 24.0 - 320.0);
        assert_eq!(y, 48.0 + 12.0);
    }

    #[test]
    fn clamps_to_right_edge_of_the_icons_monitor() {
        let (x, _) = popover_origin(icon_at(2990.0, 2.0), RETINA, 640.0, 2.0);
        assert_eq!(x, 3024.0 - 640.0 - 16.0);
    }

    #[test]
    fn stays_on_a_secondary_monitor_with_negative_origin() {
        let (x, y) = popover_origin(icon_at(-40.0, 1.0), EXTERNAL_LEFT, 320.0, 1.0);
        assert_eq!(x, -320.0 - 8.0);
        assert_eq!(y, 24.0 + 6.0);

        let (x, _) = popover_origin(icon_at(-1915.0, 1.0), EXTERNAL_LEFT, 320.0, 1.0);
        assert_eq!(x, -1920.0 + 8.0);
    }
}
