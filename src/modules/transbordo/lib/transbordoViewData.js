import {
  formatVolume,
  formatMass,
  formatQuantidade,
  formatDensidade,
  parseDensidade,
  roundVolume,
  distributeByWeights,
  litrosFromMassaKg,
  resolveVolumeMassaOperacional,
} from "@transbordo/lib/format";
import {
  normalizeUnidadeEntrada,
  isUnidadeMassaEntrada,
  isUnidadeVolumeEntrada,
  getEstoqueUnidadeEntrada,
  isEstoqueEmbalado,
} from "@transbordo/lib/estoqueSaldo";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import { sameTanqueIdentity } from "@transbordo/lib/vasilhameComposicao";

const LABEL_ORIGEM_EMBALADO = "IBC / BOMBONA / TAMBOR";

function formatDate(d) {
  if (!d) return "-";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
}

function isOrigemEmbalado(origem, entradas = []) {
  const tipo = String(origem?.tipo_origem || "").trim().toLowerCase();
  if (
    tipo === "embalado" ||
    tipo === "ibc" ||
    tipo === "bombona" ||
    tipo === "tambor" ||
    origem?.embalado
  ) {
    return true;
  }
  if (!origem?.entrada_id) return false;
  return isEstoqueEmbalado(entradas.find((e) => e.id === origem.entrada_id));
}

function origemTankaCodigo(origem, isotanques = []) {
  if (origem?.tanka_codigo) return String(origem.tanka_codigo).trim();
  const byId = (isotanques || []).find((i) => i.id && i.id === origem?.entrada_id);
  const fromCadastro = byId?.tanka || byId?.codigo_itku || "";
  if (fromCadastro) return String(fromCadastro).trim();
  const codigo = String(origem?.entrada_codigo || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const sep = codigo.indexOf(" - ");
  if (sep > 0) return codigo.slice(0, sep).trim();
  return codigo;
}

function labelOrigemLinha(origem, isotanques = [], entradas = []) {
  const tipo = String(origem?.tipo_origem || "").trim().toLowerCase();
  if (tipo === "tanka") return origemTankaCodigo(origem, isotanques) || "-";
  if (isOrigemEmbalado(origem, entradas)) return LABEL_ORIGEM_EMBALADO;
  if (tipo === "vasilhame") return "Vasilhame";
  return "Granel";
}

function stripLoteDoRotulo(nome) {
  return String(nome || "")
    .replace(/\s*[—–-]\s*Lote\s+.+$/i, "")
    .replace(/\s*\(\s*Lote\s+[^)]*\)\s*$/i, "")
    .trim();
}

function origemProdutoNome(origem, fallbackProduto) {
  const granel = !origem?.tipo_origem || origem.tipo_origem === "entrada";
  const codigo = origem?.entrada_codigo || "";
  if (codigo) {
    const withoutVol = codigo.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const sep = withoutVol.indexOf(" - ");
    if (sep >= 0) {
      const nome = withoutVol.slice(sep + 3).trim();
      if (nome) return granel ? stripLoteDoRotulo(nome) || nome : nome;
    }
    if (granel) {
      const semLote = stripLoteDoRotulo(withoutVol);
      if (semLote && semLote !== withoutVol) return semLote;
    }
  }
  return fallbackProduto || "-";
}

function labelUnidade(unidade) {
  const um = normalizeUnidadeEntrada(unidade);
  if (um === "kg") return "kg";
  if (um === "lb") return "lb";
  if (um === "gal") return "gal";
  return "L";
}

function resolveUnidadeTransbordo(transbordo, produtos = [], entradas = []) {
  const origens = transbordo?.origens || [];

  for (const o of origens) {
    if (o?.unidade_medida) return normalizeUnidadeEntrada(o.unidade_medida);
  }

  for (const o of origens) {
    const entrada = entradas.find((e) => e.id === o.entrada_id);
    if (!entrada) continue;
    const um = getEstoqueUnidadeEntrada(entrada);
    if (um) return normalizeUnidadeEntrada(um);
  }

  const produto =
    produtos.find((p) => p.id === transbordo?.produto_id) ||
    produtos.find(
      (p) =>
        p.codigo &&
        transbordo?.produto_codigo &&
        String(p.codigo) === String(transbordo.produto_codigo)
    );
  if (produto?.unidade_medida) {
    return normalizeUnidadeEntrada(produto.unidade_medida);
  }

  const origemEmbalada = origens.some(
    (o) =>
      o.tipo_origem === "embalado" ||
      o.embalado ||
      (o.entrada_id &&
        isEstoqueEmbalado(entradas.find((e) => e.id === o.entrada_id)))
  );
  if (origemEmbalada) return "kg";

  return "l";
}

