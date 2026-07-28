/**
 * Cálculo de saldo de tankagem a partir do histórico de transbordos
 * e sincronização do registro em vasilhames quando a tanka zera.
 */

import { roundVolume, roundMass } from "@chemflow/lib/format";

function normPlaca(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

/** True se destino/origem se refere à tanka (por id ou código). */
export function matchesTanka(ref, isotanqueId, tankaCodigo) {
  if (!ref) return false;
  if (isotanqueId && (ref.tanka_id === isotanqueId || ref.entrada_id === isotanqueId)) {
    return true;
  }
  const codigo = normPlaca(tankaCodigo);
  if (!codigo) return false;
  return (
    normPlaca(ref.tanka_codigo) === codigo ||
    normPlaca(ref.entrada_codigo) === codigo
  );
}

/**
 * Volume líquido da tanka: Σ destinos Tankagem − Σ origens tipo tanka.
 * @param {object} opts
 * @param {string} opts.isotanqueId
 * @param {string} [opts.tankaCodigo]
 * @param {Array} opts.transbordos
 * @param {string|null} [opts.excludeTransbordoId] — ignora transbordo em edição
 * @param {Array} [opts.extraOrigens] — origens do payload atual (ainda não no histórico)
 * @param {Array} [opts.extraDestinos] — destinos do payload atual
 */
export function computeTankaSaldo({
  isotanqueId,
  tankaCodigo = "",
  transbordos = [],
  excludeTransbordoId = null,
  extraOrigens = [],
  extraDestinos = [],
}) {
  let entrada = 0;
  let saida = 0;

  for (const t of transbordos) {
    if (excludeTransbordoId && t.id === excludeTransbordoId) continue;

    for (const d of t.destinos || []) {
      if (
        d.tipo_embalagem === "Tankagem" &&
        matchesTanka(d, isotanqueId, tankaCodigo)
      ) {
        entrada += roundVolume(d.volume_total || d.volume || 0);
      }
    }
    for (const o of t.origens || []) {
      if (
        o.tipo_origem === "tanka" &&
        matchesTanka(o, isotanqueId, tankaCodigo)
      ) {
        saida += roundVolume(o.volume_retirado || 0);
      }
    }
  }

  for (const d of extraDestinos) {
    if (
      d.tipo_embalagem === "Tankagem" &&
      matchesTanka(d, isotanqueId, tankaCodigo)
    ) {
      entrada += roundVolume(d.volume_total || d.volume || 0);
    }
  }
  for (const o of extraOrigens) {
    if (
      o.tipo_origem === "tanka" &&
      matchesTanka(o, isotanqueId, tankaCodigo)
    ) {
      saida += roundVolume(o.volume_retirado || 0);
    }
  }

  return roundVolume(entrada - saida);
}

/**
 * Quando origem tankagem zera o saldo, atualiza o(s) registro(s) em vasilhames:
 * volume 0, data_saida = data do transbordo, status Expedido.
 */
export async function syncEmptyTankaVasilhames({
  origens = [],
  destinos = [],
  dataSaida,
  isotanques = [],
  transbordos = [],
  editingTransbordoId = null,
  entities,
  vasilhamesList = null,
}) {
  const tankaOrigens = origens.filter(
    (o) => o.tipo_origem === "tanka" && o.entrada_id
  );
  if (tankaOrigens.length === 0 || !entities?.vasilhames) return;

  const seen = new Set();
  const list = vasilhamesList || (await entities.vasilhames.list());

  for (const o of tankaOrigens) {
    if (seen.has(o.entrada_id)) continue;
    seen.add(o.entrada_id);

    const iso = isotanques.find((i) => i.id === o.entrada_id);
    const tankaCodigo = iso?.tanka || o.entrada_codigo || "";

    const remaining = computeTankaSaldo({
      isotanqueId: o.entrada_id,
      tankaCodigo,
      transbordos,
      excludeTransbordoId: editingTransbordoId,
      extraOrigens: origens,
      extraDestinos: destinos,
    });

    if (remaining !== 0) continue;

    const placas = new Set(
      [tankaCodigo, iso?.tanka, iso?.codigo_itku, o.entrada_codigo]
        .filter(Boolean)
        .map(normPlaca)
    );

    const matches = list.filter((v) => {
      if (v.tipo !== "Tankagem") return false;
      if (!placas.has(normPlaca(v.placa))) return false;
      const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
      return status === "No Pátio" || roundVolume(v.volume || 0) > 0;
    });

    for (const v of matches) {
      await entities.vasilhames.update(v.id, {
        volume: 0,
        peso_liquido: 0,
        peso_bruto: roundMass(v.tara || 0),
        data_saida: dataSaida || null,
        status: "Expedido",
      });
      // Mantém lista em memória coerente se reutilizar no mesmo save
      v.volume = 0;
      v.data_saida = dataSaida || null;
      v.status = "Expedido";
    }
  }
}
