import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import {
  syncEstoqueSaldos,
  resolveEstoqueIdsFromSaidaConvencional,
} from "@transbordo/lib/estoqueSaldo";
import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";
import { roundMass, roundVolume } from "@transbordo/lib/format";
import { todayDateInputValue } from "@/i18n/formatters";
import {
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  DESTINO_RETORNO_MP,
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  isIndustrializacaoItem,
  isTransbordoItem,
  isSaidaModuloPainel,
  allModulosRelevantesValidados,
  getModulosRelevantesSaida,
} from "@transbordo/lib/saidaOrigem";
import { buildContainerYardRestorePatch } from "@transbordo/lib/saidaIndContainer";

function parseDensidade(value) {
  return parseFloat(String(value || "0").replace(",", ".")) || 0;
}

function itemsForModuleScope(itens, moduleScope) {
  if (!moduleScope || moduleScope === "all") return itens || [];
  if (moduleScope === ORIGEM_INDUSTRIALIZACAO) {
    return (itens || []).filter(isIndustrializacaoItem);
  }
  return (itens || []).filter(isTransbordoItem);
}

function mergeValidacaoModulos(saida, moduleScope, checked, userNome) {
  const prev =
    saida?.validacao_modulos &&
    typeof saida.validacao_modulos === "object" &&
    !Array.isArray(saida.validacao_modulos)
      ? { ...saida.validacao_modulos }
      : {};
  const hasEntries = Object.keys(prev).length > 0;
  if (
    !hasEntries &&
    (saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal")
  ) {
    for (const m of getModulosRelevantesSaida(saida)) {
      prev[m] = { validado: true };
    }
  }
  if (!moduleScope || moduleScope === "all") return prev;
  prev[moduleScope] = checked
    ? {
        validado: true,
        usuario: userNome || null,
        data: new Date().toISOString(),
      }
    : { validado: false, usuario: null, data: null };
  return prev;
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
    moduleScope = "all",
  } = {}
) {
  if (!saida?.id) throw new Error("Saída inválida");

  const itensAll = saida.itens || [];
  const scope =
    isSaidaModuloPainel(saida) &&
    (moduleScope === ORIGEM_TRANSBORDO ||
      moduleScope === ORIGEM_INDUSTRIALIZACAO)
      ? moduleScope
      : "all";
  const itens = itemsForModuleScope(itensAll, scope);
  const scopedRefs = new Set(itens);
  // Data de registro da expedição = dia local em que o fiscal marca como enviado
  // (não usar data_programada nem toISOString UTC, que atrasa/avança o dia no BR).
  const dataSaidaRegistro = todayDateInputValue();
  const dataSaidaProgramada = saida.data_programada || "";
  const dataSaida = dataSaidaRegistro || dataSaidaProgramada;

  const validacaoModulos = mergeValidacaoModulos(
    saida,
    scope,
    checked,
    userNome
  );
  const allDone =
    scope === "all"
      ? checked
      : allModulosRelevantesValidados(
          { ...saida, itens: itensAll },
          validacaoModulos
        );

  const updates = {
    enviado_ao_fiscal: allDone,
    status: allDone ? "enviado_fiscal" : "aguardando",
    enviado_fiscal_usuario: allDone ? userNome || null : null,
    enviado_fiscal_data: allDone ? new Date().toISOString() : null,
    validacao_modulos: validacaoModulos,
  };

  const estoqueById = new Map((estoque || []).map((e) => [e.id, e]));
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const allTransbordos =
    transbordos || (await entities.transbordos.list());

  const hasIndItems = itens.some(
    (i) => i.tipo === TIPO_IND_VASILHAME || i.tipo === TIPO_IND_RETORNO_MP
  );

  let containersInd = [];
  let stocksInd = [];
  if (hasIndItems) {
    [containersInd, stocksInd] = await Promise.all([
      base44.entities.Container.list("-created_date", 1000),
      base44.entities.RawMaterialStock.list("-created_date", 1000),
    ]);
  }
  const containerById = new Map(containersInd.map((c) => [c.id, c]));
  const stockById = new Map(stocksInd.map((s) => [s.id, s]));

  const updatedItens = itensAll.map((item) => {
    if (scope !== "all" && !scopedRefs.has(item)) return item;
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
    if (item.tipo === TIPO_IND_VASILHAME && item.container_id) {
      const c = containerById.get(item.container_id);
      const volDisponivel = c?.volume || 0;
      return {
        ...item,
        volume_disponivel: volDisponivel,
        saldo_final: Math.max(
          0,
          volDisponivel - (checked ? item.volume_solicitado || 0 : 0)
        ),
      };
    }
    if (item.tipo === TIPO_IND_RETORNO_MP && item.stock_id && !item.movement_id) {
      const s = stockById.get(item.stock_id);
      const estoqueAtual = s?.current_stock || 0;
      return {
        ...item,
        estoque_atual: estoqueAtual,
        estoque_final: Math.max(
          0,
          estoqueAtual - (checked ? item.quantidade_solicitada || 0 : 0)
        ),
      };
    }
    return item;
  });

  await entities.saidas.update(saida.id, { ...updates, itens: updatedItens });

  // Convencional Transbordo: expedir / retornar ao pátio ANTES do sync de estoque.
  // Se o sync rodar com vasilhame ainda "Expedido" após reverter o fiscal,
  // calcVasilhamesExpedidosPatio rebaixa o saldo indevidamente.
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
      const newVol = Math.max(0, roundVolume(currentVol + volAdj));
      const dens = resolveDensidade(v, item);
      const newPesoLiq =
        dens > 0
          ? roundMass(newVol * dens)
          : Math.max(
              0,
              roundMass(
                (Number(v?.peso_liquido) || 0) +
                  (checked
                    ? -(item?.peso_liquido || 0)
                    : item?.peso_liquido || 0)
              )
            );

      const patch = {
        id: vid,
        volume: newVol,
        peso_liquido: newPesoLiq,
        peso_bruto: roundMass((Number(v?.tara) || 0) + newPesoLiq),
        status: checked && newVol <= 0 ? "Expedido" : "No Pátio",
        data_saida: checked && newVol <= 0 ? dataSaida || null : null,
      };

      if (isDestinoEmbalagemUnitaria(v?.tipo)) {
        const qtdAtual = getQuantidadeEmbalagensFromVasilhame(v);
        const volPorEmb =
          getVolumePorEmbalagemFromVasilhame(v) ||
          Number(item?.volume_por_embalagem) ||
          0;
        const qtdSaida =
          Number(item?.quantidade_embalagens) > 0
            ? Math.round(Number(item.quantidade_embalagens))
            : volPorEmb > 0
              ? Math.round(Math.abs(volAdj) / volPorEmb)
              : 0;
        const qtdNova = Math.max(
          0,
          qtdAtual + (checked ? -qtdSaida : qtdSaida)
        );
        patch.placa = buildPlacaEmbalagens(qtdNova, v.tipo);
        patch.composicao = (v.composicao || []).map((c, i) =>
          i === 0
            ? {
                ...c,
                quantidade_embalagens: qtdNova,
                quantidade_l: newVol,
                quantidade_kg: newPesoLiq,
                volume_por_embalagem: volPorEmb || c.volume_por_embalagem,
              }
            : c
        );
      }

      return patch;
    });
    await entities.vasilhames.bulkUpdate(vasilhameUpdates);
  }

  // Estoque Transbordo: embalado + convencional (após ajustar vasilhames)
  const embaladoIds = itens
    .filter((i) => i.tipo === "embalado" && i.entrada_id)
    .map((i) => i.entrada_id);
  const convencionalIds = resolveEstoqueIdsFromSaidaConvencional(
    itens,
    vasilhames,
    allTransbordos,
    estoque
  );
  const estoqueIds = [...new Set([...embaladoIds, ...convencionalIds])];
  if (estoqueIds.length > 0) {
    await syncEstoqueSaldos(estoqueIds);
  }

  // Industrialização: expedir / retornar containers
  const volByContainer = {};
  const itemByContainer = {};
  itens.forEach((item) => {
    if (item.tipo !== TIPO_IND_VASILHAME || !item.container_id) return;
    const vol = item.volume_solicitado || 0;
    volByContainer[item.container_id] =
      (volByContainer[item.container_id] || 0) + vol;
    if (!itemByContainer[item.container_id]) {
      itemByContainer[item.container_id] = item;
    }
  });

  for (const cid of Object.keys(volByContainer)) {
    const c = containerById.get(cid);
    if (!c) continue;
    const item = itemByContainer[cid];
    let patch;

    if (!checked) {
      const currentVolNow = Number(c.volume) || 0;
      if (currentVolNow <= 0) {
        // Volume zerado em validação antiga: restaura snapshot para o pátio.
        const restore = buildContainerYardRestorePatch(c, [{ item }]);
        patch = restore || {
          status: "No Pátio",
          departure_date: null,
        };
      } else {
        patch = {
          status: "No Pátio",
          departure_date: null,
        };
      }
    } else {
      patch = {
        status: "Expedido",
        departure_date: dataSaidaRegistro || null,
      };
    }

    await base44.entities.Container.update(cid, patch);
  }

  // Industrialização: retorno de MP — baixa estoque e registra movimentação fiscal
  for (const item of itens) {
    if (item.tipo !== TIPO_IND_RETORNO_MP) continue;
    // Movimentação fiscal já existente: estoque já foi baixado na Industrialização
    if (item.movement_id) continue;
    if (!item.stock_id) continue;

    const stock = stockById.get(item.stock_id);
    if (!stock) continue;

    const qtd = item.quantidade_solicitada || 0;
    const available = stock.current_stock || 0;

    if (checked) {
      const newBalance = Math.max(0, available - qtd);
      const obsTag = `[saida:${saida.id}] Saída comercial ${saida.codigo || ""}`.trim();
      await base44.entities.StockMovement.create({
        stock_id: stock.id,
        entry_id: stock.entry_id || "",
        mp_code: stock.mp_code || item.produto_codigo || "",
        mp_name: stock.mp_name || item.produto_nome || "",
        client: stock.client || saida.cliente_nome || "",
        lot: stock.lot || item.lote || "",
        quantity: qtd,
        unit: stock.unit || item.unidade || "kg",
        destination: DESTINO_RETORNO_MP,
        observations: obsTag,
        operator: userNome || "",
        movement_date: new Date().toISOString(),
        balance_before: available,
        balance_after: newBalance,
      });
      await base44.entities.RawMaterialStock.update(stock.id, {
        current_stock: newBalance,
      });
      stockById.set(stock.id, { ...stock, current_stock: newBalance });
    } else {
      // Reverte: remove movimentações geradas por esta saída e devolve o saldo
      try {
        const linked = await base44.entities.StockMovement.filter({
          stock_id: item.stock_id,
          destination: DESTINO_RETORNO_MP,
        });
        const tag = `[saida:${saida.id}]`;
        for (const mov of linked || []) {
          if (String(mov.observations || "").includes(tag)) {
            await base44.entities.StockMovement.delete(mov.id);
          }
        }
      } catch {
        // segue com restore mesmo se a limpeza da movimentação falhar
      }
      const newBalance = available + qtd;
      await base44.entities.RawMaterialStock.update(stock.id, {
        current_stock: newBalance,
      });
      stockById.set(stock.id, { ...stock, current_stock: newBalance });
    }
  }

  return {
    ...saida,
    ...updates,
    itens: updatedItens,
  };
}

