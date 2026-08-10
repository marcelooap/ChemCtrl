/**
 * FIFO allocation utility for transbordo lote consumption.
 * Volumes em litros inteiros; composição com soma exata ao volume do destino.
 */

import {
  roundVolume,
  distributeByWeights,
  parseDensidade,
} from "@transbordo/lib/format";

/**
 * Calcula alocação FIFO de volumes de destino sobre origens.
 * Tudo em litros inteiros — a soma das composições de cada destino
 * coincide exatamente com o volume_total do destino.
 *
 * @param {Array} origens - com volume_retirado (L) já definido
 * @param {Array} destinos - com volume_total (L)
 * @param {number|string} densidade - para quantidade_kg na composição
 */
export function calculateFIFOAllocation(origens = [], destinos = [], densidade = 0) {
  const dens = parseDensidade(densidade);
  let origemIdx = 0;
  let origemRemaining = roundVolume(origens[0]?.volume_retirado || 0);

  const destinoCompositions = destinos.map((d) => {
    const neededTotal = roundVolume(d.volume_total || 0);
    let needed = neededTotal;
    const rawTakes = [];

    while (needed > 0 && origemIdx < origens.length) {
      const take = Math.min(needed, origemRemaining);
      if (take > 0) {
        rawTakes.push({
          lote: origens[origemIdx].lote || "",
          origem_index: origemIdx,
          take,
        });
      }
      needed -= take;
      origemRemaining -= take;
      if (origemRemaining <= 0) {
        origemIdx++;
        origemRemaining = roundVolume(origens[origemIdx]?.volume_retirado || 0);
      }
    }

    // Garante soma das partes === volume do destino (ajusta último take)
    const sumTakes = rawTakes.reduce((s, t) => s + t.take, 0);
    if (rawTakes.length > 0 && sumTakes !== neededTotal) {
      const diff = neededTotal - sumTakes;
      rawTakes[rawTakes.length - 1].take = Math.max(
        0,
        rawTakes[rawTakes.length - 1].take + diff
      );
    }

    return rawTakes.map((t) => ({
      lote: t.lote,
      origem_index: t.origem_index,
      quantidade_l: t.take,
      quantidade_kg: dens > 0 ? roundVolume(t.take * dens) : 0,
    }));
  });

  return { destinoCompositions };
}

/**
 * Expande origens com `lotes_retirados[]` em uma origem por lote (ordem da UI),
 * para que o FIFO destine o 1º lote ao 1º destino, e assim por diante.
 */
export function expandOrigensForFifo(origens = [], densidade = 0) {
  const dens = parseDensidade(densidade);
  const result = [];

  for (const o of origens || []) {
    const lotes = (o.lotes_retirados || []).filter(
      (l) => roundVolume(l.volume_retirado || 0) > 0
    );
    if (lotes.length === 0) {
      result.push(o);
      continue;
    }
    for (const l of lotes) {
      const vol = roundVolume(l.volume_retirado);
      result.push({
        ...o,
        lote: l.lote || "",
        volume_retirado: vol,
        massa_retirada: dens > 0 ? roundVolume(vol * dens) : roundVolume(o.massa_retirada || 0),
        saldo_disponivel: roundVolume(l.saldo_disponivel ?? o.saldo_disponivel ?? 0),
        saldo_restante: Math.max(
          0,
          roundVolume((l.saldo_disponivel ?? 0) - vol)
        ),
      });
    }
  }

  return result;
}

/**
 * Divide um volume total em N embalagens unitárias (IBC/Bombona/Tambor)
 * com volumes inteiros cuja soma === total.
 */
export function splitEmbalagensUnitarias(volumeTotal, quantidade) {
  const qtd = Math.max(1, Math.round(quantidade || 1));
  const total = roundVolume(volumeTotal);
  return distributeByWeights(
    total,
    Array.from({ length: qtd }, () => 1)
  );
}
