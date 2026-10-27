import { entities } from "@transbordo/services/entities";
import { roundMass, roundVolume } from "@transbordo/lib/format";
import {
  loteQuantidadeEstoque,
  loteUnidadeEstoque,
} from "@transbordo/lib/conversao";
import { buildEntradaCodigoById } from "@transbordo/lib/entradaCodigo";
import {
  resolveTipoRecebimento,
  resolveTipoRecebimentoEstoque,
} from "@transbordo/lib/tipoRecebimento";
import {
  findFracionadoNoPatio,
  mergeComposicao,
  seedComposicaoFromVasilhame,
  getDominantLote,
  placaKey,
  applyAdditionalDestino,
  fracionadoEfetivo,
  capacidadeOperacionalDoTanque,
} from "@transbordo/lib/vasilhameComposicao";
import {
  upsertFiltracaoForVasilhame,
  isFiltracaoElegivel,
} from "@transbordo/lib/filtracao";

function parseDensidade(v) {
  return parseFloat(String(v || "0").replace(",", ".")) || 0;
}

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function vasilhamePertenceEntrada(vasilhame, entradaId, entradaCodigo) {
  if (!vasilhame) return false;
  if (entradaCodigo && String(vasilhame.codigo || "") === String(entradaCodigo)) {
    return true;
  }
  return (vasilhame.composicao || []).some(
    (item) => item?.entrada_id && item.entrada_id === entradaId
  );
}

function isVasilhameLote(lote) {
  return resolveTipoRecebimento(lote) === "vasilhame" && !!String(lote?.placa || "").trim();
}

/**
 * Cria/atualiza vasilhames no pátio a partir dos lotes de uma entrada.
 */
