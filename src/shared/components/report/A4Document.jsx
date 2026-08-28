import { forwardRef } from "react";
import "./a4-document.css";

/**
 * Blocos reutilizáveis para relatórios A4 imprimíveis.
 *
 * Espelham a estrutura dos PDFs jsPDF do sistema (título + régua azul,
 * seções com barra de destaque, grade de informações, tabelas zebradas e
 * rodapé), de modo que documentos HTML e PDFs mantenham a mesma identidade.
 */

/** Container da tela de visualização: fundo cinza + folha centralizada. */
export function A4Viewer({ toolbar, children }) {
  return (
    <div className="a4-viewer">
      {toolbar ? <div className="a4-toolbar a4-no-print">{toolbar}</div> : null}
      {children}
    </div>
  );
}

/** Folha A4 propriamente dita. */
export const A4Sheet = forwardRef(function A4Sheet({ children }, ref) {
  return (
    <article ref={ref} className="a4-sheet">
      {children}
    </article>
  );
});

export function ReportHeader({ organization, title, subtitle, logoSrc, aside }) {
  return (
    <>
      <header className="a4-header">
        <div>
          {organization ? <p className="a4-header__org">{organization}</p> : null}
          <h1 className="a4-header__title">{title}</h1>
          {subtitle ? <p className="a4-header__subtitle">{subtitle}</p> : null}
        </div>
        <div className="a4-header__aside">
          {logoSrc ? <img className="a4-header__logo" src={logoSrc} alt="" /> : null}
          {aside}
        </div>
      </header>
      <div className="a4-header__rule" />
    </>
  );
}

const BADGE_VARIANTS = new Set(["success", "danger", "neutral"]);

/** Selo compacto para destacar um estado dentro do documento. */
export function ReportBadge({ variant = "neutral", children }) {
  const safe = BADGE_VARIANTS.has(variant) ? variant : "neutral";
  return <span className={`a4-badge a4-badge--${safe}`}>{children}</span>;
}

export function ReportSection({ title, children }) {
  return (
    <section className="a4-section">
      {title ? <h2 className="a4-section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

/**
 * Grade rotulada de informações.
 * @param {{
 *   items: Array<{ label: string, value: import('react').ReactNode }>,
 *   columns?: number,
 *   centered?: boolean,
 * }} props
 */
export function ReportInfoGrid({ items, columns = 3, centered = false }) {
  const visible = (items || []).filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <div
      className={[
        "a4-grid",
        columns >= 5 ? "a4-grid--compact" : "",
        centered ? "a4-grid--centered" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {visible.map((item, index) => {
        const isFirstCol = index % columns === 0;
        const isFirstRow = index < columns;
        return (
          <div
            key={`${item.label}-${index}`}
            className={[
              "a4-grid__cell",
              isFirstCol ? "a4-grid__cell--first-col" : "",
              isFirstRow ? "a4-grid__cell--first-row" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="a4-grid__label">{item.label}</div>
            <div className="a4-grid__value">{item.value ?? "-"}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tabela de documento.
 * @param {{
 *   columns: Array<{
 *     key: string,
 *     label: string,
 *     align?: 'left'|'right'|'center',
 *     width?: string,
 *     nowrap?: boolean,
 *   }>,
 *   rows: Array<Record<string, import('react').ReactNode>>
 * }} props
 */
export function ReportTable({ columns, rows }) {
  const cellClass = (col) =>
    [
      col.align === "right"
        ? "a4-align-right"
        : col.align === "center"
          ? "a4-align-center"
          : "",
      col.nowrap ? "a4-nowrap" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <table className="a4-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={cellClass(col)} style={{ width: col.width }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.__key ?? index}>
            {columns.map((col) => (
              <td key={col.key} className={cellClass(col)}>
                {row[col.key] ?? "-"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportNote({ children }) {
  return <div className="a4-note">{children}</div>;
}

/**
 * Área de assinaturas. O nome fica acima da linha, para que a rubrica seja
 * lançada sobre ele; o papel de quem assina fica abaixo.
 * @param {{ signatures: Array<{ role: string, name?: string, hint?: string }> }} props
 */
export function ReportSignatures({ signatures }) {
  const visible = (signatures || []).filter(Boolean);
  if (visible.length === 0) return null;

  // Uma assinatura sozinha não deve esticar por toda a largura da folha.
  const columns =
    visible.length === 1
      ? "minmax(0, 75mm)"
      : `repeat(${visible.length}, minmax(0, 1fr))`;

  return (
    <div className="a4-signatures" style={{ gridTemplateColumns: columns }}>
      {visible.map((item) => (
        <div key={item.role} className="a4-signature">
          <div className="a4-signature__name">{item.name || "\u00a0"}</div>
          <div className="a4-signature__line">
            <div className="a4-signature__role">{item.role}</div>
            {item.hint ? <div className="a4-signature__hint">{item.hint}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReportFooter({ left, right }) {
  return (
    <footer className="a4-footer">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
