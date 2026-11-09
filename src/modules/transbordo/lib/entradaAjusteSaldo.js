/**
 * Ajuste de quantidade de entrada e saldos remanescentes no pátio.
 *
 * Princípios:
 * - Não reescreve OPs/saídas históricas.
 * - Só permite editar volumes ainda disponíveis (pátio / origem).
 * - Quantidade total da entrada não pode ficar abaixo do volume já movimentado.
 * - Delta da entrada deve ser alocado (ou descontado) nos itens editáveis.
 */

import {
  roundMass,
  roundVolume,
  roundQuantidade,
  parseDensidade,
} from "@transbordo/lib/format";
import {
  getEstoqueQuantidade,
  getEstoqueUnidade,
  computeEstoqueSaldo,
  computeDisponivelTransbordo,
  estoqueOperaEmLitros,
} from "@transbordo/lib/estoqueSaldo";
import {
  isVasilhameNoPatio,
  seedComposicaoFromVasilhame,
  capacidadeOperacionalDoTanque,
  fracionadoEfetivo,
} from "@transbordo/lib/vasilhameComposicao";
import { entities } from "@transbordo/services/entities";
import { allocateTransbordoCodigo } from "@transbordo/lib/allocateBusinessCodes";
import { syncEstoqueSaldos } from "@transbordo/lib/estoqueSaldo";
import { matchesTanka } from "@transbordo/lib/tankaVolume";

export const AJUSTE_ENTRADA_CODIGO = "AJUSTE-ENTRADA";
const TOLERANCIA_ALOCACAO = 0.05;

function roundOp(emLitros, value) {
  return emLitros ? roundVolume(value) : roundQuantidade(value);
}

