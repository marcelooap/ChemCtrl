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
  itemFoiBaixado,
  isTanqueVazioItem,
  calcSaidaQuantidadeTotal,
  saidaItemChave,
  applyItemValidacaoFlags,
  resolveItemOrigem,
} from "@transbordo/lib/saidaOrigem";
import { buildContainerYardRestorePatch } from "@transbordo/lib/saidaIndContainer";
import { deductStock, restoreStock } from "@industrializacao/lib/stockRpc";
import {
  rpcAbaterReservasSaida,
  rpcEstornarReservasSaida,
} from "@painel/lib/saidaReservas";
import { estoqueIdsFromSaidaItem } from "@painel/lib/saidaEmbaladoLotes";
import {
  alignSaidaItensVasilhames,
  resolveVasilhameDaSaida,
  saidaItemSemVasilhame,
} from "@transbordo/lib/vasilhameSaidaLink";

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

function normalizeItemChavesFilter(itemChaves) {
  if (!itemChaves) return null;
  const list = itemChaves instanceof Set ? [...itemChaves] : [].concat(itemChaves);
  const keys = list.map((k) => String(k || "").trim()).filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

/** Indexa entidades por id string — evita falha silenciosa number vs string no Map. */
function indexById(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.id == null) continue;
    map.set(String(row.id), row);
  }
  return map;
}

function entityLabel(item, fallback = "selecionado") {
  return (
    item?.vasilhame_placa ||
    item?.vasilhame_barril ||
    item?.container_number ||
    item?.placa ||
    item?.lote ||
    fallback
  );
}

/**
 * Resolve containers da Industrialização por id (get), sem depender da janela
 * list(..., 1000) — causa clássica de Validado sem Expedido.
 */
async function resolveContainersByIds(ids = [], seedRows = []) {
  const byId = indexById(seedRows);
  const missing = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))]
    .filter((id) => !byId.has(id));
  if (missing.length === 0) return byId;

  const fetched = await Promise.all(
    missing.map((id) => base44.entities.Container.get(id).catch(() => null))
  );
  for (const row of fetched) {
    if (row?.id == null) continue;
    byId.set(String(row.id), row);
  }
  return byId;
}

async function resolveStocksByIds(ids = [], seedRows = []) {
  const byId = indexById(seedRows);
  const missing = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))]
    .filter((id) => !byId.has(id));
  if (missing.length === 0) return byId;

  const fetched = await Promise.all(
    missing.map((id) =>
      base44.entities.RawMaterialStock.get(id).catch(() => null)
    )
  );
  for (const row of fetched) {
    if (row?.id == null) continue;
    byId.set(String(row.id), row);
  }
  return byId;
}

/** Tanque esvaziado na validação (tolerância de arredondamento de volume). */
function isVolumeEsgotado(newVol, volTaken, currentVol) {
  if (roundVolume(newVol) <= 0) return true;
  if (volTaken > 0 && volTaken + 1e-9 >= currentVol) return true;
  return false;
}

/**
 * Patch de expedição / retorno ao pátio para container Industrialização.
 */
function buildIndContainerFiscalPatch(container, item, checked, dataSaida) {
  if (!checked) {
    const currentVolNow = Number(container?.volume) || 0;
    if (currentVolNow <= 0) {
      return (
        buildContainerYardRestorePatch(container, [{ item }]) || {
          status: "No Pátio",
          departure_date: null,
        }
      );
    }
    return {
      status: "No Pátio",
      departure_date: null,
    };
  }
  return {
    status: "Expedido",
    departure_date: dataSaida || null,
  };
}

