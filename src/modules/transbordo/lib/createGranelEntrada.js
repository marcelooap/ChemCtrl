import { entities } from "@transbordo/services/entities";
import { loteQuantidadeEstoque, loteUnidadeEstoque } from "@transbordo/lib/conversao";

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Cria entrada granel + linhas de estoque (mesmo contrato da tela Entradas).
 * @returns {Promise<{ savedEntrada: object, savedEstoques: object[], entrada_codigo: string }>}
 */
export async function createGranelEntrada({ data }) {
  const entradaPayload = {
    ...data,
    data: data.data || todayISO(),
    cliente_id: nullIfEmpty(data.cliente_id),
    produto_id: nullIfEmpty(data.produto_id),
    data_fabricacao: nullIfEmpty(data.data_fabricacao),
    data_validade: nullIfEmpty(data.data_validade),
    lotes: (data.lotes || []).map((l) => ({
      ...l,
      produto_id: nullIfEmpty(l.produto_id),
      data_fabricacao: nullIfEmpty(l.data_fabricacao),
      data_validade: nullIfEmpty(l.data_validade),
    })),
  };

  const entradaRows = await entities.entradas.list();
  const savedEntrada = await entities.entradas.create(entradaPayload);
  const entradaCodigo = `E${String((entradaRows?.length || 0) + 1).padStart(3, "0")}`;
  const grupoId = data.grupo_entrada || `GRP-${Date.now()}`;

  const estoqueRecords = (entradaPayload.lotes || []).map((lote) => {
    const loteQtd = loteQuantidadeEstoque(lote);
    const lotePreco = lote.preco_unitario || data.preco_unitario || 0;
    return {
      entrada_id: savedEntrada.id,
      entrada_codigo: entradaCodigo,
      grupo_entrada: grupoId,
      cliente_id: nullIfEmpty(data.cliente_id),
      cliente_nome: data.cliente_nome || "",
      produto_id: nullIfEmpty(lote.produto_id || data.produto_id),
      produto_nome: lote.produto_nome || data.produto_nome,
      produto_codigo: lote.produto_codigo || data.produto_codigo,
      nota_fiscal: lote.nota_fiscal,
      lote: lote.lote,
      densidade: lote.densidade,
      data_fabricacao: nullIfEmpty(lote.data_fabricacao),
      data_validade: nullIfEmpty(lote.data_validade),
      quantidade: loteQtd,
      unidade_medida: loteUnidadeEstoque(lote),
      saldo_atual: loteQtd,
      preco_unitario: lotePreco,
      custo_total: loteQtd * lotePreco,
      embalado: false,
      peso_liquido: null,
      quantidade_embalagens: null,
      status_wms: data.status_wms || false,
      origem: data.origem || "convencional",
      granel_pesagem: data.granel_pesagem || false,
      granel_ticket: data.granel_ticket || null,
      granel_peso_bruto: data.granel_peso_bruto ?? null,
      granel_validacao_bruto: data.granel_validacao_bruto ?? null,
      granel_peso_liquido: data.granel_peso_liquido ?? null,
      granel_validacao_liquido: data.granel_validacao_liquido ?? null,
      granel_erro_admissivel: data.granel_erro_admissivel ?? null,
      granel_peso_minimo: data.granel_peso_minimo ?? null,
      granel_peso_maximo: data.granel_peso_maximo ?? null,
      granel_margem: data.granel_margem || null,
      lotes: [lote],
    };
  });

  const savedEstoques =
    estoqueRecords.length > 0
      ? await entities.estoque.bulkCreate(estoqueRecords)
      : [];

  return {
    savedEntrada,
    savedEstoques,
    entrada_codigo: entradaCodigo,
  };
}