function idsEqual(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function estoqueIdsOfEntrada(estoqueItems = [], entradaId) {
  const ids = new Set();
  for (const e of estoqueItems || []) {
    if (!e?.id) continue;
    if (entradaId && e.entrada_id && !idsEqual(e.entrada_id, entradaId)) continue;
    if (String(e?.grupo_entrada || "").startsWith("TB")) continue;
    ids.add(String(e.id));
    if (e.entrada_id) ids.add(String(e.entrada_id));
  }
  if (entradaId) ids.add(String(entradaId));
  return ids;
}

function composicaoApontaEstoque(composicao = [], estoqueIdSet) {
  return (composicao || []).some(
    (c) =>
      (c?.estoque_id && estoqueIdSet.has(String(c.estoque_id))) ||
      (c?.entrada_id && estoqueIdSet.has(String(c.entrada_id)))
  );
}

function destinoApontaEstoqueViaOp(transbordo, estoqueIdSet) {
  const origens = Array.isArray(transbordo?.origens) ? transbordo.origens : [];
  return origens.some((o) => {
    const id = o?.estoque_id || o?.entrada_id;
    return id && estoqueIdSet.has(String(id));
  });
}

function volumeItemPatio(item) {
  return roundVolume(Number(item?.volume) || 0);
}

function isTankagem(item) {
  return String(item?.tipo || item?.tipo_embalagem || "") === "Tankagem";
}

/**
 * Resumo operacional da entrada para a UI de ajuste.
 *
 * - quantidade: total registrado na entrada
 * - disponivelOrigem: ainda pode sair em novo OP a partir do estoque
 * - disponivelPatio: volume em tanques/tanka ainda no pátio
 * - movimentado: quantidade − origem − pátio (já saiu / comprometido)
 */
export function computeEntradaSaldoResumo({
  entradaId,
  estoqueItems = [],
  transbordos = [],
  saidas = [],
  vasilhames = [],
}) {
  const items = (estoqueItems || []).filter(
    (e) => !String(e?.grupo_entrada || "").startsWith("TB")
  );

  let quantidade = 0;
  let saldoEstoque = 0;
  let disponivelOrigem = 0;
  let unidade = "kg";
  let emLitros = false;
  let dens = 0;

  for (const item of items) {
    const q = getEstoqueQuantidade(item);
    const s = computeEstoqueSaldo(item, transbordos, saidas, vasilhames);
    const dOrig = computeDisponivelTransbordo(item, transbordos);
    quantidade += q;
    saldoEstoque += s;
    disponivelOrigem += dOrig;
    if (estoqueOperaEmLitros(item)) emLitros = true;
    unidade = getEstoqueUnidade(item) || unidade;
    if (!dens) dens = parseDensidade(item.densidade);
  }

  const patioItens = listItensPatioEditaveis({
    entradaId,
    estoqueItems: items,
    vasilhames,
    transbordos,
  });
  const disponivelPatioL = roundVolume(
    patioItens.reduce((s, i) => s + (Number(i.volume_atual) || 0), 0)
  );
  const disponivelPatio = emLitros
    ? disponivelPatioL
    : dens > 0
      ? roundMass(disponivelPatioL * dens)
      : roundQuantidade(disponivelPatioL);

  quantidade = roundOp(emLitros, quantidade);
  saldoEstoque = roundOp(emLitros, Math.max(0, saldoEstoque));
  disponivelOrigem = roundOp(emLitros, Math.max(0, disponivelOrigem));
  const disponivel = roundOp(
    emLitros,
    Math.max(0, disponivelOrigem + disponivelPatio)
  );
  const movimentado = roundOp(
    emLitros,
    Math.max(0, quantidade - disponivel)
  );

  return {
    quantidade,
    saldoEstoque,
    disponivel,
    disponivelOrigem,
    disponivelPatio,
    disponivelPatioL,
    movimentado,
    minimoPermitido: movimentado,
    unidade,
    emLitros,
    densidade: dens,
    patioItens,
    estoqueIds: items.map((e) => e.id).filter(Boolean),
  };
}

/**
 * Itens ainda no pátio (tanque/vasilhame/tanka) editáveis para absorver o delta.
 */
export function listItensPatioEditaveis({
  entradaId,
  estoqueItems = [],
  vasilhames = [],
  transbordos = [],
}) {
  const estoqueIdSet = estoqueIdsOfEntrada(estoqueItems, entradaId);
  const linkedOpIds = new Set();

  for (const t of transbordos || []) {
    if (!destinoApontaEstoqueViaOp(t, estoqueIdSet)) continue;
    if (t.id) linkedOpIds.add(String(t.id));
    const code = String(t.codigo_transbordo || "").trim();
    if (code) linkedOpIds.add(code);

    for (const d of t.destinos || []) {
      if (d?.vasilhame_existente_id) linkedOpIds.add(String(d.vasilhame_existente_id));
      if (d?.tanka_id) linkedOpIds.add(String(d.tanka_id));
    }
  }

  const items = [];
  for (const v of vasilhames || []) {
    if (!isVasilhameNoPatio(v)) continue;
    const vol = volumeItemPatio(v);
    if (vol <= 0) continue;

    const byComposicao = composicaoApontaEstoque(v.composicao, estoqueIdSet);
    const byOp =
      (v.transbordo_id && linkedOpIds.has(String(v.transbordo_id))) ||
      (v.numero_op && linkedOpIds.has(String(v.numero_op).trim())) ||
      (v.id && linkedOpIds.has(String(v.id))) ||
      (v.composicao || []).some((c) =>
        linkedOpIds.has(String(c?.transbordo_codigo || "").trim())
      );
    const byEntradaDireta =
      v.entrada_id &&
      (estoqueIdSet.has(String(v.entrada_id)) ||
        idsEqual(v.entrada_id, entradaId));

    if (!byComposicao && !byOp && !byEntradaDireta) continue;

    const dens = parseDensidade(v.densidade);
    items.push({
      id: v.id,
      kind: isTankagem(v) ? "tanka" : "tanque",
      label: isTankagem(v)
        ? `Tanka ${v.placa || v.tanka || v.codigo || ""}`.trim()
        : `Tanque ${[v.placa, v.barril].filter(Boolean).join(" / ")}`.trim(),
      placa: v.placa || "",
      barril: v.barril || "",
      tipo: v.tipo || "Vasilhame",
      lote: v.lote || "",
      volume_atual: vol,
      densidade: dens,
      capacidade: Number(v.capacidade) || null,
      unidade: "L",
      vasilhame: v,
    });
  }

  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "tanka" ? -1 : 1;
    return String(a.label).localeCompare(String(b.label), "pt-BR");
  });
}

