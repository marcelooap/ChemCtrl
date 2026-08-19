import { entities } from "@transbordo/services/entities";
import { roundMass, roundVolume } from "@transbordo/lib/format";
import { resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";
import {
  findFracionadoNoPatio,
  mergeComposicao,
  seedComposicaoFromVasilhame,
  getDominantLote,
} from "@transbordo/lib/vasilhameComposicao";
import {
  upsertFiltracaoForVasilhame,
  isFiltracaoElegivel,
} from "@transbordo/lib/filtracao";

function parseDensidade(v) {
  return parseFloat(String(v || "0").replace(",", ".")) || 0;
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
    const existingById = linkedId
      ? vasilhamesAtuais.find((v) => v.id === linkedId)
      : null;
    const fracionadoPatio = findFracionadoNoPatio(vasilhamesAtuais, {
      placa: lote.placa,
      barril: lote.barril,
      id: lote.vasilhame_existente_id,
    });

    const produtoFiltrado = produtos.find(
      (p) => p.id === (lote.produto_id || savedEntrada.produto_id)
    )?.filtrado;

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
        fracionado: lote.fracionado || false,
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
      vasilhamesAtuais = vasilhamesAtuais.map((v) =>
        v.id === existingById.id ? { ...v, ...updated } : v
      );
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
      const lotesPosMerge = new Set(
        merged.map((c) => (c.lote || "").trim()).filter(Boolean)
      );
      const aindaFracionado = !!lote.fracionado && lotesPosMerge.size <= 1;

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

      vasilhamesAtuais = vasilhamesAtuais.map((v) =>
        v.id === fracionadoPatio.id ? { ...v, ...updated } : v
      );
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
      placa: lote.placa || "",
      barril: lote.barril || "",
      tipo: "Vasilhame",
      produto_id: lote.produto_id || null,
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
      menor_teste: lote.menor_teste || null,
      status: "No Pátio",
      fracionado: lote.fracionado || false,
      composicao,
    });

    if (created?.id) {
      vasilhamesAtuais.push(created);
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
