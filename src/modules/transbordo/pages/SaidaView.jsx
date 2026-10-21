import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { useInternalAuth as useAuth } from '@/lib/InternalAuthContext';
import { ArrowLeft, FileDown } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import { Label } from "@shared/components/ui/label";
import { formatVolume, formatMass, formatNum } from "@transbordo/lib/format";
import {
  M,
  CW,
  BLUE_DARK,
  MUTED,
  BORDER,
  setColor,
  setDraw,
  drawMainHeader,
  addInfoCards,
  drawSectionTitle,
  drawSoftTable,
  paintFooter,
  ensurePdfSpace,
} from "@transbordo/lib/pdfReportLayout";
import { healLinkedLotes } from "@transbordo/lib/cascadeEntradaUpdate";
import {
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  tipoItemLabel,
  resolveItemOrigem,
  origemLabel,
} from "@transbordo/lib/saidaOrigem";

const EMPTY = "—";

function isUnidadeVolume(unidade) {
  const u = String(unidade || "").toLowerCase().trim();
  return u === "l" || u === "lt" || u === "litro" || u === "litros";
}

function formatQtdComUnidade(n, unidade, opts) {
  const um = unidade || "kg";
  const qtd = isUnidadeVolume(um)
    ? formatVolume(n, opts)
    : formatMass(n, opts);
  return `${qtd} ${um}`;
}

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

const formatDateTime = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("pt-BR");
};

