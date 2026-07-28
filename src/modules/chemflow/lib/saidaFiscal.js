import { entities } from "@chemflow/services/entities";
import {
  syncEstoqueSaldos,
  resolveEstoqueIdsFromSaidaConvencional,
} from "@chemflow/lib/estoqueSaldo";

function parseDensidade(value) {
  return parseFloat(String(value || "0").replace(",", ".")) || 0;
}

/** Densidade do vasilhame (campo, peso/volume atuais ou snapshot do item da saída). */
function resolveDensidade(vasilhame, item) {
  const fromField = parseDensidade(vasilhame?.densidade);
  if (fromField > 0) return fromField;

  const vol = Number(vasilhame?.volume) || 0;
  const peso = Number(vasilhame?.peso_liquido) || 0;
  if (vol > 0 && peso > 0) return peso / vol;

  const iVol = Number(item?.volume_solicitado) || 0;
  const iPeso =
    Number(item?.peso_liquido) || Number(item?.quantidade_solicitada) || 0;
  if (iVol > 0 && iPeso > 0) return iPeso / iVol;

  return 0;
}

/**
 * Alterna envio fiscal da saída:
 * - enviado: baixa estoque (embalado + convencional via origem), expede vasilhames
 * - aguardando: restaura estoque e retorna vasilhames ao pátio
 */
export async function applySaidaFiscalToggle(
  saida,
  checked,
  {
    userNome = "",
    estoque = [],
    vasilhames = [],
    transbordos = null,
  } = {}
) {
  if (!saida?.id) throw new Error("Saída inválida");

  const itens = saida.itens || [];
  const dataSaida = saida.data_programada || "";

  const updates = {
    enviado_ao_fiscal: checked,
    status: checked ? "enviado_fiscal" : "aguardando",
    enviado_fiscal_usuario: checked ? userNome || null : null,
    enviado_fiscal_data: checked ? new Date().toISOString() : null,
  };

  const estoqueById = new Map((estoque || []).map((e) => [e.id, e]));
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const allTransbordos =
    transbordos || (await entities.transbordos.list());

  const updatedItens = itens.map((item) => {
    if (item.tipo === "embalado" && item.entrada_id) {
      const e = estoqueById.get(item.entrada_id);
      const estoqueAtual = e?.saldo_atual || 0;
      return {
        ...item,
        estoque_atual: estoqueAtual,
        estoque_final: Math.max(
          0,
          estoqueAtual - (checked ? item.quantidade_solicitada || 0 : 0)
        ),
      };
    }
    if (item.tipo === "convencional" && item.vasilhame_id) {
      const v = vasilhameById.get(item.vasilhame_id);
      const volDisponivel = v?.volume || 0;
      return {
        ...item,
        volume_disponivel: volDisponivel,
        saldo_final: Math.max(
          0,
          volDisponivel - (checked ? item.volume_solicitado || 0 : 0)
        ),
      };
    }
    return item;
  });

  await entities.saidas.update(saida.id, { ...updates, itens: updatedItens });

  // Estoque afetado: embalado direto + convencional via origem do vasilhame
  const embaladoIds = itens
    .filter((i) => i.tipo === "embalado" && i.entrada_id)
    .map((i) => i.entrada_id);
  const convencionalIds = resolveEstoqueIdsFromSaidaConvencional(
    itens,
    vasilhames,
    allTransbordos
  );
  const estoqueIds = [...new Set([...embaladoIds, ...convencionalIds])];
  if (estoqueIds.length > 0) {
    await syncEstoqueSaldos(estoqueIds);
  }

  // Convencional: expedir / retornar ao pátio
  const volByVasilhame = {};
  const itemByVasilhame = {};
  itens.forEach((item) => {
    if (item.tipo !== "convencional" || !item.vasilhame_id) return;
    const vol = item.volume_solicitado || 0;
    volByVasilhame[item.vasilhame_id] =
      (volByVasilhame[item.vasilhame_id] || 0) + vol;
    if (!itemByVasilhame[item.vasilhame_id]) {
      itemByVasilhame[item.vasilhame_id] = item;
    }
  });

  const vasilhameIds = Object.keys(volByVasilhame);
  if (vasilhameIds.length > 0) {
    const vasilhameUpdates = vasilhameIds.map((vid) => {
      const v = vasilhameById.get(vid);
      const item = itemByVasilhame[vid];
      const volAdj = (volByVasilhame[vid] || 0) * (checked ? -1 : 1);
      const currentVol = Number(v?.volume) || 0;
      const newVol = Math.max(0, currentVol + volAdj);
      const dens = resolveDensidade(v, item);
      const newPesoLiq =
        dens > 0
          ? newVol * dens
          : Math.max(
              0,
              (Number(v?.peso_liquido) || 0) +
                (checked
                  ? -(item?.peso_liquido || 0)
                  : item?.peso_liquido || 0)
            );
      return {
        id: vid,
        volume: newVol,
        peso_liquido: newPesoLiq,
        peso_bruto: (Number(v?.tara) || 0) + newPesoLiq,
        status: checked ? "Expedido" : "No Pátio",
        data_saida: checked ? dataSaida || null : null,
      };
    });
    await entities.vasilhames.bulkUpdate(vasilhameUpdates);
  }

  return {
    ...saida,
    ...updates,
    itens: updatedItens,
  };
}