export async function syncVasilhamesFromEntradaLotes({
  lotes,
  savedEntrada,
  savedEstoques = [],
  entradaCodigo,
  clienteId,
  clienteNome,
  produtos = [],
}) {
  const vasilhameLotes = (lotes || []).filter(
    (l) => resolveTipoRecebimento(l) === "vasilhame" && l.placa
  );
  if (vasilhameLotes.length === 0) return;

  const allVasilhames = await entities.vasilhames.list();
  let vasilhamesAtuais = [...allVasilhames];
  const updatedLotes = [...(lotes || [])];
  const estoqueByIndex = [...savedEstoques];
  // Lotes da mesma entrada na mesma placa acumulam no mesmo tanque.
  const touchedByPlaca = new Map();

  for (let i = 0; i < updatedLotes.length; i++) {
    const lote = updatedLotes[i];
    if (resolveTipoRecebimento(lote) !== "vasilhame" || !lote.placa) continue;

    const estoqueItem = estoqueByIndex[i] || null;
    const volume = roundVolume(lote.volume || 0);
    const dens = parseDensidade(lote.densidade);
    const pesoLiquido =
      lote.peso_liquido != null && lote.peso_liquido !== ""
        ? roundMass(lote.peso_liquido)
        : dens > 0
          ? roundMass(volume * dens)
          : 0;
    const tara = roundMass(lote.tara || 0);
    const pesoBruto =
      lote.peso_bruto != null && lote.peso_bruto !== ""
        ? roundMass(lote.peso_bruto)
        : roundMass(tara + pesoLiquido);

    const compItem = {
      lote: lote.lote || "",
      quantidade_l: volume,
      quantidade_kg: pesoLiquido,
      origem_index: 0,
      entrada_id: savedEntrada.id,
      estoque_id: estoqueItem?.id || null,
      entrada_codigo: entradaCodigo,
      data: savedEntrada.data || null,
    };

    const linkedId = lote.vasilhame_id;
    const plateKey = placaKey(lote.placa, lote.barril);
    const touched = touchedByPlaca.get(plateKey) || null;
    const linkedById = touched
      ? vasilhamesAtuais.find((v) => v.id === touched.id) || touched
      : linkedId
        ? vasilhamesAtuais.find((v) => v.id === linkedId)
        : null;
    const jaDestaEntrada = linkedById
      ? null
      : vasilhamesAtuais.find(
          (v) =>
            placaKey(v.placa, v.barril) === plateKey &&
            vasilhamePertenceEntrada(v, savedEntrada.id, entradaCodigo)
        );
    const existingById = linkedById || jaDestaEntrada || null;
    const fracionadoPatio = existingById
      ? null
      : findFracionadoNoPatio(vasilhamesAtuais, {
          placa: lote.placa,
          barril: lote.barril,
          id: lote.vasilhame_existente_id,
        });

    const produtoFiltrado = produtos.find(
      (p) => p.id === (lote.produto_id || savedEntrada.produto_id)
    )?.filtrado;

    if (existingById && touched) {
      const next = applyAdditionalDestino(existingById, {
        addVolume: volume,
        comp: [compItem],
        tara: lote.tara,
        fracionado: lote.fracionado,
        data: savedEntrada.data || null,
        dens: lote.densidade,
      });
      const updated = await entities.vasilhames.update(existingById.id, {
        ...next,
        lacres: lote.lacres || existingById.lacres || "",
        eslinga: lote.eslinga || existingById.eslinga || "",
        gps: lote.gps || existingById.gps || "",
        menor_teste: lote.menor_teste || existingById.menor_teste || null,
        produto_id: lote.produto_id || existingById.produto_id,
        produto_nome: lote.produto_nome || existingById.produto_nome,
        produto_codigo: lote.produto_codigo || existingById.produto_codigo,
        cliente_id: clienteId || existingById.cliente_id,
        cliente_nome: clienteNome || existingById.cliente_nome,
        densidade: lote.densidade || existingById.densidade,
        status: "No Pátio",
      });
      const row = { ...existingById, ...next, ...(updated || {}) };
      vasilhamesAtuais = vasilhamesAtuais.map((v) =>
        v.id === existingById.id ? row : v
      );
      touchedByPlaca.set(plateKey, row);
      updatedLotes[i] = { ...lote, vasilhame_id: existingById.id };
      if (produtoFiltrado && isFiltracaoElegivel(updated || row)) {
        await upsertFiltracaoForVasilhame(entities, updated || row, {
          codigo: entradaCodigo,
        });
      }
      continue;
    }

    if (existingById) {
      const composicao = mergeComposicao([], [compItem], {
        data: savedEntrada.data || null,
      });
      const updated = await entities.vasilhames.update(existingById.id, {
        codigo: entradaCodigo,
        placa: lote.placa || "",
        barril: lote.barril || "",
        volume,
        tara,
        peso_liquido: pesoLiquido,
        peso_bruto: pesoBruto,
        lacres: lote.lacres || "",
        eslinga: lote.eslinga || "",
        gps: lote.gps || "",
        menor_teste: lote.menor_teste || null,
        fracionado: fracionadoEfetivo(
          lote.fracionado,
          volume,
          existingById.capacidade
        ),
        produto_id: lote.produto_id || null,
        produto_nome: lote.produto_nome || "",
        produto_codigo: lote.produto_codigo || "",
        cliente_id: clienteId || null,
        cliente_nome: clienteNome || "",
        lote: lote.lote || "",
        densidade: lote.densidade || "",
        composicao,
        status: "No Pátio",
      });
      const row = { ...existingById, ...updated, composicao, volume };
      vasilhamesAtuais = vasilhamesAtuais.map((v) =>
        v.id === existingById.id ? row : v
      );
      touchedByPlaca.set(plateKey, row);
      updatedLotes[i] = { ...lote, vasilhame_id: existingById.id };
      if (produtoFiltrado && isFiltracaoElegivel(updated || existingById)) {
        await upsertFiltracaoForVasilhame(entities, updated || existingById, {
          codigo: entradaCodigo,
        });
      }
      continue;
    }

    if (fracionadoPatio) {
      const addVol = volume;
      const newVol = roundVolume((fracionadoPatio.volume || 0) + addVol);
      const baseComp = seedComposicaoFromVasilhame(fracionadoPatio);
      const merged = mergeComposicao(baseComp, [compItem], {
        data: savedEntrada.data || null,
      });
      const densV = parseDensidade(fracionadoPatio.densidade) || dens;
      const peso =
        densV > 0
          ? roundMass(newVol * densV)
          : roundMass((fracionadoPatio.peso_liquido || 0) + pesoLiquido);
      const taraFinal =
        lote.tara != null && lote.tara !== ""
          ? tara
          : roundMass(fracionadoPatio.tara || 0);
      const aindaFracionado = fracionadoEfetivo(
        lote.fracionado,
        newVol,
        capacidadeOperacionalDoTanque(
          { ...fracionadoPatio, volume: newVol },
          newVol
        )
      );

      const updated = await entities.vasilhames.update(fracionadoPatio.id, {
        volume: newVol,
        peso_liquido: peso,
        peso_bruto: roundMass(taraFinal + peso),
        tara: taraFinal,
        composicao: merged,
        lote: getDominantLote(merged),
        fracionado: aindaFracionado,
        produto_id: lote.produto_id || fracionadoPatio.produto_id,
        produto_nome: lote.produto_nome || fracionadoPatio.produto_nome,
        produto_codigo: lote.produto_codigo || fracionadoPatio.produto_codigo,
        cliente_id: clienteId || fracionadoPatio.cliente_id,
        cliente_nome: clienteNome || fracionadoPatio.cliente_nome,
        densidade: lote.densidade || fracionadoPatio.densidade,
        lacres: lote.lacres || fracionadoPatio.lacres || "",
        eslinga: lote.eslinga || fracionadoPatio.eslinga || "",
        gps: lote.gps || fracionadoPatio.gps || "",
        menor_teste: lote.menor_teste || fracionadoPatio.menor_teste || null,
        status: "No Pátio",
      });

      const row = {
        ...fracionadoPatio,
        ...(updated || {}),
        volume: newVol,
        composicao: merged,
        fracionado: aindaFracionado,
      };
      vasilhamesAtuais = vasilhamesAtuais.map((v) =>
        v.id === fracionadoPatio.id ? row : v
      );
      touchedByPlaca.set(plateKey, row);
      updatedLotes[i] = { ...lote, vasilhame_id: fracionadoPatio.id };

      if (produtoFiltrado && isFiltracaoElegivel(updated || fracionadoPatio)) {
        await upsertFiltracaoForVasilhame(entities, updated || fracionadoPatio, {
          codigo: entradaCodigo,
        });
      }
      continue;
    }

    const composicao = mergeComposicao([], [compItem], {
      data: savedEntrada.data || null,
    });
    const created = await entities.vasilhames.create({
      codigo: entradaCodigo,
      origem: "manual",
      numero_op: entradaCodigo || null,
      placa: lote.placa || "",
      barril: lote.barril || "",
      tipo: "Vasilhame",
      produto_id: nullIfEmpty(lote.produto_id),
      produto_nome: lote.produto_nome || "",
      produto_codigo: lote.produto_codigo || "",
      cliente_id: clienteId || null,
      cliente_nome: clienteNome || "",
      lote: lote.lote || getDominantLote(composicao),
      densidade: lote.densidade || "",
      volume,
      tara,
      peso_liquido: pesoLiquido,
      peso_bruto: pesoBruto,
      lacres: lote.lacres || "",
      eslinga: lote.eslinga || "",
      gps: lote.gps || "",
      menor_teste: nullIfEmpty(lote.menor_teste),
      status: "No Pátio",
      fracionado: fracionadoEfetivo(lote.fracionado, volume, null),
      composicao,
    });

    if (created?.id) {
      const row = { ...created, composicao, volume };
      vasilhamesAtuais.push(row);
      touchedByPlaca.set(plateKey, row);
      updatedLotes[i] = { ...lote, vasilhame_id: created.id };
      if (produtoFiltrado && isFiltracaoElegivel(created)) {
        await upsertFiltracaoForVasilhame(entities, created, {
          codigo: entradaCodigo,
        });
      }
    }
  }

  const changed = updatedLotes.some(
    (l, idx) => l.vasilhame_id !== (lotes[idx]?.vasilhame_id || null)
  );
  if (changed) {
    await entities.entradas.update(savedEntrada.id, { lotes: updatedLotes });
  }

  for (let i = 0; i < updatedLotes.length; i++) {
    const lote = updatedLotes[i];
    const estoqueItem = estoqueByIndex[i];
    if (
      !estoqueItem?.id ||
      !lote?.vasilhame_id ||
      resolveTipoRecebimento(lote) !== "vasilhame"
    ) {
      continue;
    }
    const prevLote = estoqueItem.lotes?.[0] || {};
    if (prevLote.vasilhame_id === lote.vasilhame_id) continue;
    await entities.estoque.update(estoqueItem.id, {
      lotes: [
        {
          ...prevLote,
          ...lote,
          vasilhame_id: lote.vasilhame_id,
          tipo_recebimento: "vasilhame",
        },
      ],
    });
  }
}

