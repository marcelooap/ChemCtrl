import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowLeft, Printer } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import {
  A4Sheet,
  A4Viewer,
  ReportBadge,
  ReportFooter,
  ReportHeader,
  ReportInfoGrid,
  ReportNote,
  ReportSection,
  ReportSignatures,
  ReportTable,
} from "@shared/components/report/A4Document";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import { resumoQuantidadeValidacao } from "@transbordo/lib/validacaoTransbordo";
import { toValidacaoViewModel } from "@industrializacao/lib/validacaoIndustrializacao";
import {
  formatDensidade,
  formatMass,
  formatNum,
  litrosFromMassaKg,
  massaKgFromLitrosOperacionais,
  parseDensidade,
  roundMass,
  roundVolume,
} from "@transbordo/lib/format";
import {
  getLoteQuantidadeDeclarada,
  getQuantidadeNotaFiscal,
  kgToLoteUnidade,
  loteToKg,
} from "@transbordo/lib/conversao";
import { normalizeUnidadeEntrada } from "@transbordo/lib/estoqueSaldo";
import { isOrigemEmbaladoMassa } from "@transbordo/lib/vasilhameComposicao";
import {
  isDestinoEstoqueEmbalado,
  isVasilhameLegadoEmbalado,
  labelTipoEmbalagem,
} from "@transbordo/lib/tiposEmbalagem";
import {
  OPERACAO,
  OPERACAO_LABEL_KEY,
  ORIGEM_FLUXO,
  resolveOperacao,
} from "@painel/lib/quitacaoOt";
import { resolveBackNav } from "@painel/lib/ordemTransbordoRelatorioNav";

const LOGO_SRC = "/icons/chemctrl-logo.svg";

const ORIGEM_TIPO_LABEL_KEYS = {
  entrada: "transbordo.validacao.origemTipo.granel",
  granel: "transbordo.validacao.origemTipo.granel",
  tanka: "transbordo.validacao.origemTipo.tanka",
  vasilhame: "transbordo.validacao.origemTipo.vasilhame",
  embalado: "transbordo.validacao.origemTipo.embalado",
};

const DASH = "-";