function gerarSaidaPDF(saida) {
  import("jspdf").then(({ jsPDF }) => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const codigo = saida.codigo || "—";
    let y = drawMainHeader(doc, {
      title: "Solicitação de Saída",
      subtitle: `Nº ${codigo} · Transbordo · Controle Operacional`,
      badge: saida.codigo || "",
      footerCenter: `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    });

    y = addInfoCards(
      doc,
      y,
      [
        ["Cliente", saida.cliente_nome || "—", 2],
        ["Destino", saida.destino || "—", 2],
        ["Data da Solicitação", formatDate(saida.data_solicitacao)],
        ["Data Programada", formatDate(saida.data_programada)],
      ],
      2
    );

    y = drawSectionTitle(doc, y, "Produtos");
    const headers = [
      "Tipo",
      "Produto",
      "Lote",
      "Qtd. (kg)",
      "Peso Líq.",
      "Qtd. Emb.",
      "Tanque",
      "Vol. (L)",
      "Est. Antes",
      "Est. Depois",
    ];
    const rows = (saida.itens || []).map((item) => [
      tipoItemLabel(item),
      item.produto_nome || "—",
      item.lote || "—",
      formatMass(item.quantidade_solicitada, { empty: EMPTY }),
      formatMass(
        item.tipo === TIPO_EMBALADO ? item.peso_liquido_embalagem : item.peso_liquido,
        { empty: EMPTY }
      ),
      item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_VASILHAME
        ? formatNum(item.quantidade_embalagens, 1, { empty: EMPTY })
        : "—",
      item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
        ? item.vasilhame_placa || "—"
        : "—",
      item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
        ? formatVolume(item.volume_solicitado, { empty: EMPTY })
        : "—",
      item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP
        ? formatMass(item.estoque_atual, { empty: EMPTY })
        : formatVolume(item.volume_disponivel, { empty: EMPTY }),
      item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP
        ? formatMass(item.estoque_final, { empty: EMPTY })
        : formatVolume(item.saldo_final, { empty: EMPTY }),
    ]);
    y = drawSoftTable(doc, y, {
      headers,
      rows,
      widths: [20, 30, 18, 16, 16, 14, 18, 16, 18, 18],
      fontSize: 6.5,
      headerSize: 5.8,
      lineH: 3.1,
    });

    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, BLUE_DARK);
    doc.text(
      `QUANTIDADE TOTAL: ${formatMass(saida.quantidade_total, { empty: EMPTY })} kg`,
      M + CW,
      y,
      { align: "right" }
    );
    y += 8;

    if (saida.observacoes) {
      y = ensurePdfSpace(doc, y, 18);
      y = addInfoCards(doc, y, [["Observações", saida.observacoes, 2]], 2);
    }

    y = ensurePdfSpace(doc, y + 8, 16);
    const sigW = 70;
    const gap = CW - sigW * 2;
    setDraw(doc, BORDER);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + sigW, y);
    doc.line(M + sigW + gap, y, M + sigW * 2 + gap, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, MUTED);
    doc.text("Solicitante", M + sigW / 2, y + 4, { align: "center" });
    doc.text("Responsável", M + sigW + gap + sigW / 2, y + 4, { align: "center" });

    paintFooter(doc);
    doc.save(`saida-${saida.codigo || saida.id}.pdf`);
  });
}

function InfoItem({ label, value, highlight }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight || "text-foreground"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

const DEFAULT_BASE_PATH = "/chemflow/saida";

export default function SaidaView({ basePath = DEFAULT_BASE_PATH } = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saida, setSaida] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingFiscal, setUpdatingFiscal] = useState(false);
  const [entradas, setEntradas] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, ents, vascs] = await Promise.all([
          entities.saidas.get(id),
          entities.estoque.list(),
          entities.vasilhames.list(),
        ]);
        let saidaRow = s;
        let vasRows = vascs;
        try {
          const healed = await healLinkedLotes({
            estoqueRows: ents,
            vasilhames: vascs,
            saidas: s ? [s] : [],
          });
          saidaRow =
            (healed.saidas || []).find((row) => row.id === s?.id) || s;
          vasRows = healed.vasilhames || vascs;
        } catch (err) {
          console.error("[Transbordo] Falha ao alinhar lote da saída:", err);
        }
        setSaida(saidaRow);
        setEntradas(ents);
        setVasilhames(vasRows);
      } catch {
        setSaida(null);
      }
      setLoading(false);
    };
    load();
  }, [id]);

  const handleFiscalToggle = async (checked) => {
    setUpdatingFiscal(true);
    const updates = {
      enviado_ao_fiscal: checked,
      status: checked ? "enviado_fiscal" : "aguardando",
      enviado_fiscal_usuario: checked ? user?.nome || null : null,
      enviado_fiscal_data: checked ? new Date().toISOString() : null,
    };
    setSaida((prev) => ({ ...prev, ...updates }));

    try {
      const itens = saida.itens || [];
      const dataSaida = saida.data_programada || "";

      // ── Atualizar snapshots dos itens com o estoque real do momento ──
      const updatedItens = itens.map((item) => {
        if (item.tipo === "embalado" && item.entrada_id) {
          const e = entradas.find((e) => e.id === item.entrada_id);
          const estoqueAtual = e?.saldo_atual || 0;
          return {
            ...item,
            estoque_atual: estoqueAtual,
            estoque_final: estoqueAtual - (item.quantidade_solicitada || 0),
          };
        } else if (item.tipo === "convencional" && item.vasilhame_id) {
          const v = vasilhames.find((v) => v.id === item.vasilhame_id);
          const volDisponivel = v?.volume || 0;
          return {
            ...item,
            volume_disponivel: volDisponivel,
            saldo_final: volDisponivel - (item.volume_solicitado || 0),
          };
        }
        return item;
      });

      await entities.saidas.update(id, { ...updates, itens: updatedItens });

      // ── Embalado: dar baixa no estoque (item.entrada_id = estoque.id) ──
      const estoqueAdjustments = {};
      itens.forEach((item) => {
        if (item.tipo === "embalado" && item.entrada_id) {
          const qty = item.quantidade_solicitada || 0;
          estoqueAdjustments[item.entrada_id] =
            (estoqueAdjustments[item.entrada_id] || 0) + (checked ? -qty : qty);
        }
      });

      const estoqueUpdates = Object.entries(estoqueAdjustments).map(([eid, adj]) => {
        const e = entradas.find((e) => e.id === eid);
        return { id: eid, saldo_atual: Math.max(0, (e?.saldo_atual || 0) + adj) };
      });
      if (estoqueUpdates.length > 0) {
        await entities.estoque.bulkUpdate(estoqueUpdates);
        setEntradas((prev) =>
          prev.map((e) =>
            estoqueAdjustments[e.id]
              ? {
                  ...e,
                  saldo_atual: Math.max(
                    0,
                    (e.saldo_atual || 0) + estoqueAdjustments[e.id]
                  ),
                }
              : e
          )
        );
      }

      // ── Convencional: registrar saída dos vasilhames ──
      const vasilhameVolAdjustments = {};
      const vasilhameIds = [];
      itens.forEach((item) => {
        if (item.tipo === "convencional" && item.vasilhame_id) {
          const vol = item.volume_solicitado || 0;
          vasilhameVolAdjustments[item.vasilhame_id] =
            (vasilhameVolAdjustments[item.vasilhame_id] || 0) + (checked ? -vol : vol);
          vasilhameIds.push(item.vasilhame_id);
        }
      });

      const vasilhameUpdates = vasilhameIds.map((vid) => {
        const v = vasilhames.find((v) => v.id === vid);
        const volAdj = vasilhameVolAdjustments[vid] || 0;
        const originalVol = v?.volume || 0;
        const originalPesoLiq = v?.peso_liquido || 0;
        const densidade = originalVol > 0 ? originalPesoLiq / originalVol : 0;
        const newVol = originalVol + volAdj;
        return {
          id: vid,
          volume: newVol,
          peso_liquido: newVol * densidade,
          peso_bruto: (v?.tara || 0) + newVol * densidade,
          status: checked ? "Expedido" : "No Pátio",
          data_saida: checked ? dataSaida || null : null,
        };
      });

      if (vasilhameUpdates.length > 0) {
        await entities.vasilhames.bulkUpdate(vasilhameUpdates);
        setVasilhames((prev) =>
          prev.map((v) => {
            const upd = vasilhameUpdates.find((u) => u.id === v.id);
            return upd
              ? {
                  ...v,
                  status: upd.status,
                  data_saida: upd.data_saida,
                  volume: upd.volume,
                  peso_liquido: upd.peso_liquido,
                  peso_bruto: upd.peso_bruto,
                }
              : v;
          })
        );
      }
    } catch {
      setSaida((prev) => ({
        ...prev,
        enviado_ao_fiscal: !checked,
        status: !checked ? "enviado_fiscal" : "aguardando",
      }));
    }
    setUpdatingFiscal(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!saida) {
    return (
      <div className="h-full min-h-0 overflow-y-auto space-y-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(basePath)}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <p className="text-center text-muted-foreground py-12">Saída não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(basePath)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Saída {saida.codigo || ""}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {saida.cliente_nome || "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => gerarSaidaPDF(saida)}
            className="gap-2"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </Button>
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2">
            <Switch
              checked={saida.enviado_ao_fiscal || false}
              onCheckedChange={handleFiscalToggle}
              disabled={
                updatingFiscal ||
                (!saida.enviado_ao_fiscal && (saida.itens || []).length === 0)
              }
            />
            <Label className="text-sm font-medium cursor-pointer">
              Validação:{" "}
              <span
                className={
                  saida.enviado_ao_fiscal ? "text-primary" : "text-muted-foreground"
                }
              >
                {saida.enviado_ao_fiscal ? "Validado" : "Pendente"}
              </span>
            </Label>
          </div>
        </div>
      </div>

      {/* Dados da Solicitação */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2 mb-4">
          Dados da Solicitação
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <InfoItem label="Código" value={saida.codigo} highlight="text-primary text-lg font-bold" />
          <InfoItem label="Cliente" value={saida.cliente_nome} highlight="text-foreground text-lg font-bold" />
          <InfoItem label="Destino" value={saida.destino} />
          <InfoItem label="Data da Solicitação" value={formatDate(saida.data_solicitacao)} />
          <InfoItem label="Data Programada" value={formatDate(saida.data_programada)} />
          <InfoItem
            label="Validação"
            value={
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                  saida.status === "enviado_fiscal"
                    ? "bg-primary/10 text-primary"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {saida.status === "enviado_fiscal"
                  ? "Validado"
                  : "Pendente"}
              </span>
            }
          />
          <InfoItem label="Quantidade Total" value={`${formatMass(saida.quantidade_total, { empty: EMPTY })} kg`} highlight="text-green-600 font-bold" />
          <InfoItem label="Usuário Criador" value={saida.usuario_criador} />
          <InfoItem label="Usuário Responsável" value={saida.usuario_responsavel} />
          {saida.enviado_ao_fiscal && (
            <>
              <InfoItem label="Validação — Usuário" value={saida.enviado_fiscal_usuario} />
              <InfoItem label="Validação — Data" value={formatDateTime(saida.enviado_fiscal_data)} />
            </>
          )}
        </div>
        {saida.observacoes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Observações</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {saida.observacoes}
            </p>
          </div>
        )}
      </div>

      {/* Tabela de Produtos */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
            Produtos da Saída ({(saida.itens || []).length})
          </h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase">
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Quantidade</th>
                <th className="px-4 py-3 font-medium">Peso Líquido</th>
                <th className="px-4 py-3 font-medium">Qtd. Embalagens</th>
                <th className="px-4 py-3 font-medium">Tanque</th>
                <th className="px-4 py-3 font-medium">Volume (L)</th>
                <th className="px-4 py-3 font-medium">Peso Bruto</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Estoque Antes</th>
                <th className="px-4 py-3 font-medium">Estoque Depois</th>
              </tr>
            </thead>
            <tbody>
              {(saida.itens || []).length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhum produto nesta saída.
                  </td>
                </tr>
              ) : (
                saida.itens.map((item, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit px-2.5 py-1 rounded-full text-xs font-medium ${
                            item.tipo === TIPO_EMBALADO
                              ? "bg-orange-100 text-orange-800"
                              : item.tipo === TIPO_IND_VASILHAME
                                ? "bg-violet-100 text-violet-800"
                                : item.tipo === TIPO_IND_RETORNO_MP
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-primary/10 text-primary"
                          }`}
                        >
                          {tipoItemLabel(item)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {origemLabel(resolveItemOrigem(item))}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{item.produto_nome || "—"}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
                        ? `${formatVolume(item.volume_solicitado, { empty: EMPTY })} L`
                        : formatQtdComUnidade(item.quantidade_solicitada, item.unidade, {
                            empty: EMPTY,
                          })}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_EMBALADO
                        ? formatMass(item.peso_liquido_embalagem, { empty: EMPTY })
                        : formatMass(item.peso_liquido, { empty: EMPTY })}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_VASILHAME
                        ? formatNum(item.quantidade_embalagens, 1, { empty: EMPTY })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
                        ? item.vasilhame_placa || "—"
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
                        ? formatVolume(item.volume_solicitado, { empty: EMPTY })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
                        ? formatMass(item.peso_bruto, { empty: EMPTY })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.lote || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP
                        ? formatQtdComUnidade(item.estoque_atual, item.unidade, {
                            empty: EMPTY,
                          })
                        : `${formatVolume(item.volume_disponivel, { empty: EMPTY })} L`}
                    </td>
                    <td className="px-4 py-3 font-medium text-green-600">
                      {item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP
                        ? formatQtdComUnidade(item.estoque_final, item.unidade, {
                            empty: EMPTY,
                          })
                        : `${formatVolume(item.saldo_final, { empty: EMPTY })} L`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}