function resolveDensidadeDisplay(transbordo, produtos = [], entradas = []) {
  const dens = parseDensidade(transbordo?.densidade);
  if (!dens || dens <= 0) return "-";

  const produto =
    produtos.find((p) => p.id === transbordo?.produto_id) ||
    produtos.find(
      (p) =>
        p.codigo &&
        transbordo?.produto_codigo &&
        String(p.codigo) === String(transbordo.produto_codigo)
    );

  if (produto?.densidade_tabelada) {
    return formatDensidade(dens);
  }

  const entradaIds = new Set(
    (transbordo?.origens || []).map((o) => o.entrada_id).filter(Boolean)
  );
  const densEntrada = entradas
    .filter((e) => entradaIds.has(e.id))
    .flatMap((e) => [e.densidade, ...(e.lotes || []).map((l) => l.densidade)])
    .map((v) => parseDensidade(v))
    .find((d) => d > 0);

  if (densEntrada > 0) {
    return formatDensidade(dens);
  }

  return "-";
}

function isDestinoTanquePatio(tipo) {
  return tipo === "Vasilhame" || tipo === "Tankagem";
}

function formatEmbalagemPlacaBarril(placa, barril) {
  const plate = String(placa || "").trim();
  const barrel = String(barril || "").trim();
  const hasBarril = Boolean(barrel) && !/^[-–—]+$/.test(barrel);
  const hasPlaca = Boolean(plate) && !/^[-–—]+$/.test(plate);
  if (hasPlaca && hasBarril) return `${plate} (${barrel})`;
  if (hasPlaca) return plate;
  if (hasBarril) return barrel;
  return "";
}

function embalagemDestinoLabel(destino) {
  const tipo = destino?.tipo_embalagem || "";
  if (tipo === "Tankagem") {
    return String(destino?.tanka_codigo || "").trim() || "-";
  }
  return formatEmbalagemPlacaBarril(destino?.placa, destino?.barril) || "-";
}

function textoLacre(value) {
  const text = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
    : String(value ?? "").trim();
  if (!text || /^[-–—]+$/.test(text)) return "";
  return text;
}

function lacreDoDestino(destino, transbordo, vasilhames = []) {
  const fromDestino = textoLacre(destino?.lacres);
  if ((destino?.tipo_embalagem || "") !== "Vasilhame") {
    return fromDestino || "-";
  }
  if (fromDestino) return fromDestino;

  const codigo = String(transbordo?.codigo_transbordo || "").trim();
  const id = transbordo?.id;
  const fromVasilhame = (vasilhames || [])
    .filter((v) => {
      if (!sameTanqueIdentity(v.placa, v.barril, destino?.placa, destino?.barril)) {
        return false;
      }
      if (id && v.transbordo_id && String(v.transbordo_id) === String(id)) return true;
      if (codigo && String(v.numero_op || "").trim() === codigo) return true;
      if (codigo && String(v.codigo || "").trim() === codigo) return true;
      return (v.composicao || []).some(
        (c) => codigo && String(c.transbordo_codigo || "").trim() === codigo
      );
    })
    .map((v) => textoLacre(v.lacres))
    .find(Boolean);

  return fromVasilhame || "-";
}

function slicesPorLote(composicao = []) {
  const order = [];
  const map = new Map();
  for (const c of composicao) {
    const qL = roundVolume(c.quantidade_l || 0);
    if (qL <= 0) continue;
    const lote = String(c.lote || "").trim();
    const key = lote.toUpperCase();
    if (!map.has(key)) {
      map.set(key, { lote: lote || "-", quantidade_l: 0 });
      order.push(key);
    }
    const row = map.get(key);
    row.quantidade_l = roundVolume(row.quantidade_l + qL);
  }
  return order.map((key) => map.get(key));
}