function asPayloadObject(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === "object" && parsed != null ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

function fmtDate(value) {
  if (!value) return DASH;
  const raw = String(value);
  const iso = raw.length === 10 ? `${raw}T00:00:00` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("pt-BR");
}

function fmtDateTime(value) {
  if (!value) return DASH;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function isMassaUnidade(unidade) {
  const u = String(unidade || "").toLowerCase();
  return u === "kg" || u === "lb";
}

function orDash(value) {
  const text = typeof value === "string" ? value.trim() : value;
  return text || text === 0 ? text : DASH;
}

function volumeOrDash(value) {
  const n = Number(value) || 0;
  return n > 0 ? `${formatNum(n, 2)} L` : DASH;
}

function massaOrDash(value, unidade = "kg") {
  const n = Number(value) || 0;
  return n > 0 ? `${formatMass(n)} ${unidade}` : DASH;
}

/**
 * Massa exibida na origem embalada: recupera o saldo inteiro perdido no
 * round-trip kg→L→kg (1.000 kg @ 1,09 → 917 L → 999,53 kg).
 */
function origemMassaExibida(origem, dens) {
  const raw =
    Number(origem?.massa_retirada) || Number(origem?.volume_retirado) || 0;
  if (!(raw > 0)) return 0;
  const densN = parseDensidade(dens);
  if (!(densN > 0)) return raw;
  const litros = litrosFromMassaKg(raw, densN);
  return massaKgFromLitrosOperacionais(litros, densN, raw);
}

/**
 * Destino com origem embalada em kg/lb persiste volume_* na UOM de massa.
 * Ex.: volume_total=6125 + peso_liquido=6125 + dens=1,25 → 4.900 L.
 */
function destinoVolumeOperacionalL(destino, origens = [], dens) {
  const raw = Number(destino?.volume_total ?? destino?.volume) || 0;
  if (!(raw > 0)) return 0;

  const densN = parseDensidade(dens);
  const massa = Number(destino?.peso_liquido) || 0;
  const list = Array.isArray(origens) ? origens : [];
  const origemLinked = list.find(
    (o) => o?._uid && o._uid === destino?.origem_uid
  );
  const origemEmbaladoMassa =
    (origemLinked && isOrigemEmbaladoMassa(origemLinked)) ||
    list.some(isOrigemEmbaladoMassa);

  let volumeEmMassa = origemEmbaladoMassa;
  if (!volumeEmMassa && densN > 0 && massa > 0) {
    const tol = Math.max(1, Math.abs(massa) * 0.02);
    const asLitros = Math.abs(raw * densN - massa) <= tol;
    const asMassa = Math.abs(raw - massa) <= tol;
    volumeEmMassa = asMassa && !asLitros;
  }

  if (!volumeEmMassa || !(densN > 0)) {
    return roundVolume(raw);
  }

  if (massa > 0) {
    return roundVolume(litrosFromMassaKg(massa, densN));
  }

  const um = normalizeUnidadeEntrada(
    origemLinked?.unidade_medida ||
      list.find(isOrigemEmbaladoMassa)?.unidade_medida ||
      "kg"
  );
  const kg = um === "lb" ? roundMass(raw * 0.453592) : roundMass(raw);
  return roundVolume(litrosFromMassaKg(kg, densN));
}

const GRANEL_TIPOS = new Set(["entrada", "granel"]);

/**
 * Identificação da origem.
 * Para granel o tipo já aparece na coluna ao lado — basta a NF-e.
 */
function origemIdentificacao(origem, granel) {
  const codigo = String(origem?.entrada_codigo || "").trim();

  if (GRANEL_TIPOS.has(String(origem?.tipo_origem || "").toLowerCase())) {
    const nf =
      String(granel?.nota_fiscal || "").trim() ||
      (codigo.match(/NF-?e?\s*[:nº]*\s*([\w./-]+)/i)?.[1] ?? "");
    return nf ? `NF-e ${nf}` : DASH;
  }

  // Rótulos de tanka/vasilhame vêm como "TANKA 34 - PRODUTO (20.805 L)";
  // produto e volume já têm colunas próprias, então basta o código.
  const semVolume = codigo.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const sep = semVolume.indexOf(" - ");
  return orDash(sep > 0 ? semVolume.slice(0, sep).trim() : semVolume);
}

/** Classifica o destino para escolher o layout de colunas da tabela. */
function classifyDestinoKind(destino) {
  const tipo = String(destino?.tipo_embalagem || "");
  const tipoLower = tipo.toLowerCase();

  if (tipoLower === "vasilhame") return "vasilhame";
  if (tipoLower === "tankagem") return "tankagem";
  if (isDestinoEstoqueEmbalado(tipo) || isVasilhameLegadoEmbalado(tipo)) {
    return "embalado";
  }
  if (destino?.tanka_id || destino?.tanka_codigo) return "tankagem";
  // Fallback: envase em tanque (placa/barril) sem tanka.
  if (destino?.placa || destino?.barril) return "vasilhame";
  return "vasilhame";
}

function destinoGroupKey(destino) {
  const tipo = String(destino?.tipo_embalagem || "").trim();
  if (tipo) return tipo;
  return classifyDestinoKind(destino);
}

function formatLacres(value) {
  if (Array.isArray(value)) {
    const list = value.map((v) => String(v || "").trim()).filter(Boolean);
    return list.length > 0 ? list.join(", ") : DASH;
  }
  return orDash(value);
}

/** Placa e barril em uma célula: "PLACA (BARRIL)", ou só o que existir. */
function formatPlacaBarril(placa, barril) {
  const p = String(placa || "").trim();
  const b = String(barril || "").trim();
  if (p && b) return `${p} (${b})`;
  if (p) return p;
  if (b) return b;
  return DASH;
}

function firstLoteGranel(granel) {
  if (Array.isArray(granel?.lotes) && granel.lotes.length > 0) {
    return granel.lotes[0];
  }
  return granel || null;
}

/** Quantidade da NF informada na Nova Ordem (não o peso líquido ajustado). */
function qtdNotaFromGranel(granel) {
  if (!granel) return null;
  const lote = firstLoteGranel(granel);
  const lotesCount = Array.isArray(granel.lotes) ? granel.lotes.length : 1;
  const quantidade =
    Number(getLoteQuantidadeDeclarada(lote)) ||
    Number(getQuantidadeNotaFiscal(lote, granel, { lotesCount })) ||
    0;
  // UOM do lote (formulário); o header do payload granel é sempre kg.
  const unidade = String(lote?.unidade_medida || "").trim() || "kg";
  if (!(quantidade > 0)) return null;
  return { quantidade, unidade };
}

/**
 * Diferença pesagem × NF quando fora da margem.
 * Positivo = peso líquido maior que a NF; negativo = menor.
 */
function diferencaPesagemGranel(granel) {
  if (!granel || granel.granel_margem !== "fora") return null;

  const pesoLiquido = Number(granel.granel_peso_liquido) || 0;
  if (!(pesoLiquido > 0)) return null;

  const lote = firstLoteGranel(granel);
  const qtdNota = qtdNotaFromGranel(granel);
  if (!qtdNota) return null;

  const densidade = lote?.densidade || granel.densidade || "";
  const unidade = qtdNota.unidade || "kg";
  const qtdNotaKg = loteToKg({
    quantidade: qtdNota.quantidade,
    unidade_medida: unidade,
    densidade,
    tipo_recebimento: "granel",
  });
  const difKg = pesoLiquido - qtdNotaKg;
  if (!Number.isFinite(difKg) || Math.abs(difKg) < 0.5) return null;

  const qtdRealUnidade = kgToLoteUnidade(pesoLiquido, unidade, densidade);
  const difUnidade = qtdRealUnidade - qtdNota.quantidade;
  const sign = difKg > 0 ? "+" : "";
  const um = String(unidade).toLowerCase();

  const texto =
    um === "kg" || um === "kgs"
      ? `${sign}${formatMass(difKg)} kg`
      : `${sign}${formatNum(difUnidade, 2)} ${unidade} (${sign}${formatMass(difKg)} kg)`;

  return { difKg, difUnidade, texto };
}

function colItem(t) {
  return {
    key: "item",
    label: t("painel.operacional.ordemTransbordo.relatorio.columns.item"),
    align: "center",
    width: "7%",
    nowrap: true,
  };
}

function columnsForDestinoKind(kind, t) {
  if (kind === "vasilhame") {
    return [
      colItem(t),
      {
        key: "placaBarril",
        label: t(
          "painel.operacional.ordemTransbordo.relatorio.columns.placaBarril"
        ),
        width: "22%",
        nowrap: true,
      },
      {
        key: "volume",
        label: t("painel.operacional.ordemTransbordo.relatorio.columns.volume"),
        align: "right",
        width: "16%",
        nowrap: true,
      },
      {
        key: "peso",
        label: t(
          "painel.operacional.ordemTransbordo.relatorio.columns.pesoLiquido"
        ),
        align: "right",
        width: "14%",
        nowrap: true,
      },
      {
        key: "eslinga",
        label: t("painel.operacional.ordemTransbordo.relatorio.columns.eslinga"),
        width: "14%",
        nowrap: true,
      },
      {
        key: "lacres",
        label: t("painel.operacional.ordemTransbordo.relatorio.columns.lacres"),
        width: "27%",
        nowrap: true,
      },
    ];
  }

  if (kind === "tankagem") {
    return [
      colItem(t),
      {
        key: "identificacao",
        label: t(
          "painel.operacional.ordemTransbordo.relatorio.columns.identificacao"
        ),
        width: "40%",
      },
      {
        key: "volume",
        label: t("painel.operacional.ordemTransbordo.relatorio.columns.volume"),
        align: "right",
        width: "26%",
        nowrap: true,
      },
      {
        key: "peso",
        label: t(
          "painel.operacional.ordemTransbordo.relatorio.columns.pesoLiquido"
        ),
        align: "right",
        width: "27%",
        nowrap: true,
      },
    ];
  }

  // IBC / Bombona / Tambor / demais embalados unitários
  return [
    colItem(t),
    {
      key: "quantidade",
      label: t(
        "painel.operacional.ordemTransbordo.relatorio.columns.quantidadeEmbalagens"
      ),
      align: "right",
      width: "22%",
      nowrap: true,
    },
    {
      key: "volume",
      label: t("painel.operacional.ordemTransbordo.relatorio.columns.volume"),
      align: "right",
      width: "35%",
      nowrap: true,
    },
    {
      key: "peso",
      label: t(
        "painel.operacional.ordemTransbordo.relatorio.columns.pesoLiquido"
      ),
      align: "right",
      width: "36%",
      nowrap: true,
    },
  ];
}

function buildDestinoRow(item, index, kind, t, { origens = [], densidade } = {}) {
  const volL = destinoVolumeOperacionalL(item, origens, densidade);
  const volumeText = volumeOrDash(volL);
  const fracionado = kind === "vasilhame" && item?.fracionado === true;

  return {
    __key: `${item?.origem_uid || "destino"}-${index}`,
    item: String(index + 1).padStart(2, "0"),
    identificacao: orDash(item?.tanka_codigo),
    placaBarril: formatPlacaBarril(item?.placa, item?.barril),
    quantidade:
      Number(item?.quantidade_embalagens) > 0
        ? formatNum(Number(item.quantidade_embalagens))
        : DASH,
    volume: fracionado ? (
      <div className="a4-cell-stack">
        <span>{volumeText}</span>
        <ReportBadge variant="neutral">
          {t("painel.operacional.ordemTransbordo.relatorio.fracionado")}
        </ReportBadge>
      </div>
    ) : (
      volumeText
    ),
    peso: massaOrDash(item?.peso_liquido),
    eslinga: orDash(item?.eslinga),
    lacres: formatLacres(item?.lacres),
  };
}

/**
 * Agrupa destinos por tipo de embalagem, preservando a ordem de aparição.
 * Cada grupo vira uma tabela com colunas adequadas ao tipo.
 */
function groupDestinosByTipo(destinos, t, { origens = [], densidade } = {}) {
  const groups = [];
  const indexByKey = new Map();

  destinos.forEach((destino) => {
    const key = destinoGroupKey(destino);
    const kind = classifyDestinoKind(destino);
    let group = indexByKey.has(key) ? groups[indexByKey.get(key)] : null;

    if (!group) {
      const tipo = String(destino?.tipo_embalagem || "").trim();
      const label =
        labelTipoEmbalagem(tipo) ||
        t(`painel.operacional.ordemTransbordo.relatorio.destinoTipos.${kind}`);

      group = {
        key,
        kind,
        label,
        columns: columnsForDestinoKind(kind, t),
        rows: [],
      };
      indexByKey.set(key, groups.length);
      groups.push(group);
    }

    group.rows.push(
      buildDestinoRow(destino, group.rows.length, group.kind, t, {
        origens,
        densidade,
      })
    );
  });

  return groups;
}

/** Lotes envolvidos na operação, sem repetição, na ordem em que aparecem. */
function coletarLotes(validacao, origens, granel = null) {
  const lotes = [];
  const push = (value) => {
    const lote = String(value || "").trim();
    if (lote && !lotes.includes(lote)) lotes.push(lote);
  };

  origens.forEach((origem) => {
    const retirados = Array.isArray(origem?.lotes_retirados)
      ? origem.lotes_retirados
      : [];
    if (retirados.length > 0) {
      retirados
        .filter((item) => Number(item?.volume_retirado) > 0)
        .forEach((item) => push(item?.lote));
    }
    push(origem?.lote);
  });

  const granelLotes = Array.isArray(granel?.lotes) ? granel.lotes : [];
  granelLotes.forEach((lote) => push(lote?.lote));
  push(granel?.lote);
  push(validacao?.lote);

  return lotes;
}

/** Nº do documento estável e legível, usado no cabeçalho e no rodapé. */
function buildDocumentId(validacao) {
  const numero = String(validacao?.numero ?? "").padStart(4, "0");
  return `OT-${numero || "0000"}`;
}

/**
 * Flag `filtrado` do cadastro — mesma base usada na coluna Operação da Quitação OT
 * para distinguir Filtração de Convencional.
 */
async function resolveProdutoFiltrado(record) {
  const produtoId = record?.produto_id;
  const produtoCodigo = String(record?.produto_codigo || "").trim();
  try {
    if (produtoId != null && produtoId !== "") {
      const row = await entities.produtos.get(produtoId);
      if (row) return Boolean(row.filtrado);
    }
    if (produtoCodigo) {
      const rows = await entities.produtos.filter({ codigo: produtoCodigo });
      if (Array.isArray(rows) && rows[0]) return Boolean(rows[0].filtrado);
    }
  } catch {
    /* cadastro indisponível: assume não filtrado (Convencional) */
  }
  return false;
}

/**
 * Classifica a OT com a mesma regra da Quitação OT (coluna Operação).
 * Convencional (ChemFlow) → transbordo; Industrialização (Ind) → transbordo_ind.
 */
function resolveOperacaoRelatorio({ destino, origens, produtoFiltrado }) {
  const origemFluxo =
    destino === "industrializacao"
      ? ORIGEM_FLUXO.TRANSBORDO_IND
      : ORIGEM_FLUXO.TRANSBORDO;
  return resolveOperacao({
    origem_fluxo: origemFluxo,
    origens,
    produto_filtrado: Boolean(produtoFiltrado),
  });
}

export default function OrdemTransbordoRelatorio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { destino, id } = useParams();
  const backNav = useMemo(() => resolveBackNav(location), [location]);

  const [validacao, setValidacao] = useState(null);
  const [produtoFiltrado, setProdutoFiltrado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [emissao] = useState(() => new Date());

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setProdutoFiltrado(false);
      try {
        const record =
          destino === "industrializacao"
            ? toValidacaoViewModel(await base44.entities.IndValidacao.get(id))
            : await entities.transbordoValidacoes.get(id);
        if (!active) return;
        if (!record) {
          setError(t("painel.operacional.ordemTransbordo.relatorio.notFound"));
          setValidacao(null);
          return;
        }
        setValidacao(record);
        // Filtração só se aplica a OTs ChemFlow (Quitação OT / resolveOperacao).
        if (destino !== "industrializacao") {
          const filtrado = await resolveProdutoFiltrado(record);
          if (active) setProdutoFiltrado(filtrado);
        }
      } catch (err) {
        console.error("[OrdemTransbordoRelatorio] load:", err);
        if (active) {
          setError(t("painel.operacional.ordemTransbordo.relatorio.loadError"));
          setValidacao(null);
          setProdutoFiltrado(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [destino, id, t]);

  const handleBack = useCallback(
    () => navigate(backNav.path),
    [backNav.path, navigate]
  );
  const backLabel = t(backNav.labelKey);
  const handlePrint = useCallback(() => window.print(), []);

  const transbordo =
    asPayloadObject(validacao?.transbordo_payload) ||
    validacao?.transbordo_payload ||
    null;
  const granel =
    asPayloadObject(validacao?.granel_payload) ||
    asPayloadObject(validacao?.entrada_payload) ||
    validacao?.granel_payload ||
    null;

  const origens = useMemo(
    () => (Array.isArray(transbordo?.origens) ? transbordo.origens : []),
    [transbordo]
  );
  const destinos = useMemo(
    () => (Array.isArray(transbordo?.destinos) ? transbordo.destinos : []),
    [transbordo]
  );

  const resumo = useMemo(
    () => (validacao ? resumoQuantidadeValidacao(validacao) : null),
    [validacao]
  );

  const origemTipoLabel = useCallback(
    (tipo) => {
      const key = ORIGEM_TIPO_LABEL_KEYS[String(tipo || "").toLowerCase()];
      return key ? t(key) : orDash(tipo);
    },
    [t]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !validacao) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">
            {error || t("painel.operacional.ordemTransbordo.relatorio.notFound")}
          </span>
        </div>
        <Button variant="outline" onClick={handleBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Button>
      </div>
    );
  }

  const documentId = buildDocumentId(validacao);
  const densidade = transbordo?.densidade || granel?.densidade || "";
  const lotes = coletarLotes(validacao, origens, granel);
  const qtdNota = qtdNotaFromGranel(granel);
  const diferencaGranel = diferencaPesagemGranel(granel);
  const observacoes = String(transbordo?.observacoes || "").trim();

  // Granel mantém Lote; tanka / IBC / bombona / tambor (e vasilhame) → Observação.
  const temOrigemGranel =
    Boolean(granel) ||
    origens.some((o) =>
      GRANEL_TIPOS.has(String(o?.tipo_origem || "").toLowerCase())
    );

  const quantidadeGeral = granel
    ? qtdNota && qtdNota.quantidade > 0
      ? `${formatNum(qtdNota.quantidade, 2)} ${qtdNota.unidade || ""}`.trim()
      : DASH
    : resumo && resumo.quantidade > 0
      ? `${formatNum(resumo.quantidade, 2)} ${resumo.unidade_medida || ""}`.trim()
      : DASH;

  const infoItems = [
    {
      label: t("painel.operacional.ordemTransbordo.fields.date"),
      value: fmtDate(validacao.data),
    },
    {
      label: t("painel.operacional.ordemTransbordo.fields.product"),
      value:
        [validacao.produto_codigo, validacao.produto_nome]
          .filter(Boolean)
          .join(" - ") || DASH,
    },
    {
      label: t("painel.operacional.ordemTransbordo.fields.client"),
      value: orDash(validacao.cliente_nome),
    },
    temOrigemGranel
      ? {
          label: t("painel.operacional.ordemTransbordo.fields.lot"),
          value: lotes.length > 0 ? lotes.join(" - ") : DASH,
        }
      : {
          label: t("painel.operacional.ordemTransbordo.fields.observation"),
          value: observacoes || DASH,
        },
    {
      label: granel
        ? t("painel.operacional.ordemTransbordo.relatorio.fields.qtdNota")
        : t("painel.operacional.ordemTransbordo.fields.qty"),
      value: quantidadeGeral,
    },
    {
      label: t("painel.operacional.ordemTransbordo.fields.density"),
      value: densidade ? formatDensidade(densidade) : DASH,
    },
  ];

  const granelItems = granel
    ? [
        {
          label: t("transbordo.validacao.fields.notaFiscal"),
          value: orDash(granel.nota_fiscal),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.supplier"),
          value: orDash(granel.fornecedor || granel.lotes?.[0]?.fornecedor),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.manufacture"),
          value: fmtDate(granel.data_fabricacao || granel.lotes?.[0]?.data_fabricacao),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.expiry"),
          value: fmtDate(granel.data_validade || granel.lotes?.[0]?.data_validade),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.ticket"),
          value: orDash(granel.granel_ticket),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.gross"),
          value: massaOrDash(granel.granel_peso_bruto),
        },
        {
          label: t("painel.operacional.ordemTransbordo.fields.net"),
          value: massaOrDash(granel.granel_peso_liquido),
        },
        {
          label: t("transbordo.validacao.fields.precoUnitario"),
          value: granel.preco_unitario
            ? `R$ ${formatNum(Number(granel.preco_unitario), 4)}`
            : DASH,
        },
        {
          label: t("transbordo.validacao.fields.margem"),
          value: granel.granel_margem ? (
            <ReportBadge
              variant={granel.granel_margem === "dentro" ? "success" : "danger"}
            >
              {t(
                granel.granel_margem === "dentro"
                  ? "painel.operacional.ordemTransbordo.relatorio.margem.dentro"
                  : "painel.operacional.ordemTransbordo.relatorio.margem.fora"
              )}
            </ReportBadge>
          ) : (
            DASH
          ),
        },
        ...(diferencaGranel
          ? [
              {
                label: t(
                  "painel.operacional.ordemTransbordo.relatorio.fields.diferenca"
                ),
                value: (
                  <span
                    className={
                      diferencaGranel.difKg < 0
                        ? "a4-diff a4-diff--neg"
                        : "a4-diff a4-diff--pos"
                    }
                  >
                    {diferencaGranel.texto}
                  </span>
                ),
              },
            ]
          : []),
      ]
    : [];

  const origemRows = origens.map((origem, index) => {
    const embalado =
      origem?.tipo_origem === "embalado" || Boolean(origem?.embalado);
    const unidade = origem?.unidade_medida;
    return {
      __key: origem?._uid || `origem-${index}`,
      item: String(index + 1).padStart(2, "0"),
      tipo: origemTipoLabel(origem?.tipo_origem),
      identificacao: origemIdentificacao(origem, granel),
      produto: orDash(origem?.produto_nome || validacao.produto_nome),
      lote: orDash(origem?.lote),
      volume:
        embalado && isMassaUnidade(unidade)
          ? massaOrDash(
              origemMassaExibida(origem, densidade),
              String(unidade).toLowerCase()
            )
          : volumeOrDash(origem?.volume_retirado),
    };
  });

  const destinoGroups = groupDestinosByTipo(destinos, t, {
    origens,
    densidade:
      transbordo?.densidade ||
      granel?.densidade ||
      granel?.lotes?.[0]?.densidade ||
      densidade ||
      "",
  });

  const operacao = resolveOperacaoRelatorio({
    destino,
    origens,
    produtoFiltrado,
  });
  const operacaoLabel = t(
    OPERACAO_LABEL_KEY[operacao] || OPERACAO_LABEL_KEY[OPERACAO.CONVENCIONAL]
  );
  const reportTitle = `${t(
    "painel.operacional.ordemTransbordo.relatorio.title"
  )} — ${operacaoLabel}`;

  return (
    <A4Viewer
      toolbar={
        <>
          <Button variant="outline" onClick={handleBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("painel.operacional.ordemTransbordo.relatorio.viewerHint")}
          </span>
          <Button onClick={handlePrint} className="gap-2 bg-primary hover:bg-primary/90">
            <Printer className="w-4 h-4" />
            {t("painel.operacional.ordemTransbordo.relatorio.print")}
          </Button>
        </>
      }
    >
      <A4Sheet>
        <ReportHeader
          organization={t("painel.operacional.ordemTransbordo.relatorio.organization")}
          title={reportTitle}
          subtitle={t("painel.operacional.ordemTransbordo.relatorio.subtitle", {
            data: fmtDateTime(emissao),
          })}
          logoSrc={LOGO_SRC}
        />

        <ReportSection
          title={t("painel.operacional.ordemTransbordo.relatorio.sections.geral")}
        >
          <ReportInfoGrid items={infoItems} columns={3} />
        </ReportSection>

        {granelItems.length > 0 && (
          <ReportSection
            title={t("painel.operacional.ordemTransbordo.relatorio.sections.granel")}
          >
            <ReportInfoGrid items={granelItems} columns={6} centered />
          </ReportSection>
        )}

        {origemRows.length > 0 && (
          <ReportSection
            title={t("painel.operacional.ordemTransbordo.relatorio.sections.origens")}
          >
            <ReportTable
              columns={[
                {
                  key: "item",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.item"),
                  align: "center",
                  width: "7%",
                  nowrap: true,
                },
                {
                  key: "tipo",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.tipo"),
                  width: "12%",
                  nowrap: true,
                },
                {
                  key: "identificacao",
                  label: t(
                    "painel.operacional.ordemTransbordo.relatorio.columns.identificacao"
                  ),
                  width: "31%",
                },
                {
                  key: "produto",
                  label: t("painel.operacional.ordemTransbordo.fields.product"),
                  width: "18%",
                },
                {
                  key: "lote",
                  label: t("painel.operacional.ordemTransbordo.fields.lot"),
                  width: "16%",
                  nowrap: true,
                },
                {
                  key: "volume",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.volume"),
                  align: "right",
                  width: "16%",
                  nowrap: true,
                },
              ]}
              rows={origemRows}
            />
          </ReportSection>
        )}

        {destinoGroups.length > 0 && (
          <ReportSection
            title={t("painel.operacional.ordemTransbordo.relatorio.sections.destinos")}
          >
            {destinoGroups.map((group) => (
              <div key={group.key} className="a4-table-group">
                {destinoGroups.length > 1 ? (
                  <h3 className="a4-table-caption">{group.label}</h3>
                ) : null}
                <ReportTable columns={group.columns} rows={group.rows} />
              </div>
            ))}
          </ReportSection>
        )}

        {/* Em tanka/embalado a observação já aparece em Informações gerais. */}
        {observacoes && temOrigemGranel && (
          <ReportSection
            title={t("painel.operacional.ordemTransbordo.relatorio.sections.observacoes")}
          >
            <ReportNote>{observacoes}</ReportNote>
          </ReportSection>
        )}

        <ReportSignatures
          signatures={[
            {
              role: t("painel.operacional.ordemTransbordo.relatorio.signatures.emitente"),
              name: orDash(validacao.criado_por_nome),
            },
          ]}
        />

        <ReportFooter
          left={t("pdf.footer")}
          right={t("painel.operacional.ordemTransbordo.relatorio.footerDoc", {
            numero: documentId,
            data: fmtDateTime(validacao.created_at),
          })}
        />
      </A4Sheet>
    </A4Viewer>
  );
}
