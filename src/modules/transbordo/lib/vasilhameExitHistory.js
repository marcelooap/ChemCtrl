import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
} from "@transbordo/lib/tiposEmbalagem";
import { collectConvencionalItemsForVasilhame } from "@transbordo/lib/vasilhamePatio";
import { parseAggregatedPackageQty } from "@industrializacao/lib/packagingTypes";

function parsePackageExits(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function saidaStatus(saida) {
  if (saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal") return "fiscal";
  if (saida?.status === "cancelado") return "cancelled";
  return "pending";
}

function originalQtyOf(vasilhame) {
  const stored = Math.floor(Number(vasilhame?.original_package_qty) || 0);
  const current = getQuantidadeEmbalagensFromVasilhame(vasilhame);
  if (stored >= 1 && stored >= current) return stored;

  const fromComp = (vasilhame?.composicao || [])
    .map((c) => Math.round(Number(c.quantidade_embalagens_inicial || c.qtd_embalagens_inicial) || 0))
    .filter((n) => n > 0);
  if (fromComp.length > 0) return Math.max(current, Math.max(...fromComp));

  const currVol = Number(vasilhame?.volume) || 0;
  const volPorEmb = getVolumePorEmbalagemFromVasilhame(vasilhame);
  if (currVol > 0 && current >= 1 && volPorEmb > 0) {
    // Não reconstrói para cima se o pátio ainda tem o lote inteiro.
  }

  const placaQty = parseAggregatedPackageQty(vasilhame?.placa);
  return Math.max(current, placaQty || 0, 0);
}

/**
 * Histórico de saída para IBC / bombona / tambor (não vasilhame clássico).
 */
export function listTbVasilhameExitHistory(vasilhame, saidas = []) {
  if (!vasilhame?.id) return [];
  if (
    !isDestinoEmbalagemUnitaria(vasilhame.tipo) &&
    !/ibc|bombona|tambor|one\s*way/i.test(String(vasilhame.tipo || ""))
  ) {
    return [];
  }

  const currentQty =
    vasilhame.status === "Expedido" || vasilhame.data_saida
      ? 0
      : getQuantidadeEmbalagensFromVasilhame(vasilhame);
  const volPorEmb = getVolumePorEmbalagemFromVasilhame(vasilhame) || 0;
  const originalQty = Math.max(originalQtyOf(vasilhame), currentQty);

  const rows = [];

  for (const exit of parsePackageExits(vasilhame.package_exits)) {
    const qty = Math.max(0, Math.round(Number(exit.qty) || 0));
    if (qty < 1) continue;
    rows.push({
      key: `patio:${exit.date || ""}:${qty}`,
      source: "patio",
      codigo: exit.codigo || null,
      date: exit.date || exit.created_at || null,
      qty,
      volume: round3(exit.volume) || 0,
      status: "patio",
      operator: exit.operator || vasilhame.responsavel || "",
    });
  }

  for (const { saida, item } of collectConvencionalItemsForVasilhame(saidas, vasilhame.id)) {
    const explicit = Math.round(Number(item?.quantidade_embalagens) || 0);
    const vol = Number(item?.volume_solicitado) || 0;
    const qty =
      explicit > 0
        ? explicit
        : volPorEmb > 0 && vol > 0
          ? Math.max(1, Math.round(vol / volPorEmb))
          : 0;
    rows.push({
      key: `saida:${saida?.id || rows.length}`,
      source: "saida",
      codigo: saida?.codigo || null,
      date:
        saida?.data_programada ||
        saida?.data_solicitacao ||
        saida?.created_at ||
        saida?.created_date ||
        null,
      qty,
      volume: round3(vol),
      status: saidaStatus(saida),
      operator: saida?.usuario_responsavel || saida?.usuario_criador || "",
    });
  }

  const accountedQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const shippedTotal = Math.max(0, originalQty - currentQty);
  const gap = shippedTotal - accountedQty;
  if (gap >= 1) {
    const accountedVol = rows.reduce((s, r) => s + (Number(r.volume) || 0), 0);
    const origVol = volPorEmb > 0 ? originalQty * volPorEmb : Number(vasilhame.volume) || 0;
    const currVol = currentQty > 0 ? Number(vasilhame.volume) || 0 : 0;
    rows.push({
      key: `inferred:${vasilhame.id}`,
      source: "inferred",
      codigo: null,
      date: vasilhame.data_saida || vasilhame.updated_at || null,
      qty: gap,
      volume: round3(Math.max(0, origVol - currVol - accountedVol)),
      status: "patio",
      operator: vasilhame.responsavel || "",
    });
  }

  rows.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(b.codigo || "").localeCompare(String(a.codigo || ""));
  });

  return rows;
}

export function appendTbPackageExit(existing, entry) {
  return [...parsePackageExits(existing), entry];
}
