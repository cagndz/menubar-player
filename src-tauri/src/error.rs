use serde::Serialize;

/// Error sent to the webview. The frontend owns the user-facing wording
/// (keyed by `code`); `detail` is technical and only meant for the log.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    pub fn with_detail(code: &'static str, detail: impl ToString) -> Self {
        Self {
            code,
            detail: Some(detail.to_string()),
        }
    }
}
