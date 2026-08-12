/**
 * Visão unificada de tankas: Transbordo (isotanques + OPs) + Industrialização
 * (cadastro, containers e estoque MP), sem duplicar volume do mesmo tanque físico.
 */

import { roundMass, roundVolume } from "@transbordo/lib/format";
import { computeTankaSaldo } from "@transbordo/lib/tankaVolume";

function normName(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isTankContainer(c) {
  return String(c?.type || "")
    .toLowerCase()
    .includes("tank");
}

/**
 * Volume/produto atuais da tanka no módulo Industrialização
 * (mesma regra da tela Tankagem / Estoque).
 */
export function computeIndTankState(tankName, stockEntries = [], containers = []) {
  if (!tankName) {
    return { volume: 0, produto: "", cliente: "", lote: "", source: null };
  }

  const tankContainers = (containers || []).filter((c) => {
    if (!isTankContainer(c) || c.status !== "No Pátio") return false;
    return normName(c.container_number) === normName(tankName);
  });

  if (tankContainers.length > 0) {
    let volume = 0;
    let latestDate = 0;
    let produto = "";
    let cliente = "";
    let lote = "";

    for (const c of tankContainers) {
      volume += Number(c.volume) || 0;
      const d = new Date(c.created_date || c.created_at || 0).getTime();
      if (d >= latestDate) {
        latestDate = d;
        if (c.product) produto = c.product;
        if (c.client) cliente = c.client;
        if (c.lot) lote = c.lot;
      }
    }

    return {
      volume: roundVolume(volume),
      produto,
      cliente,
      lote,
      source: "ind_container",
    };
  }

  let volume = 0;
  let latestDate = 0;
  let produto = "";
  let cliente = "";
  let lote = "";

  for (const s of stockEntries || []) {
    if (!s?.tank_storage) continue;
    const entries = parseArr(s.tank_entries);
    if (entries.length) {
      for (const te of entries) {
        if (normName(te.tank_name) !== normName(tankName) || !te.volume) continue;
        volume += Number(te.volume) || 0;
        const d = new Date(s.created_date || s.entry_date || 0).getTime();
        if (d >= latestDate) {
          latestDate = d;
          if (s.mp_name) produto = s.mp_name;
          if (s.client) cliente = s.client;
          if (s.lot) lote = s.lot;
        }
      }
    } else if (normName(s.tank_name) === normName(tankName) && s.tank_volume) {
      volume += Number(s.tank_volume) || 0;
      const d = new Date(s.created_date || s.entry_date || 0).getTime();
      if (d >= latestDate) {
        latestDate = d;
        if (s.mp_name) produto = s.mp_name;
        if (s.client) cliente = s.client;
        if (s.lot) lote = s.lot;
      }
    }
  }

  if (volume <= 0) {
    return { volume: 0, produto: "", cliente: "", lote: "", source: null };
  }

  return {
    volume: roundVolume(volume),
    produto,
    cliente,
    lote,
    source: "ind_stock",
  };
}

function resolveTransbordoProduto(iso, tankaCodigo, transbordos) {
  if (iso?.produto_nome) return iso.produto_nome;
  const fillings = (transbordos || [])
    .filter((t) =>
      (t.destinos || []).some(
        (d) =>
          d.tipo_embalagem === "Tankagem" &&
          (d.tanka_id === iso?.id || d.tanka_codigo === tankaCodigo)
      )
    )
    .sort(
      (a, b) =>
        new Date(b.created_at || b.created_date || b.data || 0) -
        new Date(a.created_at || a.created_date || a.data || 0)
    );
  return fillings[0]?.produto_nome || "";
}

function resolveTransbordoCliente(iso, tankaCodigo, transbordos) {
  if (iso?.cliente_nome) return iso.cliente_nome;
  const fillings = (transbordos || [])
    .filter((t) =>
      (t.destinos || []).some(
        (d) =>
          d.tipo_embalagem === "Tankagem" &&
          (d.tanka_id === iso?.id || d.tanka_codigo === tankaCodigo)
      )
    )
    .sort(
      (a, b) =>
        new Date(b.created_at || b.created_date || b.data || 0) -
        new Date(a.created_at || a.created_date || a.data || 0)
    );
  return fillings[0]?.cliente_nome || "";
}

/**
 * Une cadastros de Transbordo e Industrialização por nome normalizado.
 * Escolhe um único volume/produto atual (sem somar os dois módulos).
 *
 * Precedência do estado real:
 * 1) Containers Tankagem "No Pátio" (Industrialização)
 * 2) Saldo por OPs de Transbordo (quando > 0)
 * 3) Fallback de estoque MP em tanka (Industrialização)
 * 4) Metadados de cadastro (volume 0)
 */
export function mergeTankasUnificadas({
  isotanques = [],
  transbordos = [],
  indTanks = [],
  indContainers = [],
  indStock = [],
} = {}) {
  const byName = new Map();

  for (const iso of isotanques || []) {
    const tankaCodigo = String(iso.tanka || iso.codigo_itku || "").trim();
    const key = normName(tankaCodigo);
    if (!key) continue;

    const volumeTb = roundVolume(
      computeTankaSaldo({
        isotanqueId: iso.id,
        tankaCodigo,
        transbordos,
      })
    );

    byName.set(key, {
      id: iso.id,
      sourceIds: { transbordo: iso.id, industrializacao: null },
      tanka: tankaCodigo,
      tankaCodigo,
      codigo_itku: iso.codigo_itku || "",
      capacidade: Number(iso.capacidade) || 0,
      densidade: iso.densidade || "",
      volumeTb,
      produtoTb: resolveTransbordoProduto(iso, tankaCodigo, transbordos),
      clienteTb: resolveTransbordoCliente(iso, tankaCodigo, transbordos),
      isotanque: iso,
      indTank: null,
      hasTransbordo: true,
      hasIndustrializacao: false,
    });
  }

  for (const tank of indTanks || []) {
    const tankaCodigo = String(tank.name || "").trim();
    const key = normName(tankaCodigo);
    if (!key) continue;

    const prev = byName.get(key);
    if (prev) {
      prev.hasIndustrializacao = true;
      prev.indTank = tank;
      prev.sourceIds.industrializacao = tank.id;
      if (!prev.capacidade && tank.capacity) {
        prev.capacidade = Number(tank.capacity) || 0;
      }
      if (!prev.densidade && tank.density) prev.densidade = tank.density;
    } else {
      byName.set(key, {
        id: `ind:${tank.id}`,
        sourceIds: { transbordo: null, industrializacao: tank.id },
        tanka: tankaCodigo,
        tankaCodigo,
        codigo_itku: "",
        capacidade: Number(tank.capacity) || 0,
        densidade: tank.density || "",
        volumeTb: 0,
        produtoTb: "",
        clienteTb: "",
        isotanque: null,
        indTank: tank,
        hasTransbordo: false,
        hasIndustrializacao: true,
      });
    }
  }

  return [...byName.values()]
    .map((row) => {
      const indState = row.hasIndustrializacao
        ? computeIndTankState(row.tankaCodigo, indStock, indContainers)
        : { volume: 0, produto: "", cliente: "", lote: "", source: null };

      // Cadastro Ind sem containers/stock ativos ainda pode ter product/client no registro
      const indCadastroProduto = row.indTank?.product || "";
      const indCadastroCliente = row.indTank?.client || "";
      const indCadastroLote = row.indTank?.lot || "";

      let volumeAtual = 0;
      let produto = "";
      let cliente_nome = "";
      let lote = "";
      let volumeSource = "none";

      if (indState.source === "ind_container") {
        volumeAtual = indState.volume;
        produto = indState.produto || indCadastroProduto || row.produtoTb || "";
        cliente_nome =
          indState.cliente || indCadastroCliente || row.clienteTb || "";
        lote = indState.lote || indCadastroLote || "";
        volumeSource = "ind_container";
      } else if (row.volumeTb > 0) {
        volumeAtual = row.volumeTb;
        produto = row.produtoTb || indState.produto || indCadastroProduto || "";
        cliente_nome =
          row.clienteTb || indState.cliente || indCadastroCliente || "";
        volumeSource = "transbordo";
      } else if (indState.source === "ind_stock") {
        volumeAtual = indState.volume;
        produto = indState.produto || indCadastroProduto || row.produtoTb || "";
        cliente_nome =
          indState.cliente || indCadastroCliente || row.clienteTb || "";
        lote = indState.lote || indCadastroLote || "";
        volumeSource = "ind_stock";
      } else {
        // Vazia: mantém cadastro (Ind ou TB) para aparecer mesmo sem volume
        volumeAtual = 0;
        produto =
          indCadastroProduto ||
          row.produtoTb ||
          indState.produto ||
          "";
        cliente_nome =
          indCadastroCliente ||
          row.clienteTb ||
          indState.cliente ||
          "";
        lote = indCadastroLote || "";
        volumeSource = row.hasIndustrializacao
          ? "ind_cadastro"
          : row.hasTransbordo
            ? "transbordo"
            : "none";
      }

      return {
        id: row.id,
        tanka: row.tanka,
        tankaCodigo: row.tankaCodigo,
        codigo_itku: row.codigo_itku,
        capacidade: row.capacidade || 26000,
        densidade: row.densidade,
        volumeAtual: roundVolume(volumeAtual),
        produto,
        cliente_nome,
        lote,
        volumeSource,
        hasTransbordo: row.hasTransbordo,
        hasIndustrializacao: row.hasIndustrializacao,
        isotanque: row.isotanque,
        indTank: row.indTank,
        sourceIds: row.sourceIds,
        // Compatível com buildTankaDetalhe quando há isotanque
        produto_nome: produto,
      };
    })
    .sort((a, b) =>
      String(a.tankaCodigo).localeCompare(String(b.tankaCodigo), undefined, {
        numeric: true,
      })
    );
}

/**
 * Detalhe para visualização de tanka somente Industrialização
 * (ou quando o volume ativo veio do Ind).
 */
export function buildIndTankaDetalhe(tank) {
  if (!tank) return null;
  const volume = roundVolume(tank.volumeAtual || 0);
  const dens =
    parseFloat(String(tank.densidade || tank.indTank?.density || "0").replace(",", ".")) ||
    0;
  const lote = tank.lote || tank.indTank?.lot || "";

  return {
    id: tank.id,
    tanka: tank.tankaCodigo || tank.tanka || "",
    codigo_itku: tank.codigo_itku || "",
    produto_nome: tank.produto || tank.produto_nome || "",
    produto_codigo: "",
    cliente_nome: tank.cliente_nome || "",
    densidade: dens || tank.densidade || "",
    capacidade: roundVolume(tank.capacidade || 0),
    volume_atual: volume,
    massa_atual: dens > 0 ? roundMass(volume * dens) : 0,
    lotes:
      volume > 0
        ? [
            {
              lote: lote || "—",
              volume,
              massa: dens > 0 ? roundMass(volume * dens) : 0,
              data_envase: null,
              operadores: [],
              transbordo_codigo: "",
            },
          ]
        : [],
    historico: [],
  };
}