function sumVolByVasilhame(itens = []) {
  const map = {};
  const itemById = {};
  const qtdEmbById = {};
  (itens || []).forEach((item) => {
    if (item?.tipo !== TIPO_CONVENCIONAL && item?.tipo !== "convencional") return;
    if (!item.vasilhame_id) return;
    const vid = item.vasilhame_id;
    map[vid] = (map[vid] || 0) + (Number(item.volume_solicitado) || 0);
    qtdEmbById[vid] =
      (qtdEmbById[vid] || 0) + (Number(item.quantidade_embalagens) || 0);
    if (!itemById[vid]) itemById[vid] = item;
  });
  return { map, itemById, qtdEmbById };
}

/**
 * Após editar/salvar uma saída já validada (fiscal):
 * - ajusta volumes dos vasilhames Transbordo (itens removidos/alterados)
 * - recalcula saldo_atual do estoque embalado + origens convencionais
 *
 * Não altera containers nem estoque da Industrialização.
 */
export async function resyncTransbordoStockAfterSaidaEdit(
  previousSaida,
  nextItens = [],
  { estoque = [], vasilhames = [], dataSaida = null } = {}
) {
  const prevItens = previousSaida?.itens || [];
  const oldEmb = prevItens.filter(
    (i) =>
      (i.tipo === TIPO_EMBALADO || i.tipo === "embalado") && i.entrada_id
  );
  const newEmb = (nextItens || []).filter(
    (i) =>
      (i.tipo === TIPO_EMBALADO || i.tipo === "embalado") && i.entrada_id
  );

  const oldConv = sumVolByVasilhame(prevItens);
  const newConv = sumVolByVasilhame(nextItens);
  const vasilhameIds = new Set([
    ...Object.keys(oldConv.map),
    ...Object.keys(newConv.map),
  ]);

  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const dataSaidaRegistro = dataSaida || todayDateInputValue();

  if (vasilhameIds.size > 0) {
    const patches = [];
    for (const vid of vasilhameIds) {
      const v = vasilhameById.get(vid);
      if (!v) continue;
      const oldVol = oldConv.map[vid] || 0;
      const newVolTaken = newConv.map[vid] || 0;
      // Estado atual já reflete a baixa do item antigo → devolve o delta
      const volAdj = oldVol - newVolTaken;
      const item = newConv.itemById[vid] || oldConv.itemById[vid];
      const currentVol = Number(v.volume) || 0;
      const nextVol = Math.max(0, roundVolume(currentVol + volAdj));
      const dens = resolveDensidade(v, item);
      const oldPeso =
        Number(oldConv.itemById[vid]?.peso_liquido) ||
        Number(oldConv.itemById[vid]?.quantidade_solicitada) ||
        0;
      const newPeso =
        Number(newConv.itemById[vid]?.peso_liquido) ||
        Number(newConv.itemById[vid]?.quantidade_solicitada) ||
        0;
      const pesoAdj = oldPeso - newPeso;
      const newPesoLiq =
        dens > 0
          ? roundMass(nextVol * dens)
          : Math.max(0, roundMass((Number(v.peso_liquido) || 0) + pesoAdj));

      const patch = {
        id: vid,
        volume: nextVol,
        peso_liquido: newPesoLiq,
        peso_bruto: roundMass((Number(v.tara) || 0) + newPesoLiq),
        status: nextVol <= 0 && newVolTaken > 0 ? "Expedido" : "No Pátio",
        data_saida:
          nextVol <= 0 && newVolTaken > 0 ? dataSaidaRegistro || null : null,
      };

      if (isDestinoEmbalagemUnitaria(v?.tipo)) {
        const qtdAtual = getQuantidadeEmbalagensFromVasilhame(v);
        const volPorEmb =
          getVolumePorEmbalagemFromVasilhame(v) ||
          Number(item?.volume_por_embalagem) ||
          0;
        const qtdAdj =
          (oldConv.qtdEmbById[vid] || 0) - (newConv.qtdEmbById[vid] || 0);
        const qtdNova = Math.max(0, qtdAtual + qtdAdj);
        patch.placa = buildPlacaEmbalagens(qtdNova, v.tipo);
        patch.composicao = (v.composicao || []).map((c, i) =>
          i === 0
            ? {
                ...c,
                quantidade_embalagens: qtdNova,
                quantidade_l: nextVol,
                quantidade_kg: newPesoLiq,
                volume_por_embalagem: volPorEmb || c.volume_por_embalagem,
              }
            : c
        );
      }

      patches.push(patch);
      vasilhameById.set(vid, { ...v, ...patch });
    }
    if (patches.length > 0) {
      await entities.vasilhames.bulkUpdate(patches);
    }
  }

  const allTransbordos = await entities.transbordos.list();
  const embaladoIds = [...oldEmb, ...newEmb].map((i) => i.entrada_id);
  const convencionalIds = resolveEstoqueIdsFromSaidaConvencional(
    [...prevItens, ...(nextItens || [])].filter(
      (i) => i.tipo === TIPO_CONVENCIONAL || i.tipo === "convencional"
    ),
    [...vasilhameById.values()],
    allTransbordos,
    estoque
  );
  const estoqueIds = [...new Set([...embaladoIds, ...convencionalIds].filter(Boolean))];
  if (estoqueIds.length > 0) {
    await syncEstoqueSaldos(estoqueIds);
  }
}