function alignSlicesToVolume(slices, volume) {
  if (!slices.length) return slices;
  const target = roundVolume(volume || 0);
  const sum = roundVolume(slices.reduce((s, row) => s + row.quantidade_l, 0));
  if (target <= 0 || sum === target) return slices;
  const next = slices.map((row) => ({ ...row }));
  const last = next[next.length - 1];
  last.quantidade_l = roundVolume(Math.max(0, last.quantidade_l + (target - sum)));
  return next.filter((row) => row.quantidade_l > 0);
}

function massaDestino(destino, volume, densidade, isMassa) {
  if (isMassa) return destino?.peso_liquido ?? volume;
  if (destino?.peso_liquido != null) return destino.peso_liquido;
  if (densidade > 0) return (volume || 0) * densidade;
  return null;
}

function volumeLitrosDisplay(valor, densidade, isMassa) {
  const n = Number(valor) || 0;
  if (n <= 0) return "-";
  if (isMassa) {
    const dens = parseDensidade(densidade);
    if (dens <= 0) return "-";
    return `${formatVolume(litrosFromMassaKg(n, dens), { empty: "-" })} L`;
  }
  return `${formatVolume(n, { empty: "-" })} L`;
}

function buildDestinoLinhas(destino, composicao, densidade, isMassa) {
  const tipo = destino?.tipo_embalagem || "";
  const volume = tipo === "Tankagem" ? destino?.volume : destino?.volume_total;
  const massa = massaDestino(destino, volume, densidade, isMassa);
  const slices = slicesPorLote(composicao);
  const lotesNome = [];
  for (const slice of slices) {
    if (!slice.lote || slice.lote === "-") continue;
    if (!lotesNome.includes(slice.lote)) lotesNome.push(slice.lote);
  }
  const loteUnico = lotesNome.length > 0 ? lotesNome.join(", ") : "-";

  if (tipo !== "Vasilhame" || slices.length < 2) {
    return [{ lote: loteUnico, volume, massa }];
  }

  const linhas = alignSlicesToVolume(slices, volume);
  if (linhas.length < 2) {
    return [{ lote: loteUnico, volume, massa }];
  }

  const massParts =
    massa != null
      ? distributeByWeights(
          massa,
          linhas.map((linha) => linha.quantidade_l)
        )
      : linhas.map(() => null);

  return linhas.map((linha, index) => ({
    lote: linha.lote || "-",
    volume: linha.quantidade_l,
    massa: massParts[index],
  }));
}

function buildOrigemRows(transbordo, { isotanques, entradas, produtoNome, unidade }) {
  const rows = [];
  for (const o of transbordo?.origens || []) {
    const origem = labelOrigemLinha(o, isotanques, entradas);
    const lotes = (o.lotes_retirados || []).filter((l) => (l.volume_retirado || 0) > 0);
    const produto = origemProdutoNome(o, produtoNome);
    const umOrigem = normalizeUnidadeEntrada(o.unidade_medida || unidade);
    const origemEmMassa = isUnidadeMassaEntrada(umOrigem);
    const dens = parseDensidade(transbordo?.densidade);

    if (lotes.length > 1) {
      for (const l of lotes) {
        const vol = l.volume_retirado || 0;
        const massa = origemEmMassa ? vol : dens > 0 ? vol * dens : o.massa_retirada;
        rows.push({
          origem,
          produto,
          lote: l.lote || "-",
          volume: origemEmMassa
            ? volumeLitrosDisplay(vol, transbordo?.densidade, true)
            : formatVolume(vol, { empty: "-" }),
          massa: formatMass(massa, { empty: "-" }),
        });
      }
      continue;
    }

    const vol = o.volume_retirado || 0;
    const massa = origemEmMassa ? (o.massa_retirada ?? vol) : o.massa_retirada;
    rows.push({
      origem,
      produto,
      lote: o.lote || "-",
      volume: origemEmMassa
        ? volumeLitrosDisplay(vol, transbordo?.densidade, true)
        : formatVolume(vol, { empty: "-" }),
      massa: formatMass(massa, { empty: "-" }),
    });
  }
  return rows;
}

