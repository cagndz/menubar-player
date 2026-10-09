import { strings } from "./strings";
import { debugLog, type AppError } from "./tauri";

const MESSAGE_BY_CODE: Record<string, string> = {
  invalid_url: strings.errors.invalidUrl,
  not_youtube: strings.errors.notYoutube,
  ytdlp_missing: strings.errors.ytdlpMissing,
  no_playable_format: strings.errors.noPlayableFormat,
  ytdlp_failed: strings.errors.resolveFailed,
  rate_limited: strings.errors.rateLimited,
  storage_failed: strings.errors.storageFailed,
};

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && typeof (value as AppError).code === "string";
}

/** Turns a command rejection into user-facing copy; the technical detail goes to the log. */
export function toUserMessage(error: unknown, fallback: string): string {
  if (isAppError(error)) {
    debugLog(`[error] ${error.code}${error.detail ? `: ${error.detail}` : ""}`);
    return MESSAGE_BY_CODE[error.code] ?? fallback;
  }
  debugLog(`[error] ${String(error)}`);
  return fallback;
}
