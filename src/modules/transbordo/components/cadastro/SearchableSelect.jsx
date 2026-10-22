import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@shared/lib/utils";

export default function SearchableSelect({
  options = [],
  value = "",
  onChange,
  getOptionLabel = (o) => o.nome || o.produto || String(o),
  getOptionValue = (o) => o.id,
  placeholder = "Selecione uma opção",
  disabled = false,
  inputClassName = "",
  renderOption = null,
  selectOnly = false,
  openOnFocus = true,
  /** Campo limpo ao focar: o que for digitado só filtra a lista. */
  typeToSearch = false,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        if (typeToSearch) setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [typeToSearch]);

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
    if (selectOnly) return;
    setSearch(e.target.value);
    if (!typeToSearch) onChange(e.target.value, null);
    if (!open) setOpen(true);
  };

  const handleFocus = () => {
    if (disabled || selectOnly || !openOnFocus) return;
    setOpen(true);
    setSearch("");
  };

  const handleClick = () => {
    if (disabled || selectOnly || openOnFocus) return;
    setSearch("");
    setOpen(true);
  };

  const handleToggle = (e) => {
    if (disabled || !selectOnly) return;
    e.preventDefault();
    setSearch("");
    setOpen((current) => !current);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          value={
            selectOnly
              ? value
              : typeToSearch
                ? open
                  ? search
                  : value
                : search || value
          }
          onChange={handleInputChange}
          onFocus={handleFocus}
          onClick={handleClick}
          onMouseDown={selectOnly ? handleToggle : undefined}
          readOnly={selectOnly}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-readonly={selectOnly || undefined}
          className={cn(
            "w-full px-3 py-2 pr-9 rounded-md border bg-card text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none",
            disabled
              ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
              : open
              ? "border-blue-500 ring-1 ring-blue-500"
              : "border-border hover:border-slate-400",
            selectOnly && "cursor-pointer caret-transparent",
            !disabled && inputClassName
          )}
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
                    {renderOption ? renderOption(option, label) : label}
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