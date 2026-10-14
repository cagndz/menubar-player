import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { strings } from "../lib/strings";
import { SpinnerIcon } from "./icons";

export interface UrlInputHandle {
  focus: () => void;
  /** Puts the text in the field and adds it, exactly as typing it and pressing Add would. */
  add: (text: string) => void;
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
  const addingRef = useRef(false);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const inputRef = useRef<HTMLInputElement>(null);

  const add = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || addingRef.current) return;

    addingRef.current = true;
    setAdding(true);
    try {
      if (await onAdd(trimmed)) {
        setUrl("");
      } else {
        // The link stays, selected, so pasting another one replaces it at once.
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  // The handle is made once; it calls whatever `add` is current.
  const addRef = useRef(add);
  addRef.current = add;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      add: (text) => {
        setUrl(text);
        onEditRef.current();
        void addRef.current(text);
      },
    }),
    [],
  );

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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void add(url);
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
