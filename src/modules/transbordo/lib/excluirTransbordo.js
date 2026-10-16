import { entities } from "@transbordo/services/entities";
import { syncEstoqueSaldos } from "@transbordo/lib/estoqueSaldo";
import { roundVolume, roundMass, parseDensidade } from "@transbordo/lib/format";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import { restoreTankaVasilhamesAfterExclude } from "@transbordo/lib/tankaVolume";
import { deleteEstoqueDoTransbordo } from "@transbordo/lib/transbordoEmbalado";
import { revertTopUpsDoTransbordo } from "@transbordo/lib/persistTransbordo";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";

function asId(value) {
  return value ? String(value) : "";
}

/** Origem que aponta para `t_estoque.id` (entrada ou embalado). */
export function isOrigemDeEstoque(origem) {
  if (!origem?.entrada_id) return false;
  const tipo = origem.tipo_origem;
  return !tipo || tipo === "entrada" || tipo === "embalado";
}

/**
 * Tira de um transbordo as origens de estoque informadas e o volume
 * que o FIFO tinha destinado a partir delas.
 * Se não sobra origem ou destino, o movimento deve ser excluído por inteiro.
 */
export function retirarOrigensDoTransbordo(transbordo, estoqueIds) {
  const ids = estoqueIds instanceof Set ? estoqueIds : new Set(estoqueIds || []);
  const origens = transbordo?.origens || [];
  const removidas = origens.filter(
    (o) => isOrigemDeEstoque(o) && ids.has(asId(o.entrada_id))
  );
  if (removidas.length === 0) {
    return { alterou: false, excluir: false };
  }

  const dens = parseDensidade(transbordo.densidade);
  const expanded = expandOrigensForFifo(origens, dens);
  const removedExpanded = expanded.map(
    (o) => isOrigemDeEstoque(o) && ids.has(asId(o.entrada_id))
  );
  const destinosBase = (transbordo.destinos || []).map((d) => ({
    ...d,
    volume_total: roundVolume(d.volume_total || d.volume || 0),
  }));
  const { destinoCompositions } = calculateFIFOAllocation(
    expanded,
    destinosBase,
    dens
  );

  const destinos = [];
  destinosBase.forEach((d, index) => {
    const comp = destinoCompositions[index] || [];
    const removeVol = roundVolume(
      comp
        .filter((c) => removedExpanded[c.origem_index])
        .reduce((sum, c) => sum + (Number(c.quantidade_l) || 0), 0)
    );
    const current = roundVolume(d.volume_total || d.volume || 0);
    const next = roundVolume(Math.max(0, current - removeVol));
    if (next <= 0) return;
    const peso =
      dens > 0
        ? roundMass(next * dens)
        : roundMass(
            (Number(d.peso_liquido) || 0) * (current > 0 ? next / current : 0)
          );
    const tara = Number(d.tara) || 0;
    destinos.push({
      ...d,
      volume: next,
      volume_total: next,
      peso_liquido: peso,
      peso_bruto: roundMass(tara + peso),
    });
  });

  const origensRestantes = origens.filter(
    (o) => !(isOrigemDeEstoque(o) && ids.has(asId(o.entrada_id)))
  );
  const volumeTotal = roundVolume(
    destinos.reduce((sum, d) => sum + roundVolume(d.volume_total || d.volume || 0), 0)
  );
  const massaTotal =
    dens > 0
      ? roundMass(volumeTotal * dens)
      : roundMass(destinos.reduce((sum, d) => sum + (Number(d.peso_liquido) || 0), 0));

  return {
    alterou: true,
    excluir: origensRestantes.length === 0 || destinos.length === 0,
    origens: origensRestantes,
    destinos,
    volume_total: volumeTotal,
    massa_total: massaTotal,
  };
}

/** Desfaz um transbordo e os registros que ele gerou (vasilhame, estoque, filtração, tanka de origem). */
export async function excluirTransbordo({
  transbordo,
  transbordos = [],
  isotanques = [],
  vasilhames = [],
  produtoFiltrado = false,
}) {
  if (!transbordo?.id) return;

  const affectedEstoqueIds = (transbordo.origens || [])
    .filter((o) => isOrigemDeEstoque(o))
    .map((o) => o.entrada_id);

  await revertTopUpsDoTransbordo({
    transbordo,
    vasilhamesList: vasilhames,
    densFallback: parseDensidade(transbordo.densidade),
    produtoFiltrado,
  });

  await restoreTankaVasilhamesAfterExclude({
    origens: transbordo.origens || [],
    excludeTransbordoId: transbordo.id,
    isotanques,
    transbordos,
    entities,
    vasilhamesList: vasilhames,
  });

  await entities.vasilhames.deleteMany({ transbordo_id: transbordo.id });
  await entities.filtracoes.deleteMany({ transbordo_id: transbordo.id });
  await deleteEstoqueDoTransbordo(transbordo.id);
  await entities.transbordos.delete(transbordo.id);
  await syncEstoqueSaldos(affectedEstoqueIds);
}

/**
 * Antes de apagar uma entrada: desfaz os transbordos que consumiram o estoque dela.
 * Sem isso o volume permanece nas tankas, porque o saldo é a soma dos destinos da OP.
 */
export async function reverterTransbordosDaEntrada(entradaId) {
  if (!entradaId) return [];

  const estoques = await entities.estoque.filter({ entrada_id: entradaId });
  const ids = new Set((estoques || []).map((e) => asId(e.id)).filter(Boolean));
  if (ids.size === 0) return [];

  const [transbordos, vasilhames, isotanques, produtos] = await Promise.all([
    entities.transbordos.list(),
    entities.vasilhames.list(),
    listTankas(),
    entities.produtos.list(),
  ]);

  const hits = (transbordos || []).filter((t) =>
    (t.origens || []).some((o) => isOrigemDeEstoque(o) && ids.has(asId(o.entrada_id)))
  );

  let atuais = [...(transbordos || [])];
  const revertidos = [];

  for (const transbordo of hits) {
    const origens = transbordo.origens || [];
    const exclusivo =
      origens.length > 0 &&
      origens.every((o) => isOrigemDeEstoque(o) && ids.has(asId(o.entrada_id)));
    const produtoFiltrado = !!(produtos || []).find(
      (p) => p.id === transbordo.produto_id
    )?.filtrado;
    const ctx = {
      transbordo,
      transbordos: atuais,
      isotanques,
      vasilhames,
      produtoFiltrado,
    };

    if (exclusivo) {
      await excluirTransbordo(ctx);
      atuais = atuais.filter((t) => t.id !== transbordo.id);
      revertidos.push(transbordo.codigo_transbordo || transbordo.id);
      continue;
    }

    const next = retirarOrigensDoTransbordo(transbordo, ids);
    if (!next.alterou) continue;
    if (next.excluir) {
      await excluirTransbordo(ctx);
      atuais = atuais.filter((t) => t.id !== transbordo.id);
      revertidos.push(transbordo.codigo_transbordo || transbordo.id);
      continue;
    }

    await entities.transbordos.update(transbordo.id, {
      origens: next.origens,
      destinos: next.destinos,
      volume_total: next.volume_total,
      massa_total: next.massa_total,
    });
    atuais = atuais.map((t) =>
      t.id === transbordo.id
        ? {
            ...t,
            origens: next.origens,
            destinos: next.destinos,
            volume_total: next.volume_total,
            massa_total: next.massa_total,
          }
        : t
    );
    revertidos.push(transbordo.codigo_transbordo || transbordo.id);
  }

  return revertidos;
}
