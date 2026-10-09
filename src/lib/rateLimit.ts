// YouTube sometimes answers "Sign in to confirm you're not a bot" or HTTP 429
// when it has seen too many requests. The backend then refuses to resolve
// anything for a while (10 minutes, then 30, then an hour) and answers every
// request with this same error, without calling yt-dlp.

const RATE_LIMIT_CODE = "rate_limited";

export function isRateLimited(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === RATE_LIMIT_CODE;
}
