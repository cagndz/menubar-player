import { useEffect, useRef, useState } from "react";
import { commandFor } from "../lib/errors";
import { strings } from "../lib/strings";
import { CheckIcon, CopyIcon } from "./icons";

/** How long the copy button shows that it worked. */
const COPIED_MS = 1500;

/**
 * An error's text and, when a command fixes it, that command ready to copy.
 * The text is selectable, as every error is.
 */
export function ErrorText({ text }: { text: string }) {
  const command = commandFor(text);
  return (
    <>
      {text}
      {command && <CopyCommand command={command} />}
    </>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = async () => {
    if (!(await writeToClipboard(command))) return;
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <span className="command">
      <code>{command}</code>
      <button type="button" onClick={copy} aria-label={strings.commands.copy(command)} className="icon-button command-copy">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span role="status" className="sr-only">
        {copied ? strings.commands.copied : ""}
      </span>
    </span>
  );
}

/** The clipboard API, or the older copy command where it isn't allowed. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const done = document.execCommand?.("copy") ?? false;
    field.remove();
    return done;
  }
}
