import DOMPurify from "dompurify";
import { useEffect, useRef, type ClipboardEvent } from "react";

interface RichTextEditorProps {
  value?: string | null;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

function clean(value: string): string {
  return DOMPurify.sanitize(value, { USE_PROFILES: { html: true } });
}

export function RichTextEditor({ value, onChange, onBlur, placeholder, className }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const safeValue = clean(value ?? "");

  useEffect(() => {
    const node = ref.current;
    if (node && document.activeElement !== node && node.innerHTML !== safeValue) node.innerHTML = safeValue;
  }, [safeValue]);

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    document.execCommand("insertHTML", false, clean(html));
  }

  return (
    <div
      ref={ref}
      className={["rich-editor", className].filter(Boolean).join(" ")}
      contentEditable
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      suppressContentEditableWarning
      onInput={(event) => onChange(clean(event.currentTarget.innerHTML))}
      onPaste={handlePaste}
      onBlur={(event) => {
        const sanitized = clean(event.currentTarget.innerHTML);
        if (event.currentTarget.innerHTML !== sanitized) event.currentTarget.innerHTML = sanitized;
        onChange(sanitized);
        onBlur?.();
      }}
    />
  );
}
