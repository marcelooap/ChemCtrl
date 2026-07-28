import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export default function SearchableSelect({
  options = [],
  value = "",
  onChange,
  getOptionLabel = (o) => o.nome || o.produto || String(o),
  getOptionValue = (o) => o.id,
  placeholder = "Selecione uma opção",
  disabled = false,
  inputClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((o) => {
    const label = getOptionLabel(o);
    if (!label) return false;
    if (!search) return true;
    return label.toLowerCase().includes(search.toLowerCase());
  });

  const handleSelect = (option) => {
    const label = getOptionLabel(option);
    onChange(label, option);
    setSearch("");
    setOpen(false);
  };

  const handleInputChange = (e) => {
    setSearch(e.target.value);
    onChange(e.target.value, null);
    if (!open) setOpen(true);
  };

  const handleFocus = () => {
    if (disabled) return;
    setOpen(true);
    setSearch("");
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          value={search || value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-3 py-2 pr-9 rounded-md border bg-card text-sm transition-colors focus:outline-none ${
            disabled
              ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
              : open
              ? "border-blue-500 ring-1 ring-blue-500"
              : "border-border hover:border-slate-400"
          } ${!disabled && inputClassName ? inputClassName : ""}`}
        />
        <ChevronDown
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-card rounded-md border border-border shadow-lg overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                Nenhuma opção encontrada
              </div>
            ) : (
              filtered.map((option, i) => {
                const label = getOptionLabel(option);
                return (
                  <div
                    key={getOptionValue(option) || i}
                    onClick={() => handleSelect(option)}
                    className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                      value === label
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/80 hover:bg-muted/40"
                    }`}
                  >
                    {label}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}