function estoqueDaEntrada(estoque, entradaId) {
  return (estoque || []).filter((row) => row?.entrada_id === entradaId);
}

function loteJaNoPatio(lote, entrada, patioRows, entradaCodigo) {
  return (patioRows || []).some((v) => {
    if (lote.vasilhame_id && v.id === lote.vasilhame_id) return true;
    if (placaKey(v.placa, v.barril) !== placaKey(lote.placa, lote.barril)) return false;
    return vasilhamePertenceEntrada(v, entrada.id, entradaCodigo);
  });
}

/** Reserva um estoque já gravado para este lote (placa, senão lote ainda não usado). */
function takeEstoqueForLote(pool, used, lote) {
  const byPlaca = pool.findIndex((row, index) => {
    if (used.has(index)) return false;
    const emb = row?.lotes?.[0] || {};
    return (
      emb.placa &&
      lote.placa &&
      placaKey(emb.placa, emb.barril) === placaKey(lote.placa, lote.barril)
    );
  });
  if (byPlaca >= 0) {
    used.add(byPlaca);
    return pool[byPlaca];
  }

  const byLote = pool.findIndex((row, index) => {
    if (used.has(index)) return false;
    const emb = row?.lotes?.[0] || {};
    if (
      emb.placa &&
      lote.placa &&
      placaKey(emb.placa, emb.barril) !== placaKey(lote.placa, lote.barril)
    ) {
      return false;
    }
    if (resolveTipoRecebimentoEstoque(row) !== "vasilhame") return false;
    return String(emb.lote || row.lote || "") === String(lote.lote || "");
  });
  if (byLote >= 0) {
    used.add(byLote);
    return pool[byLote];
  }
  return null;
}

