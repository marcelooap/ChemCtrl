import {
  formatMass,
  formatVolume,
  formatDensidade,
  formatNum,
  formatQuantidade,
} from "@transbordo/lib/format";
import { origemPertenceAEntrada } from "@transbordo/lib/entradaCodigo";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";
import {
  getQuantidadeNotaFiscal,
  loteToKg,
  kgToLoteUnidade,
} from "@transbordo/lib/conversao";
import { formatEtiquetaEmbalagemPlaca } from "@transbordo/lib/etiquetaConfig";

export function formatDateEntrada(dateStr) {
  if (!dateStr) return "-";
  const raw = String(dateStr);
  const d = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("pt-BR");
}

export function resolveProdutoCadastro(lote, produtosById) {
  if (!lote) return null;
  if (lote.produto_id && produtosById.has(lote.produto_id)) {
    return produtosById.get(lote.produto_id);
  }
  const codigo = String(lote.produto_codigo || "").trim();
  const nome = String(lote.produto_nome || "").trim();
  return (
    [...produtosById.values()].find((p) => {
      if (codigo && String(p.codigo || "").trim() === codigo) return true;
      if (nome && String(p.produto || "").trim() === nome) return true;
      return false;
    }) || null
  );
}

export function resolveDensidade(lote, produtosById) {
  const produto = resolveProdutoCadastro(lote, produtosById);
  if (
    produto?.densidade_tabelada &&
    produto.densidade != null &&
    produto.densidade !== ""
  ) {
    return produto.densidade;
  }
  return lote.densidade;
}

export function resolveControleProduto(lote, produtosById) {
  const produto = resolveProdutoCadastro(lote, produtosById);
  const controlado = Boolean(produto?.controlado);
  const orgao = controlado ? produto?.orgao_regulamentador || null : null;
  return { controlado: controlado && Boolean(orgao), orgao };
}

export function formatDestinoRecebimento(d) {
  if (d.tipo_embalagem === "Tankagem") {
    return d.tanka_codigo || "Tankagem";
  }

  const isVasilhame =
    d.tipo_embalagem === "Vasilhame" || d.placa || d.barril;

  if (isVasilhame && (d.placa || d.barril)) {
    return formatEtiquetaEmbalagemPlaca(d.placa, d.barril) || "-";
  }

  if (isDestinoEstoqueEmbalado(d.tipo_embalagem)) {
    const qtd = Number(d.quantidade_embalagens) || 0;
    return qtd > 0 ? `${d.tipo_embalagem} (${qtd})` : d.tipo_embalagem;
  }

  return d.tipo_embalagem || d.tanka_codigo || "-";
}

function destinoVolume(d) {
  if (d.tipo_embalagem === "Tankagem") return Number(d.volume) || 0;
  return Number(d.volume_total ?? d.volume) || 0;
}

function destinoMassa(d, densidade) {
  if (d.peso_liquido != null && d.peso_liquido !== "") {
    return Number(d.peso_liquido) || 0;
  }
  return destinoVolume(d) * (Number(densidade) || 0);
}

function buildProdutosById(produtos) {
  const map = new Map();
  (produtos || []).forEach((p) => map.set(p.id, p));
  return map;
}

function buildLotes(entrada) {
  if (!entrada) return [];
  if (entrada.lotes?.length > 0) return entrada.lotes;
  return [
    {
      produto_id: entrada.produto_id,
      produto_nome: entrada.produto_nome,
      produto_codigo: entrada.produto_codigo,
      nota_fiscal: entrada.nota_fiscal,
      lote: entrada.lote,
      quantidade: entrada.quantidade,
      quantidade_declarada: entrada.quantidade_declarada,
      unidade_medida: entrada.unidade_medida,
      data_fabricacao: entrada.data_fabricacao,
      data_validade: entrada.data_validade,
      densidade: entrada.densidade,
    },
  ];
}

function buildOrigemIds(entrada, estoque) {
  if (!entrada) return new Set();
  const ids = new Set([entrada.id]);
  (estoque || []).forEach((row) => {
    if (String(row.grupo_entrada || "").startsWith("TB")) return;
    if (row.entrada_id === entrada.id) ids.add(row.id);
  });
  return ids;
}