/**
 * Alterna envio fiscal da saída:
 * - enviado: baixa estoque (embalado + convencional via origem), expede vasilhames
 * - aguardando: restaura estoque e retorna vasilhames ao pátio
 *
 * `itemChaves`: opcional — restringe o movimento a itens específicos
 * (desvalidação individual). Demais itens preservam o status atual.
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
    itemChaves = null,
  } = {}
) {
  if (!saida?.id) throw new Error("Saída inválida");

  const rawItens = saida.itens || [];
  if (checked && rawItens.length === 0) {
    throw new Error(
      "Não é possível validar uma saída sem produtos. Edite a saída e adicione os tanques/produtos."
    );
  }

  const chavesFiltro = normalizeItemChavesFilter(itemChaves);

  // Regravação do transbordo cria outro id para o mesmo tanque. A saída
  // antiga ainda aponta para o id removido; a placa localiza o registro atual.
  let vasilhameRows = vasilhames || [];
  if (rawItens.some((item) => saidaItemSemVasilhame(item, vasilhameRows, { preferPatio: checked }))) {
    const fresh = await entities.vasilhames.list();
    const merged = new Map(vasilhameRows.map((row) => [String(row.id), row]));
    for (const row of fresh || []) merged.set(String(row.id), row);
    vasilhameRows = [...merged.values()];
  }
  const itensAll = alignSaidaItensVasilhames(rawItens, vasilhameRows, {
    preferPatio: checked,
  });
  const scope =
    isSaidaModuloPainel(saida) &&
    (moduleScope === ORIGEM_TRANSBORDO ||
      moduleScope === ORIGEM_INDUSTRIALIZACAO)
      ? moduleScope
      : "all";
  const itensEscopo = itemsForModuleScope(itensAll, scope);
  const scopedRefs = new Set(itensEscopo);
  const matchChave = (item) => {
    if (!chavesFiltro) return true;
    const chave = saidaItemChave(item);
    return Boolean(chave && chavesFiltro.has(chave));
  };
  const itensJaBaixados = itensEscopo.filter((item) => itemFoiBaixado(item, saida));
  const itensPendentes = itensEscopo.filter((item) => item?.validado === false);
  // Validar de novo só baixa o tanque incluído depois. Reverter desfaz o que já saiu.
  const somentePendentes =
    checked && !chavesFiltro && itensPendentes.length > 0 && itensJaBaixados.length > 0;
  let itensMovimento = !checked
    ? itensEscopo.filter((item) => itemFoiBaixado(item, saida))
    : somentePendentes
      ? itensPendentes
      : itensEscopo;
  if (chavesFiltro) {
    itensMovimento = itensMovimento.filter(matchChave);
    if (itensMovimento.length === 0) {
      throw new Error(
        checked
          ? "Nenhum item pendente encontrado para validar."
          : "Nenhum item validado encontrado para desvalidar."
      );
    }
  }
  const movimentoRefs = new Set(itensMovimento);
  const itens = itensMovimento;
  // Data de saída registrada nos vasilhames/containers = data programada da saída.
  // Fallback para a data local atual caso data_programada não esteja preenchida.
  const dataSaidaRegistro = todayDateInputValue();
  const dataSaidaProgramada = saida.data_programada || "";
  const dataSaida = dataSaidaProgramada || dataSaidaRegistro;

  const estoqueById = indexById(estoque);
  const vasilhameById = indexById(vasilhameRows);
  const allTransbordos =
    transbordos || (await entities.transbordos.list());

  const containerIdsNeeded = [
    ...new Set(
      itens
        .filter((i) => i.tipo === TIPO_IND_VASILHAME && i.container_id)
        .map((i) => String(i.container_id))
    ),
  ];
  const stockIdsNeeded = [
    ...new Set(
      itens
        .filter(
          (i) =>
            i.tipo === TIPO_IND_RETORNO_MP && i.stock_id && !i.movement_id
        )
        .map((i) => String(i.stock_id))
    ),
  ];

  let containerById = new Map();
  let stockById = new Map();
  if (containerIdsNeeded.length > 0 || stockIdsNeeded.length > 0) {
    const [containersResolved, stocksResolved] = await Promise.all([
      containerIdsNeeded.length > 0
        ? resolveContainersByIds(containerIdsNeeded)
        : Promise.resolve(new Map()),
      stockIdsNeeded.length > 0
        ? resolveStocksByIds(stockIdsNeeded)
        : Promise.resolve(new Map()),
    ]);
    containerById = containersResolved;
    stockById = stocksResolved;
  }

  const updatedItens = itensAll.map((item) => {
    if (scope !== "all" && !scopedRefs.has(item)) return item;
    if (!movimentoRefs.has(item)) {
      // Desvalidação individual: não altera os demais itens do escopo.
      if (!checked && chavesFiltro) return item;
      if (!checked) {
        return applyItemValidacaoFlags(item, false, {
          hadBaixa: itemFoiBaixado(item, saida),
        });
      }
      if (itemFoiBaixado(item, saida) || item.validado === true) {
        return applyItemValidacaoFlags(item, true, { hadBaixa: true });
      }
      return item;
    }
    const hadBaixa = itemFoiBaixado(item, saida) || item.validado === true;
    if (item.tipo === "embalado" && item.entrada_id) {
      const e = estoqueById.get(String(item.entrada_id));
      const estoqueAtual = e?.saldo_final ?? e?.saldo_atual ?? 0;
      const qtdBaixa =
        item.quantidade_carregada != null && item.quantidade_carregada !== ""
          ? Number(item.quantidade_carregada) || 0
          : item.quantidade_solicitada || 0;
      return applyItemValidacaoFlags(
        {
          ...item,
          estoque_atual: estoqueAtual,
          estoque_final: Math.max(0, estoqueAtual - (checked ? qtdBaixa : 0)),
        },
        checked,
        { hadBaixa }
      );
    }
    if (
      item.tipo === "convencional" &&
      item.vasilhame_id &&
      !isTanqueVazioItem(item)
    ) {
      const v = vasilhameById.get(String(item.vasilhame_id));
      const volDisponivel = v?.volume || 0;
      return applyItemValidacaoFlags(
        {
          ...item,
          volume_disponivel: volDisponivel,
          saldo_final: Math.max(
            0,
            volDisponivel - (checked ? item.volume_solicitado || 0 : 0)
          ),
        },
        checked,
        { hadBaixa }
      );
    }
    if (item.tipo === TIPO_IND_VASILHAME && item.container_id) {
      const c = containerById.get(String(item.container_id));
      const volDisponivel = c?.volume || 0;
      return applyItemValidacaoFlags(
        {
          ...item,
          volume_disponivel: volDisponivel,
          saldo_final: Math.max(
            0,
            volDisponivel - (checked ? item.volume_solicitado || 0 : 0)
          ),
        },
        checked,
        { hadBaixa }
      );
    }
    if (item.tipo === TIPO_IND_RETORNO_MP && item.stock_id && !item.movement_id) {
      const s = stockById.get(String(item.stock_id));
      const estoqueAtual = s?.current_stock || 0;
      return applyItemValidacaoFlags(
        {
          ...item,
          estoque_atual: estoqueAtual,
          estoque_final: Math.max(
            0,
            estoqueAtual - (checked ? item.quantidade_solicitada || 0 : 0)
          ),
        },
        checked,
        { hadBaixa }
      );
    }
    return applyItemValidacaoFlags(item, checked, { hadBaixa });
  });

  // Status do módulo após o movimento. Desvalidação individual mantém o
  // módulo validado enquanto ainda houver item baixado naquele escopo.
  const saidaAposItens = { ...saida, itens: updatedItens };
  const itensEscopoApos = itemsForModuleScope(updatedItens, scope);
  const aindaBaixadosNoEscopo = itensEscopoApos.some((item) =>
    itemFoiBaixado(item, saidaAposItens)
  );
  const moduleChecked = chavesFiltro
    ? aindaBaixadosNoEscopo
      ? true
      : false
    : checked;

  const validacaoModulos = mergeValidacaoModulos(
    saida,
    scope,
    moduleChecked,
    userNome
  );
  const allDone =
    scope === "all"
      ? moduleChecked
      : allModulosRelevantesValidados(
          { ...saida, itens: updatedItens },
          validacaoModulos
        );

  const updates = {
    enviado_ao_fiscal: allDone,
    status: allDone ? "enviado_fiscal" : "aguardando",
    enviado_fiscal_usuario: allDone ? userNome || null : null,
    enviado_fiscal_data: allDone ? new Date().toISOString() : null,
    validacao_modulos: validacaoModulos,
  };

  if (checked) {
    // Tanque vazio não está cadastrado em vasilhames — só identifica placa/barril
    // na saída; não exige (nem registra) data_saida no cadastro de vasilhames.
    const lost = itens.find(
      (item) =>
        item?.tipo === "convencional" &&
        !isTanqueVazioItem(item) &&
        (item.vasilhame_id || item.vasilhame_placa || item.vasilhame_barril) &&
        !vasilhameById.get(String(item.vasilhame_id || ""))
    );
    if (lost) {
      throw new Error(
        `Não foi possível registrar a data de saída do vasilhame ${entityLabel(lost)}. Atualize a página e tente novamente.`
      );
    }
    const lostContainer = itens.find(
      (item) =>
        item?.tipo === TIPO_IND_VASILHAME &&
        item.container_id &&
        !containerById.get(String(item.container_id))
    );
    if (lostContainer) {
      throw new Error(
        `Não foi possível expedir o vasilhame ${entityLabel(lostContainer)}. Atualize a página e tente novamente.`
      );
    }
  }

  // Convencional Transbordo: expedir / retornar ao pátio ANTES do sync de estoque.
  // Se o sync rodar com vasilhame ainda "Expedido" após reverter o fiscal,
  // calcVasilhamesExpedidosPatio rebaixa o saldo indevidamente.
  const volByVasilhame = {};
  const itemByVasilhame = {};
  itens.forEach((item) => {
    if (item.tipo !== "convencional" || !item.vasilhame_id || isTanqueVazioItem(item))
      return;
    const vid = String(item.vasilhame_id);
    const vol = item.volume_solicitado || 0;
    volByVasilhame[vid] = (volByVasilhame[vid] || 0) + vol;
    if (!itemByVasilhame[vid]) {
      itemByVasilhame[vid] = item;
    }
  });

  const vasilhameIds = Object.keys(volByVasilhame);
  if (vasilhameIds.length > 0) {
    // Volume fresco do banco — evita residual fantasma que impede Expedido.
    // Também descarta ids só presentes na lista em memória (já removidos no DB).
    const freshVasilhames = await Promise.all(
      vasilhameIds.map((vid) => entities.vasilhames.get(vid).catch(() => null))
    );
    for (let i = 0; i < vasilhameIds.length; i += 1) {
      const vid = vasilhameIds[i];
      const row = freshVasilhames[i];
      if (row?.id != null) {
        vasilhameById.set(String(row.id), row);
      } else {
        vasilhameById.delete(vid);
      }
    }

    // Id gravado na saída pode ter sido removido na regravação do transbordo.
    // Remapeia por placa/barril antes do bulkUpdate (evita "Registro não encontrado").
    const missingIds = vasilhameIds.filter((vid) => !vasilhameById.get(vid));
    if (missingIds.length > 0) {
      const freshList = await entities.vasilhames.list();
      for (const row of freshList || []) {
        if (row?.id == null) continue;
        vasilhameById.set(String(row.id), row);
      }
      vasilhameRows = [...vasilhameById.values()];

      for (const staleId of missingIds) {
        const item = itemByVasilhame[staleId];
        const resolved = resolveVasilhameDaSaida(item, vasilhameRows, {
          preferPatio: checked,
        });
        if (!resolved?.id) continue;
        const resolvedId = String(resolved.id);
        if (resolvedId === staleId) continue;

        volByVasilhame[resolvedId] =
          (volByVasilhame[resolvedId] || 0) + (volByVasilhame[staleId] || 0);
        if (!itemByVasilhame[resolvedId]) {
          itemByVasilhame[resolvedId] = {
            ...item,
            vasilhame_id: resolved.id,
            vasilhame_placa: resolved.placa || item?.vasilhame_placa || "",
            vasilhame_barril:
              resolved.barril ?? item?.vasilhame_barril ?? "",
          };
        }
        delete volByVasilhame[staleId];
        delete itemByVasilhame[staleId];

        for (let i = 0; i < updatedItens.length; i += 1) {
          const it = updatedItens[i];
          if (String(it?.vasilhame_id || "") !== staleId) continue;
          updatedItens[i] = {
            ...it,
            vasilhame_id: resolved.id,
            vasilhame_placa: resolved.placa || it.vasilhame_placa || "",
            vasilhame_barril: resolved.barril ?? it.vasilhame_barril ?? "",
          };
        }
      }
    }

    const vasilhameUpdates = [];
    for (const vid of Object.keys(volByVasilhame)) {
      const v = vasilhameById.get(vid);
      const item = itemByVasilhame[vid];
      if (!v?.id) {
        if (checked) {
          throw new Error(
            `Não foi possível registrar a data de saída do vasilhame ${entityLabel(item)}. Atualize a página e tente novamente.`
          );
        }
        // Desvalidação: tanque já ausente — não bloqueia reverter o status.
        continue;
      }

      const volTaken = volByVasilhame[vid] || 0;
      const volAdj = volTaken * (checked ? -1 : 1);
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

      const expedir =
        checked && isVolumeEsgotado(newVol, volTaken, currentVol);

      const patch = {
        id: String(v.id),
        volume: newVol,
        peso_liquido: newPesoLiq,
        peso_bruto: roundMass((Number(v?.tara) || 0) + newPesoLiq),
        status: expedir ? "Expedido" : "No Pátio",
        data_saida: expedir ? dataSaida || null : null,
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

      vasilhameUpdates.push(patch);
    }
    if (vasilhameUpdates.length > 0) {
      await entities.vasilhames.bulkUpdate(vasilhameUpdates);
    }
  }

  // Industrialização: expedir / retornar containers ANTES de marcar a saída.
  // Antes o status Validado era gravado primeiro e um container ausente era
  // ignorado com `continue` — gerava Validado + No Pátio sem data de saída.
  const volByContainer = {};
  const itemByContainer = {};
  itens.forEach((item) => {
    if (item.tipo !== TIPO_IND_VASILHAME || !item.container_id) return;
    const cid = String(item.container_id);
    const vol = item.volume_solicitado || 0;
    volByContainer[cid] = (volByContainer[cid] || 0) + vol;
    if (!itemByContainer[cid]) {
      itemByContainer[cid] = item;
    }
  });

  for (const cid of Object.keys(volByContainer)) {
    const c = containerById.get(cid);
    const item = itemByContainer[cid];
    if (!c) {
      if (checked) {
        throw new Error(
          `Não foi possível expedir o vasilhame ${entityLabel(item)}. Atualize a página e tente novamente.`
        );
      }
      continue;
    }
    const patch = buildIndContainerFiscalPatch(c, item, checked, dataSaida);
    await base44.entities.Container.update(cid, patch);
    containerById.set(cid, { ...c, ...patch });
  }

  // Status da saída só depois dos tanques/containers. Se a gravação falhar,
  // a validação não fica marcada sem data de saída / Expedido.
  const quantidade_total = calcSaidaQuantidadeTotal(updatedItens);
  await entities.saidas.update(saida.id, {
    ...updates,
    itens: updatedItens,
    quantidade_total,
  });

  // Estoque Transbordo: embalado + convencional (após ajustar vasilhames)
  const embaladoIds = itens.flatMap((i) => estoqueIdsFromSaidaItem(i));
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

  // Industrialização: retorno de MP — baixa estoque e registra movimentação fiscal
  for (const item of itens) {
    if (item.tipo !== TIPO_IND_RETORNO_MP) continue;
    // Movimentação fiscal já existente: estoque já foi baixado na Industrialização
    if (item.movement_id) continue;
    if (!item.stock_id) continue;

    const stock = stockById.get(String(item.stock_id));
    if (!stock) continue;

    const qtd = item.quantidade_solicitada || 0;
    const available = stock.current_stock || 0;

    if (checked) {
      const adjusted = qtd > 0 ? await deductStock(stock.id, qtd) : null;
      const newBalance = Number(adjusted?.balance_after ?? Math.max(0, available - qtd));
      const balanceBefore = Number(adjusted?.balance_before ?? available);
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
        balance_before: balanceBefore,
        balance_after: newBalance,
      });
      stockById.set(String(stock.id), { ...stock, current_stock: newBalance });
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
      const adjusted = qtd > 0 ? await restoreStock(stock.id, qtd) : null;
      const newBalance = Number(adjusted?.balance_after ?? available + qtd);
      stockById.set(String(stock.id), { ...stock, current_stock: newBalance });
    }
  }

  const controlaReserva = (updatedItens || []).some(
    (item) =>
      item?.tipo === "embalado" &&
      (item.reserva_id || item.sem_reserva === true || item.reserva_abatida)
  );
  let itensFinais = updatedItens;
  if ((scope === "all" || scope === ORIGEM_TRANSBORDO) && controlaReserva) {
    if (checked) {
      await rpcAbaterReservasSaida(saida.id, null, "fiscal");
      // RPC pode atualizar flags de reserva nos itens — recarrega se necessário.
    } else if (!chavesFiltro) {
      await rpcEstornarReservasSaida(saida.id, "fiscal");
    } else {
      // Desvalidação individual: estorna só os itens movidos, preservando os demais.
      const chavesMovimento = new Set(
        itensMovimento.map((item) => saidaItemChave(item)).filter(Boolean)
      );
      itensFinais = await estornarReservasItensSelecionados(
        saida.id,
        updatedItens,
        chavesMovimento,
        "fiscal"
      );
    }
  }

  return {
    ...saida,
    ...updates,
    itens: itensFinais,
    quantidade_total: calcSaidaQuantidadeTotal(itensFinais),
  };
}

/**
 * Remove a validação de um único item, preservando os demais e o histórico.
 */
