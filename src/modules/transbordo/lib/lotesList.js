/**
 * `t_estoque.lotes` e a vista `ep_estoque` nem sempre chegam como array.
 * A vista nova devolve um objeto JSON; registros antigos às vezes vêm como texto.
 * A tela trata lote como lista — um objeto solto derruba o render (.some/.map).
 */

export function asLoteList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return asLoteList(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (typeof value === "object") return [value];
  return [];
}

export function withLoteList(row) {
  if (!row || typeof row !== "object" || !Object.prototype.hasOwnProperty.call(row, "lotes")) {
    return row;
  }
  const lotes = asLoteList(row.lotes);
  if (lotes === row.lotes) return row;
  return { ...row, lotes };
}