export function validateAjusteQuantidade({
  novaQuantidade,
  movimentado,
  unidade = "",
}) {
  const nova = Number(novaQuantidade);
  const min = Number(movimentado) || 0;
  if (!Number.isFinite(nova) || nova <= 0) {
    return {
      ok: false,
      message: "Informe uma quantidade total válida maior que zero.",
    };
  }
  if (nova + 1e-9 < min) {
    const um = unidade ? ` ${unidade}` : "";
    return {
      ok: false,
      message: `Não é possível reduzir a entrada para menos de ${roundQuantidade(
        min
      )}${um}: este volume já foi movimentado (transbordos/saídas).`,
    };
  }
  return { ok: true, message: "" };
}

/**
 * Valida se as alocações cobrem o delta da entrada (em litros de pátio).
 * `deltaL` e volumes das alocações estão em litros.
 * Na redução, `disponivelOrigemL` pode absorver parte do corte sem tocar o pátio.
 */
export function validateAlocacoesAjuste({
  deltaL,
  alocacoes = [],
  disponivelOrigemL = 0,
  exigirAlocacaoCompleta = true,
  permitirManterNaOrigem = false,
}) {
  const d = roundVolume(Number(deltaL) || 0);
  const origemDisp = roundVolume(Math.max(0, Number(disponivelOrigemL) || 0));

  if (Math.abs(d) <= TOLERANCIA_ALOCACAO) {
    const mudancas = (alocacoes || []).filter(
      (a) =>
        Math.abs(
          roundVolume((Number(a.volume_novo) || 0) - (Number(a.volume_atual) || 0))
        ) > TOLERANCIA_ALOCACAO
    );
    if (mudancas.length > 0) {
      return {
        ok: false,
        message:
          "Há alterações em itens do pátio sem mudança na quantidade total da entrada. Ajuste a quantidade total ou reverta os volumes dos itens.",
        alocado: 0,
        restante: 0,
      };
    }
    return { ok: true, message: "", alocado: 0, restante: 0 };
  }

  let alocado = 0;
  for (const a of alocacoes || []) {
    const atual = roundVolume(Number(a.volume_atual) || 0);
    const novoRaw = a.volume_novo;
    const novo = roundVolume(
      novoRaw === "" || novoRaw == null ? NaN : Number(novoRaw)
    );
    if (!Number.isFinite(novo)) {
      return {
        ok: false,
        message: `Informe o novo volume do item ${a.label || a.id}.`,
        alocado: 0,
        restante: d,
      };
    }
    if (novo < -TOLERANCIA_ALOCACAO) {
      return {
        ok: false,
        message: `Volume inválido no item ${a.label || a.id}.`,
        alocado: 0,
        restante: d,
      };
    }
    if (
      a.capacidade != null &&
      Number(a.capacidade) > 0 &&
      novo > Number(a.capacidade) + 1e-9
    ) {
      return {
        ok: false,
        message: `Volume de ${a.label || a.id} excede a capacidade (${a.capacidade} L).`,
        alocado: 0,
        restante: d,
      };
    }
    alocado += novo - atual;
  }
  alocado = roundVolume(alocado);

  // Redução: origem disponível absorve primeiro
  let alvoPatio = d;
  if (d < 0) {
    const absorvidoOrigem = Math.min(-d, origemDisp);
    alvoPatio = roundVolume(d + absorvidoOrigem);
  }

  const restante = roundVolume(alvoPatio - alocado);

  if (d < 0) {
    const aumentou = (alocacoes || []).some(
      (a) =>
        roundVolume(Number(a.volume_novo) || 0) >
        roundVolume(Number(a.volume_atual) || 0) + TOLERANCIA_ALOCACAO
    );
    if (aumentou) {
      return {
        ok: false,
        message:
          "Na redução da entrada, só é permitido diminuir volumes dos itens ainda disponíveis no pátio.",
        alocado,
        restante,
      };
    }
  }

  if (exigirAlocacaoCompleta && Math.abs(restante) > TOLERANCIA_ALOCACAO) {
    if (d > 0 && permitirManterNaOrigem && restante > 0 && alocado >= -TOLERANCIA_ALOCACAO) {
      // Volume adicional permanece disponível na origem para novo OP
      return { ok: true, message: "", alocado, restante };
    }
    const acao = alvoPatio > 0 ? "alocar" : "remover";
    return {
      ok: false,
      message: `Ainda falta ${acao} ${Math.abs(restante)} L nos itens disponíveis do pátio para fechar o ajuste da entrada.`,
      alocado,
      restante,
    };
  }

  return { ok: true, message: "", alocado, restante };
}