function buildDestinosList({
  entrada,
  entradaId,
  transbordos,
  origemIds,
  destinosInformados,
}) {
  if (!entrada) return [];
  const codigoRef = String(entradaId || "").trim().toUpperCase();

  const relacionados = (transbordos || []).filter((t) =>
    (t.origens || []).some((o) =>
      origemPertenceAEntrada(o, origemIds, codigoRef)
    )
  );

  const fromOperacao = relacionados.flatMap((t) =>
    (t.destinos || []).map((d) => {
      const volume = destinoVolume(d);
      const massa = destinoMassa(d, t.densidade);
      return {
        codigo: t.codigo_transbordo || "—",
        destino: formatDestinoRecebimento(d),
        volume,
        massa,
      };
    })
  );
  if (fromOperacao.length > 0) return fromOperacao;

  return (destinosInformados || []).map((d) => ({
    codigo: "—",
    destino: formatDestinoRecebimento(d),
    volume: destinoVolume(d),
    massa: destinoMassa(d, entrada?.densidade),
  }));
}

function buildDadosDiferencaPesagem({
  entrada,
  hasPesagem,
  pesoLiquido,
  lotes,
  lotesCount,
  produtosById,
  foraMargem,
}) {
  if (!entrada || !hasPesagem || !Number.isFinite(pesoLiquido) || pesoLiquido <= 0) {
    return null;
  }

  const firstLote = lotes[0] || {};
  const densidadeVal = resolveDensidade(firstLote, produtosById);
  const dens = parseFloat(String(densidadeVal || "").replace(",", ".")) || 0;
  const unidadeMedida = firstLote.unidade_medida || entrada.unidade_medida || "kg";

  const totalNfDeclarado = lotes.reduce((sum, l) => {
    const qNf = getQuantidadeNotaFiscal(l, entrada, { lotesCount });
    return sum + (parseFloat(String(qNf || "0").replace(",", ".")) || 0);
  }, 0);

  const totalNfKg = lotes.reduce((sum, l) => {
    const qNf = getQuantidadeNotaFiscal(l, entrada, { lotesCount });
    return sum + loteToKg({ ...l, quantidade: qNf });
  }, 0);

  const qtdRealUnidade =
    lotesCount === 1
      ? kgToLoteUnidade(pesoLiquido, unidadeMedida, dens)
      : lotes.reduce((sum, l) => {
          const lDens = resolveDensidade(l, produtosById);
          const lDensNum =
            parseFloat(String(lDens || "").replace(",", ".")) || 0;
          const lKg =
            totalNfKg > 0
              ? (pesoLiquido *
                  loteToKg({
                    ...l,
                    quantidade: getQuantidadeNotaFiscal(l, entrada, { lotesCount }),
                  })) /
                totalNfKg
              : pesoLiquido / lotesCount;
          return sum + kgToLoteUnidade(lKg, l.unidade_medida || unidadeMedida, lDensNum);
        }, 0);

  const difKg = pesoLiquido - totalNfKg;
  const difUnidade = qtdRealUnidade - totalNfDeclarado;
  const temDiferenca = foraMargem && Math.abs(difKg) >= 1;

  let diferencaFmt = null;
  if (temDiferenca) {
    const sign = difKg > 0 ? "+" : "";
    diferencaFmt =
      unidadeMedida.toLowerCase() === "kg"
        ? `${sign}${formatMass(difKg)} kg`
        : `${sign}${formatNum(difUnidade, 0)} ${unidadeMedida} (${sign}${formatMass(difKg)} kg)`;
  }

  return {
    unidadeMedida,
    qtdRealUnidade,
    temDiferenca,
    difKg,
    difUnidade,
    diferencaFmt,
    alertaNfFmt: temDiferenca
      ? `${formatNum(qtdRealUnidade, 0)} ${unidadeMedida}`
      : null,
  };
}

/**
 * Mesmos dados e formatação do modal ComunicacaoRecebimentoDialog (visualização de entradas).
 */
