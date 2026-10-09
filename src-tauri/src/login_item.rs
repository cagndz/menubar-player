//! "Launch at Login", through the system's login items. The app registers
//! itself, so System Settings lists it by name with its icon, and the user can
//! switch it off from there too.
//!
//! Only an app bundle can be registered: under `tauri dev` the switch stays off.

use smappservice_rs::{AppService, ServiceStatus, ServiceType};

fn service() -> AppService {
    AppService::new(ServiceType::MainApp)
}

/// What the system says, which is not always what was last asked for: the
/// user may have removed the item in System Settings.
pub fn is_enabled() -> bool {
    service().status() == ServiceStatus::Enabled
}

pub fn toggle() {
    let service = service();
    let _ = if is_enabled() {
        service.unregister()
    } else {
        service.register()
    };
}
