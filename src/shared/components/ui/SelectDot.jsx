/**
 * Seletor circular (bolinha) para seleção de linhas em tabelas.
 */
export function SelectDot({
  checked,
  indeterminate = false,
  disabled = false,
  onClick,
  label,
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? "border-primary bg-primary"
          : indeterminate
            ? "border-primary bg-background"
            : "border-muted-foreground/40 bg-background hover:border-primary"
      }`}
    >
      {checked ? (
        <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
      ) : indeterminate ? (
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

export default SelectDot;
