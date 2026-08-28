import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { formatDensidade, formatMass, formatNum } from "@transbordo/lib/format";

const BASE_PATH = "/painel/operacional/ordem-transbordo";
const LOGO_SRC = "/icons/chemctrl-logo.svg";

const ORIGEM_TIPO_LABEL_KEYS = {
  entrada: "transbordo.validacao.origemTipo.granel",
  granel: "transbordo.validacao.origemTipo.granel",
  tanka: "transbordo.validacao.origemTipo.tanka",
  vasilhame: "transbordo.validacao.origemTipo.vasilhame",
  embalado: "transbordo.validacao.origemTipo.embalado",
};

const DASH = "-";

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

const GRANEL_TIPOS = new Set(["entrada", "granel"]);

/**
 * Identificação da origem.
 * Para granel o `entrada_codigo` traz produto e lote concatenados — dados já
 * exibidos em colunas próprias —, então basta a nota fiscal.
 */
function origemIdentificacao(origem, granel) {
  const codigo = String(origem?.entrada_codigo || "").trim();

  if (GRANEL_TIPOS.has(String(origem?.tipo_origem || "").toLowerCase())) {
    const nf =
      String(granel?.nota_fiscal || "").trim() ||
      (codigo.match(/NF-?e?\s*[:nº]*\s*([\w./-]+)/i)?.[1] ?? "");
    return nf ? `GRANEL (NF-e ${nf})` : "GRANEL";
  }

  // Rótulos de tanka/vasilhame vêm como "TANKA 34 - PRODUTO (20.805 L)";
  // produto e volume já têm colunas próprias, então basta o código.
  const semVolume = codigo.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const sep = semVolume.indexOf(" - ");
  return orDash(sep > 0 ? semVolume.slice(0, sep).trim() : semVolume);
}

/** Lotes envolvidos na operação, sem repetição, na ordem em que aparecem. */
function coletarLotes(validacao, origens) {
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
  push(validacao?.lote);

  return lotes;
}

/** Nº do documento estável e legível, usado no cabeçalho e no rodapé. */
function buildDocumentId(validacao) {
  const numero = String(validacao?.numero ?? "").padStart(4, "0");
  return `OT-${numero || "0000"}`;
}

export default function OrdemTransbordoRelatorio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { destino, id } = useParams();

  const [validacao, setValidacao] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [emissao] = useState(() => new Date());

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
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
      } catch (err) {
        console.error("[OrdemTransbordoRelatorio] load:", err);
        if (active) {
          setError(t("painel.operacional.ordemTransbordo.relatorio.loadError"));
          setValidacao(null);
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

  const handleBack = useCallback(() => navigate(BASE_PATH), [navigate]);
  const handlePrint = useCallback(() => window.print(), []);

  const transbordo = validacao?.transbordo_payload || null;
  const granel = validacao?.granel_payload || null;

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
          {t("painel.operacional.ordemTransbordo.relatorio.back")}
        </Button>
      </div>
    );
  }

  const documentId = buildDocumentId(validacao);
  const densidade = transbordo?.densidade || granel?.densidade || "";
  const lotes = coletarLotes(validacao, origens);

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
    {
      label: t("painel.operacional.ordemTransbordo.fields.lot"),
      value: lotes.length > 0 ? lotes.join(" - ") : DASH,
    },
    {
      label: t("painel.operacional.ordemTransbordo.fields.qty"),
      value:
        resumo && resumo.quantidade > 0
          ? `${formatNum(resumo.quantidade, 2)} ${resumo.unidade_medida || ""}`.trim()
          : DASH,
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
          ? massaOrDash(origem?.massa_retirada, String(unidade).toLowerCase())
          : volumeOrDash(origem?.volume_retirado),
    };
  });

  const destinoRows = destinos.map((item, index) => ({
    __key: `${item?.origem_uid || "destino"}-${index}`,
    item: String(index + 1).padStart(2, "0"),
    identificacao: orDash(item?.tanka_codigo),
    placa: orDash(item?.placa),
    barril: orDash(item?.barril),
    quantidade:
      Number(item?.quantidade_embalagens) > 0
        ? formatNum(Number(item.quantidade_embalagens))
        : DASH,
    volume: volumeOrDash(item?.volume_total ?? item?.volume),
    peso: massaOrDash(item?.peso_liquido),
  }));

  const observacoes = String(transbordo?.observacoes || "").trim();

  return (
    <A4Viewer
      toolbar={
        <>
          <Button variant="outline" onClick={handleBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("painel.operacional.ordemTransbordo.relatorio.back")}
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
          title={`${t("painel.operacional.ordemTransbordo.relatorio.title")} - ${documentId}`}
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

        {destinoRows.length > 0 && (
          <ReportSection
            title={t("painel.operacional.ordemTransbordo.relatorio.sections.destinos")}
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
                  key: "identificacao",
                  label: t(
                    "painel.operacional.ordemTransbordo.relatorio.columns.identificacao"
                  ),
                  width: "23%",
                },
                {
                  key: "placa",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.placa"),
                  width: "14%",
                  nowrap: true,
                },
                {
                  key: "barril",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.barril"),
                  width: "14%",
                  nowrap: true,
                },
                {
                  key: "quantidade",
                  label: t(
                    "painel.operacional.ordemTransbordo.relatorio.columns.quantidadeEmbalagens"
                  ),
                  align: "right",
                  width: "12%",
                  nowrap: true,
                },
                {
                  key: "volume",
                  label: t("painel.operacional.ordemTransbordo.relatorio.columns.volume"),
                  align: "right",
                  width: "15%",
                  nowrap: true,
                },
                {
                  key: "peso",
                  label: t(
                    "painel.operacional.ordemTransbordo.relatorio.columns.pesoLiquido"
                  ),
                  align: "right",
                  width: "15%",
                  nowrap: true,
                },
              ]}
              rows={destinoRows}
            />
          </ReportSection>
        )}

        {observacoes && (
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