function buildAjusteComposicaoEntry({
  lote,
  deltaL,
  dens,
  estoqueId,
  entradaCodigo,
}) {
  const vol = roundVolume(deltaL);
  return {
    lote: lote || "",
    quantidade_l: vol,
    quantidade_kg: dens > 0 ? roundMass(vol * dens) : 0,
    transbordo_codigo: AJUSTE_ENTRADA_CODIGO,
    ajuste_entrada: true,
    lote_manual: true,
    estoque_id: estoqueId || null,
    entrada_id: estoqueId || null,
    entrada_codigo: entradaCodigo || null,
    data: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Monta patch de volume/composição para um tanque do pátio sem reescrever OPs.
 */
export function buildVasilhameAjustePatch(
  vasilhame,
  volumeNovo, {
    lote,
    dens,
    estoqueId,
    entradaCodigo,
  } = {}
) {
  const atual = volumeItemPatio(vasilhame);
  const novo = roundVolume(volumeNovo);
  const delta = roundVolume(novo - atual);
  if (Math.abs(delta) <= TOLERANCIA_ALOCACAO) return null;

  const densidade = dens > 0 ? dens : parseDensidade(vasilhame.densidade);
  let composicao = seedComposicaoFromVasilhame({
    ...vasilhame,
    volume: atual,
  }).filter(
    (c) =>
      !(
        c?.ajuste_entrada ||
        String(c?.transbordo_codigo || "").trim() === AJUSTE_ENTRADA_CODIGO
      )
  );

  const baseSemAjuste = roundVolume(
    composicao.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
  );
  const precisa = roundVolume(novo - baseSemAjuste);

  if (precisa > TOLERANCIA_ALOCACAO) {
    composicao = [
      ...composicao,
      buildAjusteComposicaoEntry({
        lote: lote || vasilhame.lote,
        deltaL: precisa,
        dens: densidade,
        estoqueId,
        entradaCodigo,
      }),
    ];
  } else if (precisa < -TOLERANCIA_ALOCACAO) {
    // Reduz a partir do fim: primeiro ajustes/aporte, depois fatias remanescentes.
    // Não apaga o histórico conceitual dos OPs — só o saldo ainda no pátio.
    let remaining = roundVolume(-precisa);
    const next = [];
    for (let i = composicao.length - 1; i >= 0; i--) {
      const c = composicao[i];
      const q = roundVolume(c.quantidade_l || 0);
      if (remaining <= TOLERANCIA_ALOCACAO) {
        next.unshift(c);
        continue;
      }
      const take = Math.min(q, remaining);
      const left = roundVolume(q - take);
      remaining = roundVolume(remaining - take);
      if (left > TOLERANCIA_ALOCACAO) {
        next.unshift({
          ...c,
          quantidade_l: left,
          quantidade_kg:
            densidade > 0
              ? roundMass(left * densidade)
              : q > 0
                ? roundMass(((c.quantidade_kg || 0) * left) / q)
                : 0,
        });
      }
    }
    composicao = next;
    if (remaining > TOLERANCIA_ALOCACAO) {
      throw new Error(
        `Não há saldo suficiente no pátio para reduzir o item ${
          vasilhame.placa || vasilhame.id
        }.`
      );
    }
  }

  const peso =
    densidade > 0
      ? roundMass(novo * densidade)
      : roundMass(
          (composicao || []).reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0)
        );

  return {
    id: vasilhame.id,
    volume: novo,
    peso_liquido: peso,
    peso_bruto: roundMass((Number(vasilhame.tara) || 0) + peso),
    composicao,
    fracionado: fracionadoEfetivo(
      vasilhame.fracionado,
      novo,
      capacidadeOperacionalDoTanque({ ...vasilhame, volume: novo }, novo)
    ),
    origem: vasilhame.origem || "manual",
  };
}

/**
 * Persiste alocações de ajuste nos itens do pátio e, se necessário,
 * registra OP leve de ajuste para tanka (ledger).
 */
export async function persistAjustePatioAlocacoes({
  alocacoes = [],
  estoqueItems = [],
  entrada,
  entradaCodigo,
  densFallback = 0,
  transbordos = [],
}) {
  const mudancas = (alocacoes || []).filter((a) => {
    const delta = roundVolume(
      (Number(a.volume_novo) || 0) - (Number(a.volume_atual) || 0)
    );
    return Math.abs(delta) > TOLERANCIA_ALOCACAO && a.vasilhame?.id;
  });
  if (mudancas.length === 0) {
    return { updated: 0, ajusteOps: 0 };
  }

  const primaryEstoque = (estoqueItems || []).find(
    (e) => !String(e?.grupo_entrada || "").startsWith("TB")
  );
  const dens =
    densFallback ||
    parseDensidade(primaryEstoque?.densidade) ||
    parseDensidade(entrada?.densidade) ||
    0;

  let updated = 0;
  let ajusteOps = 0;
  const estoqueIdsToSync = new Set(
    (estoqueItems || []).map((e) => e.id).filter(Boolean)
  );

  for (const a of mudancas) {
    const v = a.vasilhame;
    const delta = roundVolume(
      (Number(a.volume_novo) || 0) - (Number(a.volume_atual) || 0)
    );
    const kind = a.kind === "tanka" || isTankagem(v) ? "tanka" : "tanque";

    // Aumento (qualquer destino): OP leve origem→destino.
    // Redução de tanka: OP de baixa no ledger. Tanque comum: só patch de volume.
    if (delta > TOLERANCIA_ALOCACAO || (delta < -TOLERANCIA_ALOCACAO && kind === "tanka")) {
      await persistAjustePatioOp({
        vasilhame: v,
        kind,
        deltaL: delta,
        estoque: primaryEstoque,
        entrada,
        entradaCodigo,
        dens,
        transbordos,
      });
      ajusteOps += 1;
    }

    const patch = buildVasilhameAjustePatch(v, a.volume_novo, {
      lote: a.lote || v.lote || primaryEstoque?.lote,
      dens: dens || parseDensidade(v.densidade),
      estoqueId: primaryEstoque?.id,
      entradaCodigo,
    });
    if (patch) {
      await entities.vasilhames.update(patch.id, patch);
      updated += 1;
    }
  }

  if (estoqueIdsToSync.size > 0) {
    await syncEstoqueSaldos([...estoqueIdsToSync]);
  }

  return { updated, ajusteOps };
}

/**
 * OP mínimo de ajuste (não reescreve histórico):
 * - aumento: origem estoque → destino tanque/tanka (top-up)
 * - redução de tanka: origem tanka (baixa no ledger) com destino técnico zerado
 */
async function persistAjustePatioOp({
  vasilhame,
  kind,
  deltaL,
  estoque,
  entrada,
  entradaCodigo,
  dens,
  transbordos,
}) {
  const delta = roundVolume(deltaL);
  if (Math.abs(delta) <= TOLERANCIA_ALOCACAO) return null;

  const codigo = await allocateTransbordoCodigo(transbordos);
  const hoje = new Date();
  const data = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  const massa = dens > 0 ? roundMass(Math.abs(delta) * dens) : 0;
  const abs = Math.abs(delta);
  const isTanka = kind === "tanka";
  const tankaCodigo = vasilhame.placa || vasilhame.tanka || "";

  let origens;
  let destinos;

  if (delta > 0) {
    if (!estoque?.id) {
      throw new Error(
        "Não foi possível alocar volume adicional: estoque da entrada não encontrado."
      );
    }
    origens = [
      {
        tipo_origem: "entrada",
        entrada_id: estoque.id,
        estoque_id: estoque.id,
        entrada_codigo:
          estoque.entrada_codigo || entradaCodigo || entrada?.entrada_codigo || "",
        lote: estoque.lote || entrada?.lote || "",
        volume_retirado: abs,
        massa_retirada: massa,
        densidade: dens || estoque.densidade || "",
      },
    ];
    destinos = [
      isTanka
        ? {
            tipo_embalagem: "Tankagem",
            tanka_id: vasilhame.id,
            tanka_codigo: tankaCodigo,
            placa: tankaCodigo,
            volume: abs,
            volume_total: abs,
            peso_liquido: massa,
            vasilhame_existente_id: vasilhame.id,
            ajuste_entrada: true,
          }
        : {
            tipo_embalagem: "Vasilhame",
            placa: vasilhame.placa || "",
            barril: vasilhame.barril || "",
            volume: abs,
            volume_total: abs,
            peso_liquido: massa,
            tara: Number(vasilhame.tara) || 0,
            vasilhame_existente_id: vasilhame.id,
            ajuste_entrada: true,
          },
    ];
  } else if (isTanka) {
    origens = [
      {
        tipo_origem: "tanka",
        entrada_id: vasilhame.id,
        tanka_id: vasilhame.id,
        entrada_codigo: tankaCodigo,
        tanka_codigo: tankaCodigo,
        lote: vasilhame.lote || estoque?.lote || "",
        volume_retirado: abs,
        massa_retirada: massa,
        densidade: dens || vasilhame.densidade || "",
        lotes_retirados: [
          {
            lote: vasilhame.lote || estoque?.lote || "",
            volume_retirado: abs,
          },
        ],
      },
    ];
    destinos = [
      {
        tipo_embalagem: "Tankagem",
        tanka_id: vasilhame.id,
        tanka_codigo: tankaCodigo,
        placa: tankaCodigo,
        volume: 0,
        volume_total: 0,
        peso_liquido: 0,
        vasilhame_existente_id: vasilhame.id,
        ajuste_entrada: true,
      },
    ];
  } else {
    return null;
  }

  const payload = {
    data,
    codigo_transbordo: codigo,
    cliente_id: entrada?.cliente_id || estoque?.cliente_id || null,
    cliente_nome: entrada?.cliente_nome || estoque?.cliente_nome || "",
    produto_id: entrada?.produto_id || estoque?.produto_id || null,
    produto_nome: entrada?.produto_nome || estoque?.produto_nome || "",
    produto_codigo: entrada?.produto_codigo || estoque?.produto_codigo || "",
    densidade: dens || estoque?.densidade || vasilhame.densidade || "",
    volume_total: abs,
    massa_total: massa,
    origens,
    destinos,
    observacao: `Ajuste de quantidade da entrada ${
      entradaCodigo || entrada?.entrada_codigo || entrada?.id || ""
    }`.trim(),
    status: "Concluído",
  };

  return entities.transbordos.create(payload);
}

/**
 * Converte delta da quantidade da entrada (UOM operacional) para litros
 * quando o item de pátio opera em L.
 */
export function deltaEntradaParaLitros(delta, { emLitros, dens }) {
  const d = Number(delta) || 0;
  if (emLitros) return roundVolume(d);
  if (dens > 0) return roundVolume(d / dens);
  return roundVolume(d);
}

/**
 * Converte litros de alocação de pátio para a UOM operacional da entrada.
 */
export function litrosParaDeltaEntrada(litros, { emLitros, dens }) {
  const v = roundVolume(litros);
  if (emLitros) return v;
  if (dens > 0) return roundMass(v * dens);
  return roundQuantidade(v);
}

export function sumDeltaAlocacoesLitros(alocacoes = []) {
  return roundVolume(
    (alocacoes || []).reduce((s, a) => {
      const delta =
        (Number(a.volume_novo) || 0) - (Number(a.volume_atual) || 0);
      return s + delta;
    }, 0)
  );
}

/** True se o destino/origem de OP refere-se a esta tanka (helper reexport). */
export { matchesTanka };
