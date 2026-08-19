import { loteToKg, getLoteQuantidadeDeclarada } from "@transbordo/lib/conversao";
import { resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";

export function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function applyTipoRecebimento(lote, tipo) {
  const base = {
    ...lote,
    tipo_recebimento: tipo,
    embalado: tipo === "embalado",
  };

  if (tipo === "embalado") {
    return {
      ...base,
      densidade: "",
      placa: "",
      barril: "",
      volume: "",
      tara: "",
      lacres: "",
      eslinga: "",
      gps: "",
      menor_teste: "",
      fracionado: false,
      vasilhame_existente_id: null,
      peso_bruto: "",
    };
  }

  if (tipo === "vasilhame") {
    return {
      ...base,
      quantidade_embalagens: "",
      unidade_medida: "L",
    };
  }

  return {
    ...base,
    peso_liquido: "",
    quantidade_embalagens: "",
    placa: "",
    barril: "",
    volume: "",
    tara: "",
    lacres: "",
    eslinga: "",
    gps: "",
    menor_teste: "",
    fracionado: false,
    vasilhame_existente_id: null,
    peso_bruto: "",
  };
}

/**
 * Valida lotes de entrada (embalado/vasilhame/granel) — mesmas regras do modal.
 * @returns {string} mensagem de erro ou string vazia
 */
export function validateEntradaLotes(lotes, produtos = []) {
  if (!lotes?.length) return "Adicione pelo menos um bloco de lote.";

  for (let i = 0; i < lotes.length; i++) {
    const l = lotes[i];
    const tipo = resolveTipoRecebimento(l);
    if (!l.produto_id) return `Produto é obrigatório no bloco ${i + 1}.`;
    if (!l.nota_fiscal) return `Nota Fiscal é obrigatória no bloco ${i + 1}.`;
    if (!l.lote) return `Lote é obrigatório no bloco ${i + 1}.`;

    if (tipo === "vasilhame") {
      const lProduto = produtos.find((p) => p.id === l.produto_id);
      const lDensidadeTabelada = lProduto?.densidade_tabelada || false;
      if (!lDensidadeTabelada && !l.densidade) {
        return `Densidade é obrigatória no bloco ${i + 1}.`;
      }
      if (!l.placa?.trim()) {
        return `Nº da Placa é obrigatório no bloco ${i + 1}.`;
      }
      const vol = parseFloat(l.volume) || 0;
      if (!l.volume || vol <= 0) {
        return `Volume deve ser positivo no bloco ${i + 1}.`;
      }
      continue;
    }

    const lQtd = parseFloat(l.quantidade) || 0;
    if (!l.quantidade || lQtd <= 0) {
      return `Quantidade deve ser positiva no bloco ${i + 1}.`;
    }
    if (!l.unidade_medida) {
      return `Unidade de Medida é obrigatória no bloco ${i + 1}.`;
    }
    if (tipo !== "embalado") {
      const lProduto = produtos.find((p) => p.id === l.produto_id);
      const lDensidadeTabelada = lProduto?.densidade_tabelada || false;
      if (!lDensidadeTabelada && !l.densidade) {
        return `Densidade é obrigatória no bloco ${i + 1}.`;
      }
    }
    if (tipo === "embalado") {
      const lPeso = parseFloat(l.peso_liquido) || 0;
      const lQtdEmb = parseFloat(l.quantidade_embalagens) || 0;
      const lTotalCalc = lPeso * lQtdEmb;
      if (Math.abs(lTotalCalc - lQtd) > 0.001) {
        return `A soma do peso líquido das embalagens deve ser igual à quantidade no bloco ${i + 1}.`;
      }
    }
  }

  return "";
}

export function parseEntradaLotes(lotes) {
  return (lotes || []).map((l) => {
    const tipo = resolveTipoRecebimento(l);
    const isEmbalado = tipo === "embalado";
    const isVasilhame = tipo === "vasilhame";
    const volume = isVasilhame ? parseFloat(l.volume) || 0 : null;
    const tara = isVasilhame ? parseFloat(l.tara) || 0 : null;
    const pesoLiquido =
      isEmbalado || isVasilhame ? parseFloat(l.peso_liquido) || 0 : null;
    const pesoBruto = isVasilhame ? parseFloat(l.peso_bruto) || 0 : null;
    const qtdDeclarada = parseFloat(getLoteQuantidadeDeclarada(l)) || 0;

    return {
      produto_id: l.produto_id,
      produto_nome: l.produto_nome,
      produto_codigo: l.produto_codigo,
      nota_fiscal: l.nota_fiscal,
      lote: l.lote,
      densidade: isEmbalado ? null : l.densidade,
      quantidade: isVasilhame ? volume : parseFloat(l.quantidade) || 0,
      quantidade_declarada: tipo === "granel" ? qtdDeclarada : null,
      unidade_medida: isVasilhame ? "L" : l.unidade_medida,
      data_fabricacao: l.data_fabricacao,
      data_validade: l.data_validade,
      preco_unitario: parseFloat(l.preco_unitario) || 0,
      tipo_recebimento: tipo,
      embalado: isEmbalado,
      peso_liquido: pesoLiquido,
      quantidade_embalagens: isEmbalado
        ? parseFloat(l.quantidade_embalagens) || 0
        : null,
      ...(isVasilhame
        ? {
            placa: l.placa || "",
            barril: l.barril || "",
            volume,
            tara,
            lacres: l.lacres || "",
            eslinga: l.eslinga || "",
            gps: l.gps || "",
            menor_teste: l.menor_teste || "",
            fracionado: l.fracionado || false,
            vasilhame_existente_id: l.vasilhame_existente_id || null,
            vasilhame_id: l.vasilhame_id || null,
            peso_bruto: pesoBruto,
          }
        : {}),
    };
  });
}

export function buildEntradaPayload({
  dataEntrada,
  clienteId,
  clienteNome,
  lotes,
  statusWms = false,
  origem = "convencional",
}) {
  const parsedLotes = parseEntradaLotes(lotes);
  const firstLote = parsedLotes[0] || {};
  const qtdKgEfetiva = lotes.reduce((sum, l) => sum + loteToKg(l), 0);
  const custoTotalEfetivo = lotes.reduce((sum, l) => {
    const lQtd = parseFloat(l.quantidade) || 0;
    const lPreco = parseFloat(l.preco_unitario) || 0;
    return sum + lQtd * lPreco;
  }, 0);

  return {
    data: dataEntrada || todayISO(),
    cliente_id: clienteId,
    cliente_nome: clienteNome,
    produto_id: firstLote.produto_id,
    produto_nome: firstLote.produto_nome,
    produto_codigo: firstLote.produto_codigo,
    nota_fiscal: firstLote.nota_fiscal,
    lote: firstLote.lote,
    densidade: firstLote.densidade,
    data_fabricacao: firstLote.data_fabricacao,
    data_validade: firstLote.data_validade,
    quantidade: qtdKgEfetiva,
    unidade_medida: "kg",
    preco_unitario: firstLote.preco_unitario,
    custo_total: custoTotalEfetivo,
    saldo_atual: qtdKgEfetiva,
    embalado: firstLote.embalado,
    peso_liquido:
      firstLote.embalado || firstLote.tipo_recebimento === "vasilhame"
        ? firstLote.peso_liquido
        : null,
    quantidade_embalagens: firstLote.embalado
      ? firstLote.quantidade_embalagens
      : null,
    status_wms: statusWms,
    granel_pesagem: false,
    grupo_entrada: `GRP-${Date.now()}`,
    origem,
    lotes: parsedLotes,
  };
}
