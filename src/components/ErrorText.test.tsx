// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toUserMessage } from "../lib/errors";
import { strings } from "../lib/strings";
import { ErrorText } from "./ErrorText";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const messageFor = (code: string) => toUserMessage({ code, detail: null }, "fallback");

describe("ErrorText", () => {
  it("offers the command that installs yt-dlp when it is missing, and the one that updates it when it is out of date", () => {
    render(<ErrorText text={messageFor("ytdlp_missing")} />);
    expect(screen.getByText("brew install yt-dlp").tagName).toBe("CODE");
    cleanup();

    render(<ErrorText text={messageFor("ytdlp_outdated")} />);
    expect(screen.getByText("brew upgrade yt-dlp").tagName).toBe("CODE");
  });

  it("shows other errors as plain text", () => {
    render(<ErrorText text={messageFor("rate_limited")} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("code")).toBeNull();
  });

  it("copies the command, says so for a moment, then goes back", async () => {
    render(<ErrorText text={strings.errors.ytdlpMissing} />);
    const button = screen.getByRole("button", { name: "Copy brew install yt-dlp" });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith("brew install yt-dlp");
    expect(screen.getByRole("status").textContent).toBe("Copied to the clipboard");
    const copiedIcon = button.innerHTML;

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(button.innerHTML).not.toBe(copiedIcon);
  });

  it("claims nothing when the copy fails", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    document.execCommand = vi.fn(() => false);
    render(<ErrorText text={strings.errors.ytdlpMissing} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
