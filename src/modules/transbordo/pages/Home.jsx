import { useMemo, useState } from "react";
import {
  BarChart3,
  ArrowLeftRight,
  Package,
  Search,
} from "lucide-react";
import { formatVolume, formatMass, formatCurrency, formatNum } from "@transbordo/lib/format";
import {
  computeEstoqueSaldo,
  createEstoqueSaldoContext,
  getEstoqueQuantidade,
  getEstoqueUnidade,
} from "@transbordo/lib/estoqueSaldo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { isMateriaPrimaIndustrializacao } from "@transbordo/lib/materiaPrimaIndustrializacao";
import { useTransbordoWorkspace } from "@transbordo/hooks/useTransbordoWorkspace";

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
  const { data: workspace, isLoading: loading } = useTransbordoWorkspace();

  const { transbordos, estoque, vasilhames } = useMemo(() => {
    const transbordos = workspace?.transbordos ?? [];
    const vasilhames = workspace?.vasilhames ?? [];
    const rawEstoque = workspace?.estoque ?? [];
    const saidas = workspace?.saidas ?? [];

    if (!workspace) {
      return { transbordos: [], estoque: [], vasilhames: [] };
    }

    const saldoCtx = createEstoqueSaldoContext(transbordos, saidas, vasilhames);
    const estoqueWithSaldo = rawEstoque
      .filter((e) => !isMateriaPrimaIndustrializacao(e, null))
      .map((e) => {
        const quantidade = getEstoqueQuantidade(e);
        const unidade_medida = getEstoqueUnidade(e);
        const itemOp = { ...e, quantidade, unidade_medida };
        return {
          ...itemOp,
          saldo_atual: computeEstoqueSaldo(
            itemOp,
            transbordos,
            saidas,
            vasilhames,
            saldoCtx
          ),
        };
      });

    return { transbordos, estoque: estoqueWithSaldo, vasilhames };
  }, [workspace]);

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

  const { monday: semanaInicio, saturday: semanaFim } = getWeekRangeMonSat();
  const dataDia = formatDateBr(new Date());
  const transbordosSemana = transbordos.filter((t) =>
    isInWeekMonSat(t.data, semanaInicio, semanaFim)
  );
  const volumeTransbordadoSemana = transbordosSemana.reduce(
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
      value: loading ? "..." : `${formatNum(volumeTransbordadoMes, 0)} L`,
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
      title: "TRANSBORDADO NA SEMANA",
      value: loading ? "..." : `${formatNum(volumeTransbordadoSemana, 0)} L`,
      subtitle: loading
        ? "Carregando..."
        : `${transbordosSemana.length} transbordo(s) na semana`,
      footer: loading
        ? null
        : {
            primary: "Volume da semana (seg. a sáb.)",
            secondary: `Acumulado no mês: ${formatNum(volumeTransbordadoMes, 0)} L`,
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

  const transbordosDoDia = transbordosHoje.slice().sort((a, b) => {
    return new Date(b.created_date || 0) - new Date(a.created_date || 0);
  });

  const operacoes = transbordosDoDia.map((t) => ({
    numero: t.codigo_transbordo || "-",
    produto: t.produto_nome || "-",
    cliente: t.cliente_nome || "-",
    volume: `${formatVolume(t.volume_total)} L`,
    operadores: t.operadores || [],
    data: t.data
      ? new Date(t.data + "T00:00:00").toLocaleDateString("pt-BR")
      : "-",
  }));

  const [fracionadosSearch, setFracionadosSearch] = useState("");

  const fracionados = vasilhames.filter(
    (v) =>
      v.fracionado === true &&
      (v.status || "No Pátio") === "No Pátio"
  );

  const fracionadosFiltrados = useMemo(() => {
    const q = fracionadosSearch.trim().toLowerCase();
    if (!q) return fracionados;
    return fracionados.filter(
      (v) =>
        v.produto_nome?.toLowerCase().includes(q) ||
        v.codigo?.toLowerCase().includes(q) ||
        v.placa?.toLowerCase().includes(q) ||
        v.barril?.toLowerCase().includes(q)
    );
  }, [fracionados, fracionadosSearch]);

  const getDataEnvase = (v) => {
    const fromComp = (v.composicao || []).map((c) => c?.data).find(Boolean);
    return fromComp || v.created_date || v.created_at || null;
  };

  const calcDiasNoPatio = (v) => {
    const dataEnvase = getDataEnvase(v);
    if (!dataEnvase) return null;
    const envase = new Date(String(dataEnvase).slice(0, 10) + "T00:00:00");
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.floor((hoje - envase) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Visão geral do sistema</p>
      </div>

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

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Transbordo do dia
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{dataDia}</p>
          </div>
          <div className="flex items-start gap-1.5 sm:gap-2 shrink-0 overflow-x-auto">
            {volumePorDia.map((dia) => (
              <div key={dia.label} className="flex flex-col items-center gap-1 min-w-[3.25rem]">
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-800">
                  {dia.label}
                </span>
                <span className="inline-flex items-center justify-center w-full px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary tabular-nums">
                  {loading ? "..." : `${formatNum(dia.volume, 0)} L`}
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
                    Nenhum transbordo hoje.
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

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Vasilhames fracionados
            </h2>
            <p className="text-xs text-muted-foreground mt-1">Em estoque no pátio</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={fracionadosSearch}
                onChange={(e) => setFracionadosSearch(e.target.value)}
                placeholder="Buscar produto ou vasilhame..."
                className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all w-56"
              />
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
              {loading ? "..." : fracionadosFiltrados.length}
              {fracionadosSearch && fracionadosFiltrados.length !== fracionados.length && (
                <span className="ml-1 text-blue-500">/ {fracionados.length}</span>
              )}
            </span>
          </div>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-360px)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">N° Placa</th>
                <th className="px-5 py-3 font-medium">N° Barril</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Lote</th>
                <th className="px-5 py-3 font-medium">Volume</th>
                <th className="px-5 py-3 font-medium">Massa</th>
                <th className="px-5 py-3 font-medium">Dias no Pátio</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando vasilhames...
                  </td>
                </tr>
              ) : fracionadosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    {fracionadosSearch
                      ? "Nenhum vasilhame encontrado para a busca."
                      : "Nenhum vasilhame fracionado no pátio."}
                  </td>
                </tr>
              ) : (
                fracionadosFiltrados.map((v, i) => {
                  const dias = calcDiasNoPatio(v);
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                    >
                      <td className="px-5 py-3 font-medium text-primary whitespace-nowrap">
                        {v.codigo || "-"}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {v.placa || "-"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                        {v.barril || "-"}
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        {v.produto_nome || "-"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                        {getDominantLote(v.composicao) || v.lote || "-"}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {formatVolume(v.volume, { empty: "-" })} L
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {formatMass(v.peso_liquido, { empty: "-" })} kg
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {dias === null ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                            {dias} dia{dias !== 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
