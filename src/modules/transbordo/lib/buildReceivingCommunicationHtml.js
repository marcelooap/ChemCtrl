import { formatMass, formatVolume, formatDensidade } from "@transbordo/lib/format";

const FONT = "Arial,Helvetica,sans-serif";
const C = {
  text: "#111827",
  muted: "#64748b",
  title: "#2563eb",
  border: "#d9dee7",
  headerBg: "#f1f5f9",
  cardBg: "#f8fafc",
  totalBg: "#f8fafc",
  greenBg: "#dcfce7",
  greenText: "#15803d",
  redBg: "#fee2e2",
  redText: "#b91c1c",
};

const SIGNATURE = {
  name: "Marcelo Amaral Pinheiro Filho",
  role: "Qualidade | Químico Júnior",
  email: "laboratório.macae@intertank.com.br",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sectionLabel(text) {
  return `
<tr>
  <td style="font-family:${FONT};font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;padding:14px 0 6px 0;">
    ${esc(text)}
  </td>
</tr>`;
}

function th(label, width, align = "left") {
  return `<th width="${width}" style="width:${width}px;font-family:${FONT};font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:0.04em;text-align:${align};background-color:${C.headerBg};border-bottom:1px solid ${C.border};padding:6px 8px;white-space:nowrap;">${esc(label)}</th>`;
}

function td(value, width, align = "left", extra = "") {
  return `<td width="${width}" style="width:${width}px;font-family:${FONT};font-size:12px;color:${C.text};text-align:${align};border-bottom:1px solid ${C.border};padding:6px 8px;white-space:nowrap;${extra}">${esc(value)}</td>`;
}

/**
 * HTML Outlook-safe da comunicação de recebimento (larguras fixas, texto pesquisável).
 * @param {object} receiving
 * @returns {{ html: string, text: string }}
 */
export function buildReceivingCommunicationHtml(receiving) {
  const {
    entradaId = "-",
    dataEntrada = "-",
    lotes = [],
    hasPesagem = false,
    pesoBruto = "-",
    pesoLiquido = "-",
    tara = "-",
    margemLabel = null,
    dentroMargem = false,
    destinos = [],
    totais = { volume: 0, massa: 0 },
  } = receiving || {};

  const title = `Recebimento ${entradaId || "-"}`;

  // Produtos: 80+250+100+90+60+100 = 680
  const pCols = { cod: 80, prod: 250, nf: 100, qty: 90, und: 60, lote: 100 };
  const produtosRows = (lotes.length ? lotes : [{}])
    .map(
      (l) => `<tr>
        ${td(l.produto_codigo || "-", pCols.cod)}
        ${td(l.produto_nome || "-", pCols.prod)}
        ${td(l.nota_fiscal || "-", pCols.nf)}
        ${td(l.quantidadeFmt || "-", pCols.qty, "right")}
        ${td(l.unidade_medida || "-", pCols.und)}
        ${td(l.lote || "-", pCols.lote)}
      </tr>`
    )
    .join("");

  // Qualidade: 120+90+90+80 = 380
  const qCols = { lote: 120, fab: 90, val: 90, dens: 80 };
  const qualidadeRows = (lotes.length ? lotes : [{}])
    .map(
      (l) => `<tr>
        ${td(l.lote || "-", qCols.lote)}
        ${td(l.fabricacaoFmt || "-", qCols.fab)}
        ${td(l.validadeFmt || "-", qCols.val)}
        ${td(l.densidadeFmt || "-", qCols.dens)}
      </tr>`
    )
    .join("");

  let pesagemBlock = "";
  if (hasPesagem) {
    const margemHtml = margemLabel
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-family:${FONT};font-size:10px;font-weight:600;background-color:${dentroMargem ? C.greenBg : C.redBg};color:${dentroMargem ? C.greenText : C.redText};">${esc(margemLabel)}</span>`
      : "—";

    pesagemBlock = `
      ${sectionLabel("Pesagem")}
      <tr>
        <td style="padding:0;">
          <table width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;border-collapse:collapse;table-layout:fixed;border:1px solid ${C.border};font-family:${FONT};">
            <thead>
              <tr>
                ${th("Peso Bruto (kg)", 130)}
                ${th("Peso Líquido (kg)", 130)}
                ${th("Tara (kg)", 110)}
                ${th("Margem", 150)}
              </tr>
            </thead>
            <tbody>
              <tr>
                ${td(pesoBruto, 130)}
                ${td(pesoLiquido, 130)}
                ${td(tara, 110)}
                <td width="150" style="width:150px;font-family:${FONT};font-size:12px;color:${C.text};border-bottom:1px solid ${C.border};padding:6px 8px;">${margemHtml}</td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>`;
  }

  let transbordoBlock = "";
  if (destinos.length > 0) {
    const tCols = { op: 90, dest: 320, vol: 135, massa: 135 };
    const rows = destinos
      .map(
        (d) => `<tr>
          ${td(d.codigo || "-", tCols.op)}
          ${td(d.destino || "-", tCols.dest)}
          ${td(d.volumeFmt || "-", tCols.vol, "right")}
          ${td(d.massaFmt || "-", tCols.massa, "right")}
        </tr>`
      )
      .join("");

    transbordoBlock = `
      ${sectionLabel("Transbordo")}
      <tr>
        <td style="padding:0;">
          <table width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;border-collapse:collapse;table-layout:fixed;border:1px solid ${C.border};font-family:${FONT};">
            <thead>
              <tr>
                ${th("OP", tCols.op)}
                ${th("Destino", tCols.dest)}
                ${th("Volume (L)", tCols.vol, "right")}
                ${th("Massa (kg)", tCols.massa, "right")}
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr>
                <td colspan="2" width="410" style="width:410px;font-family:${FONT};font-size:12px;font-weight:700;color:${C.text};background-color:${C.totalBg};padding:6px 8px;">Total</td>
                <td width="135" style="width:135px;font-family:${FONT};font-size:12px;font-weight:700;color:${C.text};text-align:right;background-color:${C.totalBg};padding:6px 8px;">${esc(totais.volumeFmt || "-")}</td>
                <td width="135" style="width:135px;font-family:${FONT};font-size:12px;font-weight:700;color:${C.text};text-align:right;background-color:${C.totalBg};padding:6px 8px;">${esc(totais.massaFmt || "-")}</td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>`;
  }

  const html = `
<table width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:680px;border-collapse:collapse;font-family:${FONT};font-size:12px;color:${C.text};background-color:#ffffff;">
  <tr>
    <td style="font-family:${FONT};font-size:16px;font-weight:600;color:${C.title};padding:0 0 12px 0;">
      ${esc(title)}
    </td>
  </tr>

  <tr>
    <td style="padding:0 0 4px 0;">
      <table width="540" cellpadding="0" cellspacing="0" border="0" style="width:540px;border-collapse:collapse;border:1px solid ${C.border};background-color:${C.cardBg};">
        <tr>
          <td width="270" style="width:270px;vertical-align:top;padding:10px 14px;">
            <div style="font-family:${FONT};font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.05em;">ID de Entrada</div>
            <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.text};margin-top:2px;">${esc(entradaId || "-")}</div>
          </td>
          <td width="270" style="width:270px;vertical-align:top;padding:10px 14px;">
            <div style="font-family:${FONT};font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.05em;">Data de Entrada</div>
            <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.text};margin-top:2px;">${esc(dataEntrada || "-")}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  ${sectionLabel("Produtos Recebidos")}
  <tr>
    <td style="padding:0;">
      <table width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;border-collapse:collapse;table-layout:fixed;border:1px solid ${C.border};font-family:${FONT};">
        <thead>
          <tr>
            ${th("Cód", pCols.cod)}
            ${th("Produto", pCols.prod)}
            ${th("Nota Fiscal", pCols.nf)}
            ${th("Quantidade", pCols.qty, "right")}
            ${th("Unidade", pCols.und)}
            ${th("Lote", pCols.lote)}
          </tr>
        </thead>
        <tbody>
          ${produtosRows}
        </tbody>
      </table>
    </td>
  </tr>

  ${sectionLabel("Controle de Qualidade")}
  <tr>
    <td style="padding:0;">
      <table width="380" cellpadding="0" cellspacing="0" border="0" style="width:380px;border-collapse:collapse;table-layout:fixed;border:1px solid ${C.border};font-family:${FONT};">
        <thead>
          <tr>
            ${th("Lote", qCols.lote)}
            ${th("Fabricação", qCols.fab)}
            ${th("Validade", qCols.val)}
            ${th("Densidade", qCols.dens)}
          </tr>
        </thead>
        <tbody>
          ${qualidadeRows}
        </tbody>
      </table>
    </td>
  </tr>

  ${pesagemBlock}
  ${transbordoBlock}

  <tr>
    <td style="padding:20px 0 0 0;font-family:${FONT};color:${C.text};">
      <div style="font-size:13px;font-weight:700;line-height:1.35;">${esc(SIGNATURE.name)}</div>
      <div style="font-size:12px;color:${C.muted};line-height:1.35;margin-top:2px;">${esc(SIGNATURE.role)}</div>
      <div style="font-size:12px;color:${C.title};line-height:1.35;margin-top:2px;">${esc(SIGNATURE.email)}</div>
    </td>
  </tr>
</table>
`.trim();

  const textLines = [
    title,
    "",
    `ID de Entrada: ${entradaId || "-"}`,
    `Data de Entrada: ${dataEntrada || "-"}`,
    "",
    "Produtos Recebidos",
    ...(lotes.length ? lotes : [{}]).map(
      (l) =>
        `${l.produto_codigo || "-"} | ${l.produto_nome || "-"} | ${l.nota_fiscal || "-"} | ${l.quantidadeFmt || "-"} | ${l.unidade_medida || "-"} | ${l.lote || "-"}`
    ),
    "",
    "Controle de Qualidade",
    ...(lotes.length ? lotes : [{}]).map(
      (l) =>
        `${l.lote || "-"} | ${l.fabricacaoFmt || "-"} | ${l.validadeFmt || "-"} | ${l.densidadeFmt || "-"}`
    ),
  ];

  if (hasPesagem) {
    textLines.push(
      "",
      "Pesagem",
      `Bruto: ${pesoBruto} | Líquido: ${pesoLiquido} | Tara: ${tara} | Margem: ${margemLabel || "—"}`
    );
  }

  if (destinos.length > 0) {
    textLines.push("", "Transbordo");
    destinos.forEach((d) => {
      textLines.push(
        `${d.codigo || "-"} | ${d.destino || "-"} | ${d.volumeFmt || "-"} | ${d.massaFmt || "-"}`
      );
    });
    textLines.push(
      `Total | ${totais.volumeFmt || "-"} | ${totais.massaFmt || "-"}`
    );
  }

  textLines.push("", SIGNATURE.name, SIGNATURE.role, SIGNATURE.email);

  return { html, text: textLines.join("\n") };
}

/** Helpers reutilizados pelo dialog ao montar o payload. */
export function formatReceivingLoteRow(lote, { notaFiscal, densidade, formatDate }) {
  return {
    produto_codigo: lote.produto_codigo,
    produto_nome: lote.produto_nome,
    nota_fiscal: lote.nota_fiscal || notaFiscal,
    quantidadeFmt: formatMass(lote.quantidade, { empty: "-" }),
    unidade_medida: lote.unidade_medida,
    lote: lote.lote,
    fabricacaoFmt: formatDate(lote.data_fabricacao),
    validadeFmt: formatDate(lote.data_validade),
    densidadeFmt: formatDensidade(densidade),
  };
}

export function formatReceivingDestinoRow(d) {
  return {
    codigo: d.codigo,
    destino: d.destino,
    volumeFmt: formatVolume(d.volume, { empty: "-" }),
    massaFmt: formatMass(d.massa, { empty: "-" }),
  };
}

export const RECEIVING_SIGNATURE = SIGNATURE;