export function buildEntradaRecebimentoViewModel({
  entrada,
  entradaId,
  produtos = [],
  transbordos = [],
  estoque = [],
  destinosInformados = [],
  controleLotes = [],
} = {}) {
  if (!entrada) return null;

  const produtosById = buildProdutosById(produtos);
  const lotes = buildLotes(entrada);
  const lotesCount = lotes.length;

  const lotesControle = lotes.map((l, i) => {
    const doCadastro = resolveControleProduto(l, produtosById);
    if (doCadastro.controlado) return doCadastro;
    const externo = controleLotes[i];
    return externo?.controlado && externo.orgao_regulamentador
      ? { controlado: true, orgao: externo.orgao_regulamentador }
      : doCadastro;
  });

  const orgaos = [
    ...new Set(
      lotesControle.filter((c) => c.controlado && c.orgao).map((c) => c.orgao)
    ),
  ];
  const algumControlado = lotesControle.some((c) => c.controlado);
  const todosControlados =
    lotesControle.length > 0 && lotesControle.every((c) => c.controlado);
  const orgaoTexto = orgaos.join(" / ");
  const bannerLabel = todosControlados
    ? "Todos os produtos desta entrada são controlados"
    : "Contém produto(s) controlado(s) nesta entrada";
  const mostrarPorProduto = algumControlado && !todosControlados;

  const origemIds = buildOrigemIds(entrada, estoque);
  const destinosList = buildDestinosList({
    entrada,
    entradaId,
    transbordos,
    origemIds,
    destinosInformados,
  });

  const transbordoTotais = destinosList.reduce(
    (acc, d) => ({
      volume: acc.volume + (d.volume || 0),
      massa: acc.massa + (d.massa || 0),
    }),
    { volume: 0, massa: 0 }
  );

  const hasPesagem =
    Boolean(entrada.granel_pesagem) ||
    entrada.granel_peso_bruto != null ||
    entrada.granel_peso_liquido != null;

  const pesoBruto = Number(entrada.granel_peso_bruto);
  const pesoLiquido = Number(entrada.granel_peso_liquido);
  const pesosInformados =
    entrada.granel_peso_bruto != null &&
    entrada.granel_peso_bruto !== "" &&
    entrada.granel_peso_liquido != null &&
    entrada.granel_peso_liquido !== "";
  const diferenca =
    pesosInformados && Number.isFinite(pesoBruto) && Number.isFinite(pesoLiquido)
      ? pesoBruto - pesoLiquido
      : null;
  const dentroMargem = entrada.granel_margem === "dentro";
  const foraMargem = entrada.granel_margem === "fora";

  const dadosDiferencaPesagem = buildDadosDiferencaPesagem({
    entrada,
    hasPesagem,
    pesoLiquido,
    lotes,
    lotesCount,
    produtosById,
    foraMargem,
  });

  const refId = String(entradaId || "-").trim() || "-";

  return {
    entradaId: refId,
    pdfTitle: `Recebimento ${refId}`,
    fileName: `${String(refId).replace(/[\\/:*?"<>|]+/g, "_")}.pdf`,
    dataEntrada: formatDateEntrada(
      entrada.data || entrada.created_date || entrada.created_at
    ),
    controle: {
      algumControlado,
      mostrarPorProduto,
      banner: algumControlado
        ? { orgao: orgaoTexto, label: bannerLabel }
        : null,
    },
    lotesControle,
    produtosRows: lotes.map((l, i) => {
      const controle = lotesControle[i] || {};
      return {
        codigo: l.produto_codigo || "-",
        produto: l.produto_nome || "-",
        notaFiscal: l.nota_fiscal || entrada.nota_fiscal || "-",
        quantidade: formatQuantidade(
          getQuantidadeNotaFiscal(l, entrada, { lotesCount }),
          { empty: "-" }
        ),
        unidade: l.unidade_medida || "-",
        lote: l.lote || "-",
        controle,
        orgaoLabel:
          controle.controlado && controle.orgao ? String(controle.orgao) : "-",
      };
    }),
    qualidadeRows: lotes.map((l) => ({
      lote: l.lote || "-",
      fabricacao: formatDateEntrada(l.data_fabricacao),
      validade: formatDateEntrada(l.data_validade),
      densidade: formatDensidade(resolveDensidade(l, produtosById)),
    })),
    pesagem: hasPesagem
      ? {
          pesoBruto: formatMass(entrada.granel_peso_bruto, { empty: "-" }),
          pesoLiquido: formatMass(entrada.granel_peso_liquido, { empty: "-" }),
          tara: diferenca == null ? "-" : formatMass(diferenca, { empty: "-" }),
          showDiferencaCol: Boolean(dadosDiferencaPesagem?.temDiferenca),
          diferenca: dadosDiferencaPesagem?.diferencaFmt || "-",
          margem: entrada.granel_margem
            ? dentroMargem
              ? "Dentro da margem"
              : "Fora da margem"
            : "—",
          alertaNotaFiscal: dadosDiferencaPesagem?.temDiferenca
            ? dadosDiferencaPesagem.alertaNfFmt
            : null,
          dentroMargem,
          foraMargem,
          dadosDiferencaPesagem,
        }
      : null,
    transbordo:
      destinosList.length > 0
        ? {
            rows: destinosList.map((d) => ({
              op: d.codigo,
              destino: d.destino,
              volume: formatVolume(d.volume, { empty: "-" }),
              massa: formatMass(d.massa, { empty: "-" }),
            })),
            totalVolume: formatVolume(transbordoTotais.volume, { empty: "-" }),
            totalMassa: formatMass(transbordoTotais.massa, { empty: "-" }),
          }
        : null,
  };
}