function buildEstoqueFromLote(lote, entrada, entradaCodigo) {
  const loteQtd = loteQuantidadeEstoque(lote);
  const lotePreco = Number(lote.preco_unitario) || Number(entrada.preco_unitario) || 0;
  return {
    entrada_id: entrada.id,
    entrada_codigo: entradaCodigo || null,
    grupo_entrada: entrada.grupo_entrada || null,
    cliente_id: nullIfEmpty(entrada.cliente_id),
    cliente_nome: entrada.cliente_nome || "",
    produto_id: nullIfEmpty(lote.produto_id || entrada.produto_id),
    produto_nome: lote.produto_nome || entrada.produto_nome || "",
    produto_codigo: lote.produto_codigo || entrada.produto_codigo || "",
    nota_fiscal: lote.nota_fiscal || "",
    lote: lote.lote || "",
    densidade: lote.densidade || "",
    data_fabricacao: nullIfEmpty(lote.data_fabricacao),
    data_validade: nullIfEmpty(lote.data_validade),
    saldo_inicial: loteQtd,
    quantidade: loteQtd,
    unidade_medida: loteUnidadeEstoque(lote),
    saldo_final: loteQtd,
    saldo_atual: loteQtd,
    preco_unitario: lotePreco,
    custo_total: loteQtd * lotePreco,
    embalado: false,
    peso_liquido: lote.peso_liquido ?? null,
    quantidade_embalagens: null,
    status_wms: !!entrada.status_wms,
    origem: entrada.origem || "convencional",
    lotes: [{ ...lote, tipo_recebimento: "vasilhame" }],
  };
}

/**
 * Entradas já gravadas como vasilhame que não geraram pátio nem estoque.
 * Idempotente: não duplica tanque nem saldo quando o vínculo já existe.
 */
export async function reconcileVasilhamesFromEntradas({
  entradas = [],
  estoque = [],
  vasilhames = [],
  produtos = [],
} = {}) {
  const codigoById = buildEntradaCodigoById(entradas);
  let estoqueRows = [...(estoque || [])];
  let patioRows = [...(vasilhames || [])];
  let changed = false;

  for (const entrada of entradas || []) {
    if (!entrada?.id) continue;
    const lotes = Array.isArray(entrada.lotes) ? entrada.lotes : [];
    const vasilhameLotes = lotes.filter(isVasilhameLote);
    if (vasilhameLotes.length === 0) continue;

    const entradaCodigo = codigoById[entrada.id] || "";
    const pool = estoqueDaEntrada(estoqueRows, entrada.id);
    const used = new Set();
    const aligned = lotes.map((lote) =>
      isVasilhameLote(lote) ? takeEstoqueForLote(pool, used, lote) : null
    );
    const missing = [];
    lotes.forEach((lote, index) => {
      if (!isVasilhameLote(lote) || aligned[index]) return;
      missing.push(buildEstoqueFromLote(lote, entrada, entradaCodigo));
    });

    if (missing.length > 0) {
      const created = await entities.estoque.bulkCreate(missing);
      estoqueRows = [...estoqueRows, ...(created || [])];
      changed = true;
      const createdQueue = [...(created || [])];
      for (let i = 0; i < aligned.length; i++) {
        if (aligned[i] || !isVasilhameLote(lotes[i])) continue;
        aligned[i] = createdQueue.shift() || null;
      }
    }

    const needsPatio = vasilhameLotes.some(
      (lote) => !loteJaNoPatio(lote, entrada, patioRows, entradaCodigo)
    );
    if (!needsPatio) continue;

    await syncVasilhamesFromEntradaLotes({
      lotes,
      savedEntrada: entrada,
      savedEstoques: aligned,
      entradaCodigo,
      clienteId: nullIfEmpty(entrada.cliente_id),
      clienteNome: entrada.cliente_nome || "",
      produtos,
    });
    changed = true;
    patioRows = await entities.vasilhames.list();
    estoqueRows = await entities.estoque.list();
  }

  return { changed, vasilhames: patioRows, estoque: estoqueRows };
}
