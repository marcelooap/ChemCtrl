import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";

/** yyyy-mm-dd → dd/mm/yyyy */
export function isoToBr(iso) {
  if (!iso || typeof iso !== "string") return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** dd/mm/yyyy → yyyy-mm-dd (ou "" se inválido) */
export function brToIso(br) {
  const digits = String(br || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  const year = parseInt(y, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return "";
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return "";
  }
  return `${y}-${m}-${d}`;
}

function maskBr(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Campo de data com exibição PT-BR (dd/mm/yyyy).
 * `value` / `onChange` usam ISO yyyy-mm-dd (compatível com o backend).
 */
export default function DateInputBr({
  value = "",
  onChange,
  disabled = false,
  placeholder = "dd/mm/aaaa",
  className = "",
}) {
  const nativeRef = useRef(null);
  const [text, setText] = useState(() => isoToBr(value));

  useEffect(() => {
    setText(isoToBr(value));
  }, [value]);

  const handleTextChange = (e) => {
    const masked = maskBr(e.target.value);
    setText(masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length === 0) {
      onChange?.("");
      return;
    }
    if (digits.length === 8) {
      const iso = brToIso(masked);
      onChange?.(iso);
      if (iso) setText(isoToBr(iso));
    }
  };

  const handleNativeChange = (e) => {
    const iso = e.target.value || "";
    onChange?.(iso);
    setText(isoToBr(iso));
  };

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={handleTextChange}
        onBlur={() => {
          if (value) {
            setText(isoToBr(value));
          } else if (text.replace(/\D/g, "").length > 0 && !brToIso(text)) {
            setText("");
            onChange?.("");
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-3 py-2 pr-9 rounded-md border bg-card text-sm transition-colors focus:outline-none ${
          disabled
            ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
            : "border-border hover:border-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        }`}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            const el = nativeRef.current;
            if (!el) return;
            if (typeof el.showPicker === "function") {
              try {
                el.showPicker();
                return;
              } catch {
                /* fallback abaixo */
              }
            }
            el.click();
          }}
          className="absolute inset-0 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 pointer-events-none"
          aria-hidden
        >
          <Calendar className="w-4 h-4" />
        </button>
        <input
          ref={nativeRef}
          type="date"
          value={value || ""}
          onChange={handleNativeChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label="Abrir calendário"
        />
      </div>
    </div>
  );
}
