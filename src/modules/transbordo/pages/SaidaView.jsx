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
    const pageW = 210;
    const margin = 14;
    let y = 16;

    // ── Cabeçalho da empresa ──
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text("Transbordo", margin, 12);
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.text("Controle Operacional", margin, 17);
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text("SOLICITAÇÃO DE SAÍDA", pageW - margin, 12, { align: "right" });
    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.text(`Nº ${saida.codigo || "—"}`, pageW - margin, 17, { align: "right" });
    y = 30;

    // ── Dados da solicitação ──
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(7);
    doc.setFont(undefined, "bold");
    doc.text("CLIENTE", margin, y);
    doc.text("DATA DA SOLICITAÇÃO", margin + 90, y);
    doc.text("DATA PROGRAMADA", margin + 150, y);
    y += 4;
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(20, 20, 20);
    doc.text(saida.cliente_nome || "—", margin, y);
    doc.text(formatDate(saida.data_solicitacao), margin + 90, y);
    doc.text(formatDate(saida.data_programada), margin + 150, y);
    y += 6;

    // Linha separadora
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    // ── Tabela de produtos ──
    const headers = ["Tipo", "Produto", "Lote", "Qtd. (kg)", "Peso Líq.", "Qtd. Emb.", "Tanque", "Vol. (L)", "Est. Antes", "Est. Depois"];
    const colWidths = [20, 30, 18, 16, 16, 14, 18, 16, 18, 18];
    const tableW = colWidths.reduce((a, b) => a + b, 0);
    let x = margin;

    // Header da tabela
    doc.setFillColor(45, 86, 162);
    doc.rect(x, y - 4, tableW, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.setFont(undefined, "bold");
    colWidths.forEach((w, i) => {
      doc.text(headers[i], x + 1, y, { maxWidth: w - 2 });
      x += w;
    });
    y += 5;

    // Linhas
    doc.setFontSize(6.5);
    doc.setFont(undefined, "normal");
    doc.setTextColor(30, 30, 30);
    (saida.itens || []).forEach((item, idx) => {
      if (y > 270) {
        doc.addPage();
        y = 16;
      }
      x = margin;
      if (idx % 2 === 1) {
        doc.setFillColor(245, 247, 250);
        doc.rect(x, y - 3.5, tableW, 5, "F");
      }
      const row = [
        tipoItemLabel(item).substring(0, 18),
        (item.produto_nome || "—").substring(0, 28),
        (item.lote || "—").substring(0, 16),
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
      ];
      colWidths.forEach((w, i) => {
        doc.text(row[i], x + 1, y, { maxWidth: w - 2 });
        x += w;
      });
      y += 5;
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.1);
      doc.line(margin, y - 3.5, margin + tableW, y - 3.5);
    });

    // Total
    y += 2;
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    doc.text(
      `QUANTIDADE TOTAL: ${formatMass(saida.quantidade_total, { empty: EMPTY })} kg`,
      margin + tableW - 50,
      y
    );
    y += 8;

    // ── Observações ──
    if (saida.observacoes) {
      doc.setFontSize(7);
      doc.setFont(undefined, "bold");
      doc.setTextColor(100, 100, 100);
      doc.text("OBSERVAÇÕES:", margin, y);
      y += 4;
      doc.setFont(undefined, "normal");
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      const obsLines = doc.splitTextToSize(saida.observacoes, pageW - margin * 2);
      doc.text(obsLines, margin, y);
      y += obsLines.length * 4 + 4;
    }

    // ── Assinaturas ──
    if (y > 240) {
      doc.addPage();
      y = 30;
    }
    y += 10;
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    const sigW = 70;
    const gap = (pageW - margin * 2 - sigW * 2) / 1;
    doc.line(margin, y, margin + sigW, y);
    doc.line(margin + sigW + gap, y, margin + sigW * 2 + gap, y);
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text("Solicitante", margin + sigW / 2, y + 4, { align: "center" });
    doc.text("Responsável", margin + sigW + gap + sigW / 2, y + 4, {
      align: "center",
    });

    // ── Rodapé ──
    doc.setFontSize(6);
    doc.setTextColor(160, 160, 160);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} | Transbordo - Controle Operacional`,
      pageW / 2,
      290,
      { align: "center" }
    );

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
        setSaida(s);
        setEntradas(ents);
        setVasilhames(vascs);
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
      <div className="space-y-6">
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
    <div className="space-y-6">
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
              disabled={updatingFiscal}
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