export async function applySaidaItemDevalidacao(saida, item, options = {}) {
  const chave = saidaItemChave(item);
  if (!chave) {
    throw new Error("Não foi possível identificar o item para desvalidar.");
  }
  if (!itemFoiBaixado(item, saida)) {
    throw new Error("Este item já está pendente de validação.");
  }
  const moduleScope =
    options.moduleScope ||
    (isSaidaModuloPainel(saida) ? resolveItemOrigem(item) : "all");
  return applySaidaFiscalToggle(saida, false, {
    ...options,
    moduleScope,
    itemChaves: [chave],
  });
}

/** Estorno seletivo de reservas (desvalidação de itens específicos). */
async function estornarReservasItensSelecionados(
  saidaId,
  itens,
  chavesMovimento,
  origem = "fiscal"
) {
  let changed = false;
  const next = [];
  for (const item of itens || []) {
    const chave = saidaItemChave(item);
    if (
      !chave ||
      !chavesMovimento.has(chave) ||
      item?.tipo !== "embalado"
    ) {
      next.push(item);
      continue;
    }
    if (
      item.reserva_abatida &&
      (item.abatimento_origem || "carregamento") === origem &&
      item.reserva_id
    ) {
      const qtd = Math.round(Number(item.quantidade_abatida) || 0);
      if (qtd > 0) {
        try {
          const reserva = await entities.materialReservas.get(item.reserva_id);
          if (reserva?.id) {
            await entities.materialReservas.update(reserva.id, {
              quantidade: Math.round((Number(reserva.quantidade) || 0) + qtd),
              status: "ativa",
              removido_em: null,
              removido_por_id: null,
              removido_por_nome: null,
              motivo_remocao: null,
            });
          }
        } catch (err) {
          console.error(
            "[saidaFiscal] Falha ao estornar reserva do item desvalidado:",
            err
          );
        }
      }
      const cleared = { ...item, reserva_abatida: false, quantidade_abatida: null };
      delete cleared.abatimento_origem;
      delete cleared.quantidade_carregada;
      next.push(cleared);
      changed = true;
      continue;
    }
    if (
      item.sem_reserva === true &&
      item.quantidade_carregada_origem === origem
    ) {
      const cleared = { ...item };
      delete cleared.quantidade_carregada;
      delete cleared.quantidade_carregada_origem;
      next.push(cleared);
      changed = true;
      continue;
    }
    next.push(item);
  }
  if (changed) {
    await entities.saidas.update(saidaId, { itens: next });
  }
  return next;
}

