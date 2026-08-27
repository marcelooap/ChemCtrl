import { getRevisionNumber } from "@industrializacao/lib/recipeRevisions";
import {
  isDestinoEstoqueEmbalado,
  isVasilhameLegadoEmbalado,
} from "@transbordo/lib/tiposEmbalagem";
import { resolveTipoRecebimentoEstoque } from "@transbordo/lib/tipoRecebimento";
import {
  isEstoqueEmbalado,
  computeDisponivelTransbordo,
} from "@transbordo/lib/estoqueSaldo";
import { computeTankaSaldo } from "@transbordo/lib/tankaVolume";
import { mergeTankasUnificadas } from "@transbordo/lib/tankaUnificada";

export function parseRecipeRawMaterials(recipe) {
  const raw = recipe?.raw_materials;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function uniqueClientsFromNames(names) {
  const map = new Map();
  (names || []).forEach((raw) => {
    const nome = String(raw || "").trim();
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { id: `ind-cli:${key}`, nome });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

function toProdutoOption({ id, codigo, produto, clienteNome, densidade }) {
  const dens =
    densidade != null && densidade !== "" ? String(densidade) : "";
  const densNum = parseFloat(String(dens).replace(",", ".")) || 0;
  return {
    id,
    codigo: codigo || "",
    produto: produto || "",
    cliente_id: null,
    cliente_nome: clienteNome || "",
    densidade: dens,
    densidade_tabelada: densNum > 0,
  };
}

/** Matérias-primas (receitas + estoque MP), por cliente. */
export function buildMpProdutos(recipes, stocks) {
  const map = new Map();
  const upsert = (client, mpCode, mpName, density) => {
    const clienteNome = String(client || "").trim();
    const codigo = String(mpCode || "").trim();
    const produto = String(mpName || "").trim() || codigo;
    if (!clienteNome || (!codigo && !produto)) return;
    const key = `${clienteNome.toLowerCase()}|${(codigo || produto).toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(
        key,
        toProdutoOption({
          id: `ind-mp:${key}`,
          codigo,
          produto,
          clienteNome,
          densidade: density,
        })
      );
      return;
    }
    if (!prev.produto && produto) prev.produto = produto;
    if (!prev.codigo && codigo) prev.codigo = codigo;
    if (!prev.densidade && density) {
      const next = toProdutoOption({
        id: prev.id,
        codigo: prev.codigo,
        produto: prev.produto,
        clienteNome,
        densidade: density,
      });
      map.set(key, next);
    }
  };

  (recipes || []).forEach((r) => {
    parseRecipeRawMaterials(r).forEach((mp) => {
      upsert(r.client, mp.mp_code, mp.mp_name, mp.mp_density);
    });
  });
  (stocks || []).forEach((s) => {
    upsert(s.client, s.mp_code, s.mp_name, s.density);
  });

  return Array.from(map.values()).sort((a, b) =>
    a.produto.localeCompare(b.produto, "pt-BR")
  );
}

/** Produtos acabados (última revisão da receita por cliente + nome). */
export function buildPaProdutos(recipes) {
  const map = new Map();
  (recipes || []).forEach((r) => {
    const produto = String(r.product_name || "").trim();
    const clienteNome = String(r.client || "").trim();
    if (!produto || !clienteNome) return;
    const key = `${clienteNome.toLowerCase()}|${produto.toLowerCase()}`;
    const current = map.get(key);
    if (!current || getRevisionNumber(r) > getRevisionNumber(current.recipe)) {
      map.set(key, {
        recipe: r,
        option: toProdutoOption({
          id: r.id ? `ind-pa:${r.id}` : `ind-pa:${key}`,
          codigo: r.code || "",
          produto,
          clienteNome,
          densidade: r.density,
        }),
      });
    }
  });
  return Array.from(map.values())
    .map((x) => x.option)
    .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
}

export function uniqueClientesByNome(clientes) {
  const map = new Map();
  (clientes || []).forEach((c) => {
    const nome = String(c?.nome || "").trim();
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...c, nome });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

export function clientsFromProdutos(produtos) {
  return uniqueClientsFromNames((produtos || []).map((p) => p.cliente_nome));
}

/**
 * Catálogo de produtos por destino (Recebimento / Ordem de Transbordo).
 * Industrialização + vasilhame → produto acabado; demais origens/tipos → MP.
 */
export function catalogProdutosByDestino({
  destino,
  tipoOrOrigem,
  produtosTb,
  produtosMp,
  produtosPa,
}) {
  if (destino === "industrializacao") {
    if (!tipoOrOrigem) return [];
    if (tipoOrOrigem === "vasilhame") return produtosPa || [];
    return produtosMp || [];
  }
  if (destino === "convencional") return produtosTb || [];
  return [];
}

function norm(val) {
  return String(val ?? "").trim().toLowerCase();
}

/**
 * Verifica se o registro pertence ao cliente selecionado (por ID ou Nome).
 */
export function matchClienteRecord(clienteId, clienteNome, record) {
  if (!record) return false;
  const cId = record.cliente_id ? String(record.cliente_id).trim() : "";
  const cNome = norm(record.cliente_nome || record.client);
  const targetId = clienteId ? String(clienteId).trim() : "";
  const targetNome = norm(clienteNome);

  if (targetId && cId && targetId === cId) return true;
  if (targetNome && cNome && targetNome === cNome) return true;
  if (!targetId && !targetNome) return true;
  return false;
}

/**
 * Verifica se um registro de estoque/vasilhame/tanka corresponde ao produto de catálogo.
 */
export function matchProdutoRecord(produto, record) {
  if (!produto || !record) return false;
  const pId = produto.id ? String(produto.id).trim() : "";
  const rProdId = record.produto_id ? String(record.produto_id).trim() : "";
  if (pId && rProdId && pId === rProdId) return true;

  const pNome = norm(produto.produto || produto.nome);
  const rNome = norm(record.produto_nome || record.produto || record.product);
  if (pNome && rNome && pNome === rNome) return true;

  const pCod = norm(produto.codigo || produto.code);
  const rCod = norm(record.produto_codigo || record.product_code || record.codigo);
  if (pCod && rCod && pCod === rCod) return true;

  return false;
}

/**
 * Filtra a lista de produtos de um cliente de acordo com o tipo de origem selecionado.
 *
 * Regras:
 * - vasilhame: somente produtos desse cliente que possuem vasilhame (tanque) em estoque no pátio.
 * - embalado (IBC / Bombona / Tambor): somente produtos desse cliente com estoque do tipo embalado.
 * - granel: todos os produtos desse cliente.
 * - tanka: produtos desse cliente que possuem tanka (isotanque) com saldo disponível.
 */
export function filterProdutosByOrigem({
  produtos = [],
  origemTipo = "",
  clienteId = "",
  clienteNome = "",
  vasilhames = [],
  estoque = [],
  isotanques = [],
  transbordos = [],
  containers = [],
  indTanks = [],
  indStock = [],
}) {
  if (!origemTipo || origemTipo === "granel") {
    return produtos;
  }

  if (origemTipo === "vasilhame") {
    const vasilhamesTanqueNoPatio = (vasilhames || []).filter((v) => {
      if (!v) return false;
      if (!matchClienteRecord(clienteId, clienteNome, v)) return false;
      const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
      if (status !== "No Pátio") return false;
      const vol =
        Number(v.volume) ||
        Number(v.peso_liquido) ||
        Number(v.saldo_atual) ||
        0;
      if (vol <= 0) return false;
      if (
        isDestinoEstoqueEmbalado(v.tipo) ||
        isVasilhameLegadoEmbalado(v.tipo)
      ) {
        return false;
      }
      if ((v.tipo || "") === "Tankagem") return false;
      return true;
    });

    const containersNoPatio = (containers || []).filter((c) => {
      if (!c) return false;
      const cClient = norm(c.client);
      const targetNome = norm(clienteNome);
      if (targetNome && cClient && cClient !== targetNome) return false;
      const status = c.status || "No Pátio";
      if (status !== "No Pátio") return false;
      const type = norm(c.type);
      if (type.includes("tank")) return false;
      return true;
    });

    return produtos.filter((p) => {
      const hasVasilhame = vasilhamesTanqueNoPatio.some((v) =>
        matchProdutoRecord(p, v)
      );
      if (hasVasilhame) return true;
      const hasContainer = containersNoPatio.some((c) =>
        matchProdutoRecord(p, c)
      );
      return hasContainer;
    });
  }

  if (origemTipo === "embalado") {
    const estoqueEmbaladoComSaldo = (estoque || []).filter((e) => {
      if (!e) return false;
      if (!matchClienteRecord(clienteId, clienteNome, e)) return false;
      const isEmb =
        resolveTipoRecebimentoEstoque(e) === "embalado" ||
        isEstoqueEmbalado(e) ||
        isDestinoEstoqueEmbalado(e.tipo_embalagem) ||
        isDestinoEstoqueEmbalado(e.lotes?.[0]?.tipo_embalagem);
      if (!isEmb) return false;
      const disponivel = computeDisponivelTransbordo(e, transbordos);
      const saldoAtual = Number(e.saldo_atual) || 0;
      const qtd = Number(e.quantidade) || 0;
      return disponivel > 0 || saldoAtual > 0 || qtd > 0;
    });

    const vasilhamesEmbaladosNoPatio = (vasilhames || []).filter((v) => {
      if (!v) return false;
      if (!matchClienteRecord(clienteId, clienteNome, v)) return false;
      const isEmb =
        isDestinoEstoqueEmbalado(v.tipo) ||
        isVasilhameLegadoEmbalado(v.tipo);
      if (!isEmb) return false;
      const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
      if (status !== "No Pátio") return false;
      const vol =
        Number(v.volume) ||
        Number(v.peso_liquido) ||
        Number(v.saldo_atual) ||
        0;
      return vol > 0;
    });

    return produtos.filter((p) => {
      const hasEstoqueEmb = estoqueEmbaladoComSaldo.some((e) =>
        matchProdutoRecord(p, e)
      );
      if (hasEstoqueEmb) return true;
      const hasVasilhameEmb = vasilhamesEmbaladosNoPatio.some((v) =>
        matchProdutoRecord(p, v)
      );
      return hasVasilhameEmb;
    });
  }

  if (origemTipo === "tanka") {
    const unified = mergeTankasUnificadas({
      isotanques,
      transbordos,
      indTanks,
      indContainers: containers,
      indStock,
    });

    const tankasComSaldo = unified.filter((t) => {
      const vol = Number(t.volumeAtual ?? t.volume ?? t.volumeTb) || 0;
      if (vol <= 0) return false;

      const iso = t.isotanque;
      const ind = t.indTank;
      const cNome = t.cliente_nome || iso?.cliente_nome || ind?.client || "";
      const cId = iso?.cliente_id || null;

      const matchClient =
        matchClienteRecord(clienteId, clienteNome, {
          cliente_id: cId,
          cliente_nome: cNome,
          client: cNome,
        }) ||
        (iso && matchClienteRecord(clienteId, clienteNome, iso));

      return matchClient;
    });

    return produtos.filter((p) =>
      tankasComSaldo.some((t) => {
        const iso = t.isotanque;
        const ind = t.indTank;
        const pNome =
          t.produto ||
          t.produto_nome ||
          iso?.produto_nome ||
          ind?.product ||
          "";
        const pCod = iso?.produto_codigo || t.codigo || "";
        const pId = iso?.produto_id || null;

        const matched =
          matchProdutoRecord(p, {
            produto_id: pId,
            produto_nome: pNome,
            produto_codigo: pCod,
            produto: pNome,
            product: pNome,
          }) ||
          (iso && matchProdutoRecord(p, iso));

        return matched;
      })
    );
  }

  return produtos;
}
