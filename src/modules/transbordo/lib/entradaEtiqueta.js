import { printStandardLabel } from "@industrializacao/lib/labelprint";
import { fmtNumber } from "@/i18n/formatters";
import { loteToLitros } from "@transbordo/lib/conversao";
import {
  formatEtiquetaDate,
  formatEtiquetaEmbalagemPlaca,
} from "@transbordo/lib/etiquetaConfig";
import { CONSULTA_ENTRADA_PATH } from "@transbordo/lib/ensureEntradaPublicToken";
import { resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";

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
      data_fabricacao: entrada?.data_fabricacao,
      data_validade: entrada?.data_validade,
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

function positiveNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveEntradaEtiquetaWeights(entrada, lote) {
  const tipo = resolveTipoRecebimento(lote);
  const pesagemDisponivel =
    tipo === "granel" &&
    (entrada?.granel_pesagem ||
      entrada?.granel_peso_liquido != null ||
      entrada?.granel_peso_bruto != null);
  if (pesagemDisponivel) {
    return {
      net: positiveNumber(entrada?.granel_peso_liquido),
      gross: positiveNumber(entrada?.granel_peso_bruto),
    };
  }
  return {
    net: positiveNumber(lote?.peso_liquido),
    gross: positiveNumber(lote?.peso_bruto),
  };
}

export function resolveEntradaEtiquetaVolumeLitros(lote) {
  const declared = positiveNumber(lote?.volume);
  if (declared) return declared;
  const unit = String(lote?.unidade_medida || "").trim().toLowerCase();
  if (unit === "l" || unit === "lt" || unit === "litro" || unit === "litros") {
    return positiveNumber(lote?.quantidade);
  }
  const liters = loteToLitros(lote);
  return liters > 0 ? liters : null;
}

function embalagemDaEntrada(lote) {
  const tipo = resolveTipoRecebimento(lote);
  if (tipo === "granel") return "GRANEL";
  if (tipo === "vasilhame") {
    return formatEtiquetaEmbalagemPlaca(lote?.placa, lote?.barril) || "Vasilhame";
  }
  const named = String(lote?.tipo_embalagem || lote?.packaging_type || "").trim();
  if (named && !/^embalado$/i.test(named)) return named;
  return "Embalado";
}

/** Mantém o layout configurado do cliente e garante o QR do recebimento. */
export function withEntradaEtiquetaCampos(campos, { hasNet, hasGross, hasVolume } = {}) {
  return (campos || []).map((campo) => {
    if (!campo || campo.key === "_opcoes") return campo;
    if (campo.key === "qr") return { ...campo, enabled: true };
    if (campo.key === "peso_liquido" && !hasNet) return { ...campo, enabled: false };
    if (campo.key === "peso_bruto" && !hasGross) return { ...campo, enabled: false };
    if (campo.key === "volume" && !hasVolume) return { ...campo, enabled: false };
    return campo;
  });
}

export function buildEntradaEtiquetaModel(entrada, lote, { entradaCodigo = "" } = {}) {
  const weights = resolveEntradaEtiquetaWeights(entrada, lote);
  const codigo = String(entradaCodigo || entrada?.entrada_codigo || "").trim();
  return {
    produto: String(lote?.produto_nome || entrada?.produto_nome || "").trim() || "—",
    cliente: String(entrada?.cliente_nome || "").trim() || "—",
    lote: String(lote?.lote || "").trim() || "—",
    id: codigo || "—",
    fabricacao: lote?.data_fabricacao || entrada?.data_fabricacao || null,
    validade: lote?.data_validade || entrada?.data_validade || null,
    netWeight: weights.net,
    grossWeight: weights.gross,
    volumeLitros: resolveEntradaEtiquetaVolumeLitros(lote),
    embalagem: embalagemDaEntrada(lote),
  };
}

function formatWeight(value, locale) {
  if (value == null) return "—";
  return fmtNumber(
    Math.round(Number(value)),
    { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    locale
  );
}

function formatVolume(value, locale) {
  if (value == null) return "—";
  return `${fmtNumber(value, { maximumFractionDigits: 3 }, locale)} L`;
}

export async function printEntradaEtiqueta(
  model,
  {
    copies = 1,
    orientation = "horizontal",
    locale,
    dateFormat = "dmy",
    campos,
    publicToken,
    responsavelTecnico,
    qrHint,
  } = {}
) {
  if (!publicToken) {
    throw new Error("Token público indisponível para o QR code.");
  }

  await printStandardLabel({
    title: model?.produto && model.produto !== "—" ? model.produto : "Etiqueta",
    product: model?.produto || "—",
    refId: model?.id || "—",
    lot: model?.lote || "—",
    client: model?.cliente || "—",
    fabDate: formatEtiquetaDate(model?.fabricacao, dateFormat, locale),
    valDate: formatEtiquetaDate(model?.validade, dateFormat, locale),
    netWeight: formatWeight(model?.netWeight, locale),
    grossWeight: formatWeight(model?.grossWeight, locale),
    volume: formatVolume(model?.volumeLitros, locale),
    embalagem: model?.embalagem || "—",
    publicToken,
    qrHint,
    campos,
    responsavelTecnico: responsavelTecnico || "—",
    orientation,
    consultaPath: CONSULTA_ENTRADA_PATH,
    contexto: "convencional",
    copies: Math.max(1, Math.round(Number(copies) || 1)),
    locale,
  });
}
