// Checks the colour tokens in src/index.css against WCAG contrast thresholds.
// Usage: pnpm contrast
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const readTokens = (block) =>
  Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

// Dark is the @theme block; light is the block under prefers-color-scheme, on top of it.
const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
const lightEnd = css.indexOf("\n}\n", lightStart);
const dark = readTokens(css.slice(0, lightStart));
const themes = { dark, light: { ...dark, ...readTokens(css.slice(lightStart, lightEnd)) } };

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum ratio, what it is used for]
const TEXT = 4.5; // WCAG 1.4.3, normal text
const UI = 3; // WCAG 1.4.11, parts of a control and focus indicators
const checks = [
  ["text", "surface-0", TEXT, "body text on the popover"],
  ["text", "surface-1", TEXT, "row title on hover, text in the field"],
  ["text", "surface-2", TEXT, "button label, pressed row"],
  ["text", "surface-3", TEXT, "button label on hover, time under the pointer"],
  ["text-muted", "surface-0", TEXT, "durations, labels, notices"],
  ["text-muted", "surface-1", TEXT, "duration of a row on hover"],
  ["text-muted", "surface-2", TEXT, "duration of a pressed row"],
  ["text-faint", "surface-0", TEXT, "idle counter"],
  ["text-faint", "surface-1", TEXT, "placeholder, disabled button label"],
  ["danger", "surface-0", TEXT, "error under the field"],
  ["danger", "danger-surface", TEXT, "error block"],
  ["text", "danger-surface", TEXT, "'Try again' inside the error block"],
  ["text", "surface-0", UI, "played part of the progress bar, icon of the current track"],
  ["focus", "surface-0", UI, "focus ring on the popover"],
  ["focus", "surface-1", UI, "focus ring on a hovered row or the field"],
  ["focus", "surface-2", UI, "focus ring on a pressed control or the volume flyout"],
  ["text-muted", "surface-0", UI, "icon of the current track paused, bar while reconnecting"],
  ["text-muted", "surface-1", UI, "the same on a hovered row"],
  ["track", "surface-0", UI, "unplayed part of the progress bar"],
  ["track", "surface-2", UI, "unfilled part of the volume slider, inside its flyout"],
  ["text-muted", "surface-0", UI, "row icons"],
  ["text", "surface-2", UI, "volume level inside its flyout"],
];

let failed = 0;
for (const [name, tokens] of Object.entries(themes)) {
  console.log(`\n${name} theme`);
  for (const [fg, bg, minimum, use] of checks) {
    const value = ratio(tokens[fg], tokens[bg]);
    const ok = value >= minimum;
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${value.toFixed(2).padStart(5)}:1  (min ${minimum}:1)  ${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}  — ${use}`,
    );
  }
  console.log(`     decorative only, no minimum: line ${tokens.line} on surface-0 = ${ratio(tokens.line, tokens["surface-0"]).toFixed(2)}:1`);
}
console.log(failed ? `\n${failed} check(s) below the minimum` : "\nall checks pass, in both themes");
process.exit(failed ? 1 : 0);
