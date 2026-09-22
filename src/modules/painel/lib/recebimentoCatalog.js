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
import {
  computeTankaSaldo,
  matchesTanka,
} from "@transbordo/lib/tankaVolume";

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
 * Une clientes do Transbordo com clientes extras (ex.: Industrialização),
 * preservando o cadastro do Transbordo quando o nome coincide.
 */
export function mergeClientesByNome(clientesTb, extraClientes) {
  const map = new Map();
  uniqueClientesByNome(clientesTb).forEach((c) => {
    map.set(String(c.nome).toLowerCase(), c);
  });
  (extraClientes || []).forEach((c) => {
    const nome = String(c?.nome || "").trim();
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!map.has(key)) map.set(key, { ...c, nome });
  });
  return Array.from(map.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

function sortProdutosByNome(produtos) {
  return [...(produtos || [])].sort((a, b) => {
    const byName = String(a.produto || a.nome || "").localeCompare(
      String(b.produto || b.nome || ""),
      "pt-BR"
    );
    if (byName !== 0) return byName;
    return String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR");
  });
}

/**
 * Matéria-prima (ou produto acabado) vinda do cadastro da Industrialização.
 * Esses itens devem ir para a validação da Industrialização, nunca do Transbordo.
 */
export function isProdutoIndustrializacao(produto) {
  if (!produto) return false;
  if (produto.fonte === "industrializacao") return true;
  const id = String(produto.id || produto.produto_id || "");
  return id.startsWith("ind-");
}

/**
 * Granel na Ordem de Transbordo: produtos cadastrados no Transbordo
 * e matérias-primas cadastradas na Industrialização.
 */
export function catalogProdutosGranel(produtosTb, produtosMp) {
  return sortProdutosByNome([
    ...(produtosTb || []).map((p) => ({ ...p, fonte: "transbordo" })),
    ...(produtosMp || []).map((p) => ({ ...p, fonte: "industrializacao" })),
  ]);
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
 * - tanka: produtos desse cliente com saldo em tanka do Transbordo
 *   (entradas e saídas de OP). Volume e produto da Industrialização não entram.
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
    const tankasComSaldo = (isotanques || [])
      .map((iso) => {
        if (!iso) return null;
        const tankaCodigo = iso.tanka || iso.codigo_itku || "";
        const volume = computeTankaSaldo({
          isotanqueId: iso.id,
          tankaCodigo,
          transbordos,
        });
        if (!(volume > 0)) return null;

        const latest = [...(transbordos || [])]
          .filter((t) =>
            (t.destinos || []).some(
              (d) =>
                d.tipo_embalagem === "Tankagem" &&
                matchesTanka(d, iso.id, tankaCodigo)
            )
          )
          .sort(
            (a, b) =>
              new Date(b.created_at || b.created_date || b.data || 0) -
              new Date(a.created_at || a.created_date || a.data || 0)
          )[0];

        return {
          produto_id: iso.produto_id || latest?.produto_id || null,
          produto_nome: iso.produto_nome || latest?.produto_nome || "",
          produto_codigo: iso.produto_codigo || latest?.produto_codigo || "",
          produto: iso.produto_nome || latest?.produto_nome || "",
          cliente_id: iso.cliente_id || latest?.cliente_id || null,
          cliente_nome: iso.cliente_nome || latest?.cliente_nome || "",
        };
      })
      .filter(
        (t) => t && matchClienteRecord(clienteId, clienteNome, t)
      );

    return produtos.filter((p) => {
      if (isProdutoIndustrializacao(p)) return false;
      return tankasComSaldo.some((t) => matchProdutoRecord(p, t));
    });
  }

  return produtos;
}