function buildDestinoRows(transbordo, { vasilhames, isMassa, isVolume }) {
  const origens = transbordo?.origens || [];
  const destinos = transbordo?.destinos || [];
  const densOperacao = parseDensidade(transbordo?.densidade);
  const destinoCompositions = calculateFIFOAllocation(
    expandOrigensForFifo(origens, densOperacao),
    destinos,
    densOperacao
  ).destinoCompositions;

  const rows = [];
  destinos.forEach((d, i) => {
    const tipo = d.tipo_embalagem || "";
    const tanque = isDestinoTanquePatio(tipo);
    const embalado = isDestinoEstoqueEmbalado(tipo);
    const qtdEmb =
      d.quantidade_embalagens != null && d.quantidade_embalagens !== ""
        ? formatQuantidade(Number(d.quantidade_embalagens) || 0, { empty: "" })
        : null;
    const linhas = buildDestinoLinhas(d, destinoCompositions[i], densOperacao, isMassa);
    const lacre = lacreDoDestino(d, transbordo, vasilhames);
    linhas.forEach((linha, groupIndex) => {
      rows.push({
        embalagem: tanque ? embalagemDestinoLabel(d) : "-",
        lote: linha.lote || "-",
        qtd: embalado ? (qtdEmb != null ? String(qtdEmb) : "-") : "-",
        volume: isVolume
          ? formatVolume(linha.volume, { empty: "-" })
          : volumeLitrosDisplay(linha.volume, densOperacao, isMassa),
        massa: formatMass(linha.massa, { empty: "-" }),
        lacre,
        groupId: i,
        groupIndex,
        groupSize: linhas.length,
      });
    });
  });
  return rows;
}

export function transbordoPdfFileName(codigo) {
  const safe = String(codigo || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe || "Transbordo"}.pdf`;
}

/** Mesmos dados e formatação do modal de visualização do transbordo. */
export function buildTransbordoViewModel({
  transbordo,
  produtos = [],
  entradas = [],
  isotanques = [],
  vasilhames = [],
} = {}) {
  if (!transbordo) return null;

  const produtoNome = transbordo.produto_nome || "";
  const unidade = resolveUnidadeTransbordo(transbordo, produtos, entradas);
  const unidadeLabel = labelUnidade(unidade);
  const isMassa = isUnidadeMassaEntrada(unidade);
  const isVolume = isUnidadeVolumeEntrada(unidade);
  const destinos = transbordo.destinos || [];
  const formatQtyOperacional = (valor) =>
    isMassa ? formatMass(valor, { empty: "-" }) : formatVolume(valor, { empty: "-" });
  const totaisResolvidos = resolveVolumeMassaOperacional({
    volume: isVolume ? transbordo.volume_total : 0,
    massa:
      transbordo.massa_total ??
      (isMassa ? transbordo.volume_total : 0) ??
      0,
    densidade: transbordo.densidade,
  });

  const codigo = String(transbordo.codigo_transbordo || "").trim();

  return {
    codigo,
    fileName: transbordoPdfFileName(codigo),
    data: formatDate(transbordo.data),
    produto: `${transbordo.produto_codigo || ""} - ${produtoNome}`,
    produtoNome: produtoNome || "-",
    cliente: transbordo.cliente_nome || "-",
    densidade: resolveDensidadeDisplay(transbordo, produtos, entradas),
    operadores: transbordo.operadores || [],
    observacoes: transbordo.observacoes || "",
    showEmbalagem: destinos.some((d) => isDestinoTanquePatio(d.tipo_embalagem)),
    showQtd: destinos.some((d) => isDestinoEstoqueEmbalado(d.tipo_embalagem)),
    isMassa,
    isVolume,
    unidadeLabel,
    origemRows: buildOrigemRows(transbordo, {
      isotanques,
      entradas,
      produtoNome,
      unidade,
    }),
    destinoRows: buildDestinoRows(transbordo, { vasilhames, isMassa, isVolume }),
    volumeTotal: isVolume
      ? `${formatVolume(transbordo.volume_total, { empty: "-" })} L`
      : isMassa
        ? volumeLitrosDisplay(
            transbordo.massa_total ?? transbordo.volume_total,
            transbordo.densidade,
            true
          )
        : totaisResolvidos.volume > 0
          ? `${formatVolume(totaisResolvidos.volume, { empty: "-" })} L`
          : "-",
    massaCaption: isMassa ? "Quantidade Total" : "Massa Total",
    massaTotal: isMassa
      ? `${formatQtyOperacional(transbordo.massa_total ?? transbordo.volume_total)} ${unidadeLabel}`
      : `${formatMass(
          totaisResolvidos.massa || transbordo.massa_total,
          { empty: "-" }
        )} kg`,
  };
}