function sumVolByVasilhame(itens = []) {
  const map = {};
  const itemById = {};
  const qtdEmbById = {};
  (itens || []).forEach((item) => {
    if (item?.tipo !== TIPO_CONVENCIONAL && item?.tipo !== "convencional") return;
    if (!item.vasilhame_id || isTanqueVazioItem(item)) return;
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
 * - recalcula saldo_final do estoque embalado + origens convencionais
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
      (i.tipo === TIPO_EMBALADO || i.tipo === "embalado") &&
      estoqueIdsFromSaidaItem(i).length > 0
  );
  const newEmb = (nextItens || []).filter(
    (i) =>
      (i.tipo === TIPO_EMBALADO || i.tipo === "embalado") &&
      estoqueIdsFromSaidaItem(i).length > 0
  );

  const oldConv = sumVolByVasilhame(prevItens);
  const newConv = sumVolByVasilhame(nextItens);
  const vasilhameIds = new Set([
    ...Object.keys(oldConv.map),
    ...Object.keys(newConv.map),
  ]);

  const vasilhameById = indexById(vasilhames);
  const dataSaidaRegistro = dataSaida || todayDateInputValue();

  if (vasilhameIds.size > 0) {
    const patches = [];
    const seenTargets = new Set();
    for (const vid of vasilhameIds) {
      const item = newConv.itemById[vid] || oldConv.itemById[vid];
      const v =
        vasilhameById.get(String(vid)) ||
        resolveVasilhameDaSaida(
          {
            tipo: "convencional",
            vasilhame_id: vid,
            vasilhame_placa: item?.vasilhame_placa,
            vasilhame_barril: item?.vasilhame_barril,
          },
          vasilhames,
          { preferPatio: true }
        );
      if (!v || seenTargets.has(String(v.id))) continue;
      seenTargets.add(String(v.id));
      const oldVol = oldConv.map[vid] || 0;
      const newVolTaken = newConv.map[vid] || 0;
      // Estado atual já reflete a baixa do item antigo → devolve o delta
      const volAdj = oldVol - newVolTaken;
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

      const expedir = newVolTaken > 0 && roundVolume(nextVol) <= 0;
      const patch = {
        id: v.id,
        volume: nextVol,
        peso_liquido: newPesoLiq,
        peso_bruto: roundMass((Number(v.tara) || 0) + newPesoLiq),
        status: expedir ? "Expedido" : "No Pátio",
        data_saida: expedir ? dataSaidaRegistro || null : null,
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
      vasilhameById.set(String(v.id), { ...v, ...patch });
    }
    if (patches.length > 0) {
      await entities.vasilhames.bulkUpdate(patches);
    }
  }

  const allTransbordos = await entities.transbordos.list();
  const embaladoIds = [...oldEmb, ...newEmb].flatMap((i) =>
    estoqueIdsFromSaidaItem(i)
  );
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

function needsExpedicaoHeal(row) {
  if (!row) return true;
  if (String(row.status || "") !== "Expedido") return true;
  const data = row.departure_date ?? row.data_saida;
  return data == null || String(data).trim() === "";
}

/**
 * Corrige embalagens já validadas na saída que ficaram "No Pátio" sem data
 * (falha intermitente antiga). Seguro para rodar no carregamento da lista.
 *
 * - Industrialização (`ind_vasilhame`): status Expedido + departure_date
 * - Transbordo convencional: Expedido + data_saida quando volume já está zerado
 */
export async function reconcileValidatedSaidaEmbalagens(
  saidas = [],
  { vasilhames = [] } = {}
) {
  const list = saidas || [];
  if (list.length === 0) return { containersFixed: 0, vasilhamesFixed: 0 };

  const containerTargets = new Map();
  const vasilhameTargets = new Map();

  for (const saida of list) {
    const dataSaida =
      saida?.data_programada || todayDateInputValue() || null;
    for (const item of saida?.itens || []) {
      if (!itemFoiBaixado(item, saida)) continue;

      if (item.tipo === TIPO_IND_VASILHAME && item.container_id) {
        const cid = String(item.container_id);
        if (!containerTargets.has(cid)) {
          containerTargets.set(cid, { dataSaida, item });
        }
        continue;
      }

      if (
        (item.tipo === TIPO_CONVENCIONAL || item.tipo === "convencional") &&
        item.vasilhame_id &&
        !isTanqueVazioItem(item)
      ) {
        const vid = String(item.vasilhame_id);
        if (!vasilhameTargets.has(vid)) {
          vasilhameTargets.set(vid, { dataSaida, item });
        }
      }
    }
  }

  let containersFixed = 0;
  let vasilhamesFixed = 0;

  if (containerTargets.size > 0) {
    const byId = await resolveContainersByIds([...containerTargets.keys()]);
    for (const [cid, meta] of containerTargets) {
      const container = byId.get(cid);
      if (!container || !needsExpedicaoHeal(container)) continue;
      const patch = {
        status: "Expedido",
        departure_date: meta.dataSaida || null,
      };
      try {
        await base44.entities.Container.update(cid, patch);
        containersFixed += 1;
      } catch (err) {
        console.error(
          "[saidaFiscal] Falha ao reconciliar container expedido:",
          cid,
          err
        );
      }
    }
  }

  if (vasilhameTargets.size > 0) {
    const byId = indexById(vasilhames);
    const missing = [...vasilhameTargets.keys()].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map((id) => entities.vasilhames.get(id).catch(() => null))
      );
      for (const row of fetched) {
        if (row?.id == null) continue;
        byId.set(String(row.id), row);
      }
    }

    const patches = [];
    for (const [vid, meta] of vasilhameTargets) {
      const v = byId.get(vid);
      if (!v) continue;
      const vol = Number(v.volume) || 0;
      // Só força Expedido quando o tanque já está fisicamente vazio.
      if (roundVolume(vol) > 0) continue;
      if (!needsExpedicaoHeal(v)) continue;
      patches.push({
        id: vid,
        status: "Expedido",
        data_saida: meta.dataSaida || null,
      });
    }
    if (patches.length > 0) {
      try {
        await entities.vasilhames.bulkUpdate(patches);
        vasilhamesFixed = patches.length;
      } catch (err) {
        console.error(
          "[saidaFiscal] Falha ao reconciliar vasilhames expedidos:",
          err
        );
      }
    }
  }

  return { containersFixed, vasilhamesFixed };
}
