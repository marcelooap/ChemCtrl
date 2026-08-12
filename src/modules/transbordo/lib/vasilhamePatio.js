import { roundMass, roundVolume } from "@transbordo/lib/format";
import {
  resolveMassaVasilhameParaBaixa,
  resolveVolumeVasilhameParaBaixa,
} from "@transbordo/lib/estoqueSaldo";
import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";

function parseDensidade(value) {
  return parseFloat(String(value || "0").replace(",", ".")) || 0;
}

/**
 * Itens de saída convencional vinculados a um vasilhame/tanque.
 */
export function collectConvencionalItemsForVasilhame(saidas = [], vasilhameId) {
  if (!vasilhameId) return [];
  const items = [];
  for (const saida of saidas || []) {
    for (const item of saida.itens || []) {
      if (item?.tipo === "convencional" && item.vasilhame_id === vasilhameId) {
        items.push({ saida, item });
      }
    }
  }
  return items;
}

function sumComposicaoField(composicao, field) {
  return (composicao || []).reduce((s, c) => s + (Number(c?.[field]) || 0), 0);
}

/**
 * Monta patch para devolver o vasilhame/tanque ao pátio com volume e peso restaurados.
 * Ordem: volume atual → snapshot da saída → composição → OP / densidade.
 */
export function buildVasilhameYardRestorePatch(
  vasilhame,
  { linkedItems = [], transbordos = [] } = {}
) {
  if (!vasilhame) return null;

  const tara = Number(vasilhame.tara) || 0;
  const dens = parseDensidade(vasilhame.densidade);
  const currentVol = Number(vasilhame.volume) || 0;
  const currentPeso = Number(vasilhame.peso_liquido) || 0;

  const fromCompL = sumComposicaoField(vasilhame.composicao, "quantidade_l");
  const fromCompKg = sumComposicaoField(vasilhame.composicao, "quantidade_kg");

  let volumeDisponivel = null;
  let volTaken = 0;
  let pesoTaken = 0;
  let qtdEmbTaken = 0;

  for (const row of linkedItems) {
    const item = row?.item || row;
    if (!item) continue;
    volTaken += Number(item.volume_solicitado) || 0;
    pesoTaken +=
      Number(item.peso_liquido) || Number(item.quantidade_solicitada) || 0;
    qtdEmbTaken += Math.max(0, Math.round(Number(item.quantidade_embalagens) || 0));
    if (
      volumeDisponivel == null &&
      item.volume_disponivel != null &&
      Number(item.volume_disponivel) > 0
    ) {
      volumeDisponivel = Number(item.volume_disponivel);
    }
  }

  let newVol = currentVol;
  if (newVol <= 0) {
    if (volumeDisponivel != null && volumeDisponivel > 0) {
      newVol = volumeDisponivel;
    } else if (fromCompL > 0) {
      newVol = fromCompL;
    } else if (volTaken > 0) {
      newVol = currentVol + volTaken;
    } else {
      newVol = resolveVolumeVasilhameParaBaixa(vasilhame, transbordos);
    }
  }

  let newPeso = currentPeso;
  if (newPeso <= 0) {
    if (fromCompKg > 0) {
      newPeso = fromCompKg;
    } else if (dens > 0 && newVol > 0) {
      newPeso = newVol * dens;
    } else if (pesoTaken > 0) {
      newPeso = currentPeso + pesoTaken;
    } else {
      newPeso = resolveMassaVasilhameParaBaixa(vasilhame, transbordos);
    }
  }

  if (newVol <= 0 && newPeso > 0 && dens > 0) {
    newVol = newPeso / dens;
  }
  if (newPeso <= 0 && newVol > 0 && dens > 0) {
    newPeso = newVol * dens;
  }

  newVol = roundVolume(Math.max(0, newVol));
  newPeso = roundMass(Math.max(0, newPeso));

  const patch = {
    status: "No Pátio",
    data_saida: null,
    volume: newVol,
    peso_liquido: newPeso,
    peso_bruto: roundMass(tara + newPeso),
  };

  if (isDestinoEmbalagemUnitaria(vasilhame.tipo)) {
    let qtdNova = getQuantidadeEmbalagensFromVasilhame(vasilhame);
    if (qtdNova <= 0) {
      if (qtdEmbTaken > 0) {
        qtdNova = qtdEmbTaken;
      } else {
        const volPorEmb = getVolumePorEmbalagemFromVasilhame(vasilhame);
        if (volPorEmb > 0 && newVol > 0) {
          qtdNova = Math.max(1, Math.round(newVol / volPorEmb));
        }
      }
    }

    if (qtdNova > 0) {
      const volPorEmb =
        getVolumePorEmbalagemFromVasilhame(vasilhame) ||
        (qtdNova > 0 ? roundVolume(newVol / qtdNova) : 0);
      patch.placa = buildPlacaEmbalagens(qtdNova, vasilhame.tipo);
      patch.composicao = (vasilhame.composicao || []).map((c, i) =>
        i === 0
          ? {
              ...c,
              quantidade_embalagens: qtdNova,
              quantidade_l: newVol,
              quantidade_kg: newPeso,
              volume_por_embalagem: volPorEmb || c.volume_por_embalagem,
            }
          : c
      );
    }
  }

  return patch;
}

/** True quando o tanque está no pátio sem volume/peso, mas ainda há conteúdo recuperável. */
export function needsVasilhameYardVolumeHeal(vasilhame, linkedItems = []) {
  if (!vasilhame) return false;
  const expedido =
    (vasilhame.status || "") === "Expedido" ||
    (vasilhame.data_saida != null && String(vasilhame.data_saida).trim() !== "");
  if (expedido) return false;
  if ((vasilhame.tipo || "") === "Tankagem") return false;

  const vol = Number(vasilhame.volume) || 0;
  const peso = Number(vasilhame.peso_liquido) || 0;
  if (vol > 0 || peso > 0) return false;

  const fromCompL = sumComposicaoField(vasilhame.composicao, "quantidade_l");
  const fromCompKg = sumComposicaoField(vasilhame.composicao, "quantidade_kg");
  if (fromCompL > 0 || fromCompKg > 0) return true;

  for (const row of linkedItems || []) {
    const item = row?.item || row;
    if (!item) continue;
    if (Number(item.volume_disponivel) > 0) return true;
    if (Number(item.volume_solicitado) > 0) return true;
    if (Number(item.peso_liquido) > 0) return true;
  }
  return false;
}
