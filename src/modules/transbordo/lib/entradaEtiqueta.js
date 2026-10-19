import { printPreparedLabelPages } from "@industrializacao/lib/labelprint";
import {
  formatEtiquetaDate,
  formatEtiquetaEmbalagemPlaca,
} from "@transbordo/lib/etiquetaConfig";
import { formatQuantidade } from "@transbordo/lib/format";
import { resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/** Lotes da entrada, com fallback para o registro antigo de um único produto. */
export function getEntradaLotes(entrada) {
  if (entrada?.lotes?.length > 0) return entrada.lotes;
  return [
    {
      produto_id: entrada?.produto_id,
      produto_codigo: entrada?.produto_codigo,
      produto_nome: entrada?.produto_nome,
      nota_fiscal: entrada?.nota_fiscal,
      lote: entrada?.lote,
      quantidade: entrada?.quantidade,
      unidade_medida: entrada?.unidade_medida,
      tipo_recebimento: entrada?.tipo_recebimento,
      embalado: entrada?.embalado,
      peso_liquido: entrada?.peso_liquido,
      quantidade_embalagens: entrada?.quantidade_embalagens,
      placa: entrada?.placa,
      barril: entrada?.barril,
    },
  ];
}

function produtoKey(lote) {
  return [
    lote?.produto_id || "",
    String(lote?.produto_codigo || "").trim(),
    String(lote?.produto_nome || "").trim(),
  ].join("|");
}

/** Rótulo da lista suspensa. O lote entra só quando o mesmo produto se repete. */
export function entradaEtiquetaOptionLabel(lote, index, lotes) {
  const nome = String(lote?.produto_nome || "").trim() || "Produto";
  const codigo = String(lote?.produto_codigo || "").trim();
  const base = codigo ? `${codigo} — ${nome}` : nome;
  const duplicates = (lotes || []).filter((item) => produtoKey(item) === produtoKey(lote));
  if (duplicates.length < 2) return base;
  const loteNome = String(lote?.lote || "").trim();
  return loteNome ? `${base} · ${loteNome}` : `${base} · ${index + 1}`;
}

function embalagemDaEntrada(lote) {
  const tipo = resolveTipoRecebimento(lote);
  if (tipo === "granel") {
    return { granel: true, text: "GRANEL" };
  }
  if (tipo === "vasilhame") {
    const placa = formatEtiquetaEmbalagemPlaca(lote?.placa, lote?.barril);
    return { granel: false, text: placa || "Vasilhame" };
  }
  const named = String(lote?.tipo_embalagem || lote?.packaging_type || "").trim();
  if (named && !/^embalado$/i.test(named)) {
    return { granel: false, text: named };
  }
  return { granel: false, text: "Embalado" };
}

export function origemEtiquetaLabel(entrada) {
  return entrada?.origem === "industrializacao" ? "Industrialização" : "Armazenagem";
}

export function buildEntradaEtiquetaModel(
  entrada,
  lote,
  { dateFormat = "dmy", language = "pt-BR", entradaCodigo = "" } = {}
) {
  const quantidade = formatQuantidade(lote?.quantidade, { empty: "—" });
  const unidade = String(lote?.unidade_medida || "").trim();
  const quantidadeTexto =
    unidade && quantidade !== "—" ? `${quantidade} ${unidade}` : quantidade;
  const embalagem = embalagemDaEntrada(lote);
  const codigo = String(entradaCodigo || entrada?.entrada_codigo || "").trim();

  return {
    produto: String(lote?.produto_nome || entrada?.produto_nome || "").trim() || "—",
    cliente: String(entrada?.cliente_nome || "").trim() || "—",
    lote: String(lote?.lote || "").trim() || "—",
    data: formatEtiquetaDate(
      entrada?.data || entrada?.created_date || entrada?.created_at,
      dateFormat,
      language
    ),
    quantidade: quantidadeTexto,
    granel: embalagem.granel,
    embalagem: embalagem.text,
    id: codigo || "—",
    origem: origemEtiquetaLabel(entrada),
  };
}

function fieldRow(label, value) {
  return `<div class="field-row"><span class="lbl">${escapeHtml(label)}</span><span class="sep">•</span><span class="val">${escapeHtml(value)}</span></div>`;
}

const ENTRADA_LABEL_CSS = `
.label.entrada {
  justify-content: flex-start;
  gap: 1mm;
  padding: 1.8mm 3.2mm 1.5mm;
}
.label.entrada .entrada-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2mm;
}
.label.entrada .product {
  flex: 1;
  min-width: 0;
  font-size: 12.5pt;
  line-height: 1.05;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.label.entrada .entrada-id {
  flex-shrink: 0;
  font-size: 8pt;
  font-weight: 800;
  line-height: 1.1;
  text-align: right;
  padding-top: 0.4mm;
}
.label.entrada .entrada-id .lbl { text-transform: uppercase; }
.label.entrada .entrada-id .sep { margin: 0 0.5mm; }
.label.entrada .entrada-cliente {
  display: flex;
  align-items: baseline;
  gap: 1.6mm;
  border-top: 0.6px solid #000;
  border-bottom: 0.6px solid #000;
  padding: 0.8mm 0;
}
.label.entrada .entrada-cliente .lbl {
  font-size: 7pt;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.label.entrada .entrada-cliente .val {
  flex: 1;
  min-width: 0;
  font-size: 13pt;
  font-weight: 800;
  line-height: 1.05;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.label.entrada .entrada-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  column-gap: 3mm;
  row-gap: 1.1mm;
  align-content: space-evenly;
}
.label.entrada .entrada-grid .field-row { font-size: 8pt; }
.label.entrada .footer {
  margin-top: 0;
  padding-top: 0.7mm;
  border-top: 0.6px solid #000;
  font-size: 10pt;
}
.label.entrada .footer .emb { font-size: 10.5pt; }
.label.entrada.vertical {
  padding: 2mm 2.4mm 1.8mm;
  gap: 1.4mm;
}
.label.entrada.vertical .product {
  text-align: center;
  border-bottom: none;
  margin: 0;
  padding: 0;
  font-size: 13pt;
}
.label.entrada.vertical .entrada-head {
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.label.entrada.vertical .entrada-id { text-align: center; padding-top: 0; }
.label.entrada.vertical .entrada-cliente { justify-content: center; }
.label.entrada.vertical .entrada-cliente .val { flex: 0 1 auto; text-align: center; }
.label.entrada.vertical .entrada-grid { grid-template-columns: 1fr; row-gap: 1.4mm; }
`;

export function buildEntradaEtiquetaHtml(model, labels, { vertical = false } = {}) {
  const rows = [
    fieldRow(labels.lote, model.lote),
    fieldRow(labels.data, model.data),
    fieldRow(labels.quantidade, model.quantidade),
    fieldRow(labels.origem, model.origem),
  ].join("");

  const footer = model.granel
    ? `<div class="footer"><span class="emb">${escapeHtml(model.embalagem)}</span></div>`
    : `<div class="footer"><span>${escapeHtml(labels.embalagem)}</span><span class="sep">•</span><span class="emb">${escapeHtml(model.embalagem)}</span></div>`;

  return `<div class="label entrada${vertical ? " vertical" : ""}">
  <div class="entrada-head">
    <div class="product">${escapeHtml(model.produto)}</div>
    <div class="entrada-id"><span class="lbl">${escapeHtml(labels.id)}</span><span class="sep">•</span><span>${escapeHtml(model.id)}</span></div>
  </div>
  <div class="entrada-cliente"><span class="lbl">${escapeHtml(labels.cliente)}</span><span class="val">${escapeHtml(model.cliente)}</span></div>
  <div class="entrada-grid">${rows}</div>
  ${footer}
</div>`;
}

export function printEntradaEtiqueta(
  model,
  { copies = 1, orientation = "horizontal", locale, labels } = {}
) {
  const vertical = orientation === "vertical";
  const body = buildEntradaEtiquetaHtml(model, labels, { vertical });
  const count = Math.max(1, Math.round(Number(copies) || 1));
  printPreparedLabelPages({
    title: model.produto && model.produto !== "—" ? model.produto : "Etiqueta",
    locale,
    orientation,
    pages: Array.from({ length: count }, () => body),
    extraCss: ENTRADA_LABEL_CSS,
  });
}
