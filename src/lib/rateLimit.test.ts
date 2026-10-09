import { describe, expect, it } from "vitest";
import { isRateLimited } from "./rateLimit";

describe("isRateLimited", () => {
  it("recognises the rate limit error by its code", () => {
    expect(isRateLimited({ code: "rate_limited", detail: "cooling down" })).toBe(true);
    expect(isRateLimited({ code: "ytdlp_failed", detail: null })).toBe(false);
    expect(isRateLimited(new Error("rate_limited"))).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});
