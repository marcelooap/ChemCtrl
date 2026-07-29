import { useState, useEffect } from "react";
import { entities } from "@chemflow/services/entities";
import {
  BarChart3,
  ArrowLeftRight,
  Package,
} from "lucide-react";
import { formatVolume, formatMass, formatCurrency, formatNum } from "@chemflow/lib/format";
import {
  computeEstoqueSaldo,
  getEstoqueQuantidade,
  getEstoqueUnidade,
} from "@chemflow/lib/estoqueSaldo";
import { getDominantLote } from "@chemflow/lib/vasilhameComposicao";

const isSameMonth = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

const isToday = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return false;
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
};

/** Semana operacional: Segunda a Sábado (domingo cai na semana que termina no sábado anterior). */
const toDateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDateBr = (d) =>
  d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const getWeekRangeMonSat = (ref = new Date()) => {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const day = d.getDay(); // 0=Dom ... 6=Sáb
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysSinceMonday);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { monday, saturday };
};

const isInWeekMonSat = (dateStr, monday, saturday) => {
  if (!dateStr) return false;
  const key = String(dateStr).slice(0, 10);
  return key >= toDateKey(monday) && key <= toDateKey(saturday);
};

export default function Home() {
  const [transbordos, setTransbordos] = useState([]);
  const [estoque, setEstoque] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [trans, ests, saics, vas] = await Promise.all([
          entities.transbordos.list(),
          entities.estoque.list(),
          entities.saidas.list(),
          entities.vasilhames.list("-created_date"),
        ]);

        // Saldo = quantidade − saídas fiscais (embalado + convencional via origem)
        const estoqueWithSaldo = ests.map((e) => {
          const quantidade = getEstoqueQuantidade(e);
          const unidade_medida = getEstoqueUnidade(e);
          return {
            ...e,
            quantidade,
            unidade_medida,
            saldo_atual: computeEstoqueSaldo(
              { ...e, quantidade },
              trans,
              saics,
              vas
            ),
          };
        });

        setTransbordos(trans);
        setEstoque(estoqueWithSaldo);
        setVasilhames(vas);
      } catch {
        // ignore
      }
      setLoading(false);
    };
    loadData();
  }, []);

  const transbordosMes = transbordos.filter((t) => isSameMonth(t.data));
  const volumeTransbordadoMes = transbordosMes.reduce(
    (sum, t) => sum + (t.volume_total || 0),
    0
  );

  const transbordosHoje = transbordos.filter((t) => isToday(t.data));
  const volumeTransbordadoHoje = transbordosHoje.reduce(
    (sum, t) => sum + (t.volume_total || 0),
    0
  );

  const totalEmEstoque = estoque.reduce(
    (sum, e) => sum + (e.saldo_atual || 0),
    0
  );
  const custoTotalEstoque = estoque.reduce(
    (sum, e) => sum + (e.saldo_atual || 0) * (e.preco_unitario || 0),
    0
  );
  const itensComSaldo = estoque.filter((e) => (e.saldo_atual || 0) > 0).length;

  const cards = [
    {
      title: "VOLUME TRANSBORDADO NO MÊS",
      value: loading ? "..." : `${formatVolume(volumeTransbordadoMes)} L`,
      subtitle: loading
        ? "Carregando..."
        : `${transbordosMes.length} transbordo(s) registrado(s)`,
      footer: loading
        ? null
        : {
            primary: `${formatVolume(volumeTransbordadoHoje)} L hoje`,
            secondary: `Média diária: ${formatVolume(
              volumeTransbordadoMes /
                Math.max(new Date().getDate(), 1)
            )} L`,
          },
      icon: BarChart3,
      color: "#3B82F6",
      valueClass: "text-foreground",
      accentClass: "border-b-blue-500",
    },
    {
      title: "TRANSBORDADO HOJE",
      value: loading ? "..." : `${formatVolume(volumeTransbordadoHoje)} L`,
      subtitle: loading
        ? "Carregando..."
        : `${transbordosHoje.length} transbordo(s) no dia`,
      footer: loading
        ? null
        : {
            primary: "Volume do dia atual",
            secondary: `Acumulado no mês: ${formatVolume(volumeTransbordadoMes)} L`,
          },
      icon: ArrowLeftRight,
      color: "#10B981",
      valueClass: "text-emerald-600",
      accentClass: "border-b-emerald-500",
    },
    {
      title: "EM ESTOQUE",
      value: loading ? "..." : formatNum(totalEmEstoque, 0),
      subtitle: loading ? "Carregando..." : "unidades mistas",
      subtitleClass: "text-amber-600 font-medium",
      footer: loading
        ? null
        : {
            primary: `Custo total armazenado: ${formatCurrency(custoTotalEstoque)}`,
            secondary: `${itensComSaldo} item(ns) com saldo`,
            primaryClass: "text-amber-700 dark:text-amber-500",
          },
      icon: Package,
      color: "#F59E0B",
      valueClass: "text-foreground",
      accentClass: "border-b-amber-500",
    },
  ];

  const { monday: semanaInicio, saturday: semanaFim } = getWeekRangeMonSat();
  const periodoSemana = `${formatDateBr(semanaInicio)} – ${formatDateBr(semanaFim)}`;

  const transbordosSemana = transbordos
    .filter((t) => isInWeekMonSat(t.data, semanaInicio, semanaFim))
    .slice()
    .sort((a, b) => {
      const byData = String(b.data || "").localeCompare(String(a.data || ""));
      if (byData !== 0) return byData;
      return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });

  const volumeSemana = transbordosSemana.reduce(
    (sum, t) => sum + (t.volume_total || 0),
    0
  );

  const DIAS_SEMANA_LABELS = ["Seg.", "Ter.", "Qua.", "Qui.", "Sex.", "Sab."];
  const volumePorDia = DIAS_SEMANA_LABELS.map((label, offset) => {
    const day = new Date(semanaInicio);
    day.setDate(semanaInicio.getDate() + offset);
    const key = toDateKey(day);
    const volume = transbordosSemana
      .filter((t) => String(t.data || "").slice(0, 10) === key)
      .reduce((sum, t) => sum + (t.volume_total || 0), 0);
    return { label, volume };
  });

  const operacoes = transbordosSemana.map((t) => ({
    numero: t.codigo_transbordo || "-",
    produto: t.produto_nome || "-",
    cliente: t.cliente_nome || "-",
    volume: `${formatVolume(t.volume_total)} L`,
    operadores: t.operadores || [],
    data: t.data
      ? new Date(t.data + "T00:00:00").toLocaleDateString("pt-BR")
      : "-",
  }));

  // Vasilhames fracionados ainda no pátio (em estoque operacional)
  const fracionados = vasilhames.filter(
    (v) =>
      v.fracionado === true &&
      (v.status || "No Pátio") === "No Pátio"
  );

  // Itens de estoque com Status WMS = NOK
  const estoqueNok = estoque.filter((e) => !e.status_wms);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Visão geral do sistema</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className={`bg-card rounded-xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow border-b-[3px] ${card.accentClass}`}
            >
              <div className="flex items-start justify-between mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {card.title}
                </p>
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: card.color }}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>
              </div>

              <p className={`text-3xl font-bold tracking-tight ${card.valueClass}`}>
                {card.value}
              </p>
              <p
                className={`text-sm mt-1 ${
                  card.subtitleClass || "text-muted-foreground"
                }`}
              >
                {card.subtitle}
              </p>

              {card.footer && (
                <div className="mt-4 pt-3 border-t border-border space-y-1">
                  <p
                    className={`text-xs font-medium ${
                      card.footer.primaryClass || "text-primary"
                    }`}
                  >
                    {card.footer.primary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {card.footer.secondary}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Operations Table — semana atual (Seg–Sáb) */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold text-foreground">
                Transbordos recentes
              </h2>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/10 text-primary">
                {loading ? "..." : `${formatVolume(volumeSemana)} L`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Período: {periodoSemana} (segunda a sábado)
            </p>
          </div>
          <div className="flex items-start gap-1.5 sm:gap-2 shrink-0 overflow-x-auto">
            {volumePorDia.map((dia) => (
              <div key={dia.label} className="flex flex-col items-center gap-1 min-w-[3.25rem]">
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-800">
                  {dia.label}
                </span>
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary tabular-nums">
                  {loading ? "..." : `${formatVolume(dia.volume)} L`}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-360px)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">Código</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Volume</th>
                <th className="px-5 py-3 font-medium">Operadores</th>
                <th className="px-5 py-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando transbordos...
                  </td>
                </tr>
              ) : operacoes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum transbordo nesta semana.
                  </td>
                </tr>
              ) : (
                operacoes.map((op, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-primary">
                      {op.numero}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {op.produto}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{op.cliente}</td>
                    <td className="px-5 py-3 text-foreground">{op.volume}</td>
                    <td className="px-5 py-3">
                      {op.operadores.length === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {op.operadores.slice(0, 2).map((nome) => (
                            <span
                              key={nome}
                              className="inline-flex px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
                            >
                              {nome}
                            </span>
                          ))}
                          {op.operadores.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{op.operadores.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{op.data}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fracionados + Estoque NOK */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vasilhames fracionados */}
        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Vasilhames fracionados
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Em estoque no pátio
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
              {loading ? "..." : fracionados.length}
            </span>
          </div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium">Volume</th>
                  <th className="px-4 py-3 font-medium">Massa</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                ) : fracionados.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhum vasilhame fracionado no pátio.
                    </td>
                  </tr>
                ) : (
                  fracionados.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-primary whitespace-nowrap">
                        {v.codigo || "-"}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {v.produto_nome || "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {getDominantLote(v.composicao) || v.lote || "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {formatVolume(v.volume, { empty: "-" })} L
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatMass(v.peso_liquido, { empty: "-" })} kg
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Estoque WMS NOK */}
        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Estoque - Status WMS
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Itens com status WMS NOK
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-red-100 text-red-700">
              {loading ? "..." : estoqueNok.length}
            </span>
          </div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">NF Origem</th>
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium">Qtd.</th>
                  <th className="px-4 py-3 font-medium">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                ) : estoqueNok.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhum item com status WMS NOK.
                    </td>
                  </tr>
                ) : (
                  estoqueNok.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-primary whitespace-nowrap">
                        {e.produto_codigo || "-"}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {e.produto_nome || "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {e.nota_fiscal || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {e.lote || "-"}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatMass(e.saldo_atual, { empty: "-" })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {e.unidade_medida || "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
