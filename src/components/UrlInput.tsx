import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { strings } from "../lib/strings";
import { SpinnerIcon } from "./icons";

export interface UrlInputHandle {
  focus: () => void;
}

interface UrlInputProps {
  ref?: Ref<UrlInputHandle>;
  /** Adds the link to the library; resolves to true when the field should be cleared. */
  onAdd: (url: string) => Promise<boolean>;
  /** Called when the text changes, e.g. to dismiss the outcome of the last add. */
  onEdit: () => void;
  /** Arrow down leaves the field towards whatever is below it. */
  onArrowDown: () => void;
}

export function UrlInput({ ref, onAdd, onEdit, onArrowDown }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  // The popover is one long-lived window: every time it opens, typing should just work.
  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    window.addEventListener("focus", focusInput);
    return () => window.removeEventListener("focus", focusInput);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onArrowDown();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || adding) return;

    setAdding(true);
    try {
      if (await onAdd(trimmed)) setUrl("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-1.5">
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          onEdit();
        }}
        onKeyDown={handleKeyDown}
        placeholder={strings.urlInput.placeholder}
        aria-label={strings.urlInput.label}
        autoFocus
        spellCheck={false}
        className="field"
      />
      <button
        type="submit"
        tabIndex={-1}
        disabled={adding || !url.trim()}
        aria-busy={adding}
        aria-label={adding ? strings.urlInput.adding : undefined}
        className="button"
      >
        {/* The label keeps its place while the spinner covers for it, so the button never changes width. */}
        <span className="busy-swap" data-busy={adding}>
          <span>{strings.urlInput.submit}</span>
          <SpinnerIcon />
        </span>
      </button>
    </form>
  );
}
