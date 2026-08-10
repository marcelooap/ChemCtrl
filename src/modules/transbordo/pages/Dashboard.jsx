import { useEffect, useMemo, useState } from "react";
import moment from "moment";
import {
  BarChart3,
  Trophy,
  User,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import { entities } from "@transbordo/services/entities";
import { formatVolume, formatPercent } from "@transbordo/lib/format";
import {
  computeDashboardKpis,
  buildMonthlyVolumeSeries,
  buildClientVolumeSeries,
  buildOperatorVolumeSeries,
} from "@transbordo/lib/dashboardMetrics";
import KpiCard from "@transbordo/components/dashboard/KpiCard";

const COLORS = {
  blue: "#2563eb",
  blueCurrent: "#1d4ed8",
  green: "#00875a",
  amber: "#f59e0b",
  teal: "#0891b2",
  gray: "#9ca3af",
};

const PIE_COLORS = [
  "#2563eb",
  "#00875a",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#6b7280",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function ChartCard({ title, children, className }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 ${className || ""}`}>
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

function truncateLabel(name, max = 14) {
  const s = (name || "—").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export default function Dashboard() {
  const [transbordos, setTransbordos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => moment(), []);
  const [selectedMonth, setSelectedMonth] = useState(today.month());
  const [selectedYear, setSelectedYear] = useState(today.year());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [trans, prods] = await Promise.all([
          entities.transbordos.list("-created_date"),
          entities.produtos.list(),
        ]);
        if (!cancelled) {
          setTransbordos(trans || []);
          setProdutos(prods || []);
        }
      } catch (err) {
        console.error("Erro ao carregar dashboard ChemFlow:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const referenceDate = useMemo(() => {
    const isCurrentPeriod =
      selectedMonth === today.month() && selectedYear === today.year();
    if (isCurrentPeriod) return today.clone().toDate();
    return moment({ year: selectedYear, month: selectedMonth, day: 15 }).toDate();
  }, [selectedMonth, selectedYear, today]);

  const yearOptions = useMemo(() => {
    const years = new Set([today.year(), selectedYear]);
    for (let y = today.year(); y >= today.year() - 5; y -= 1) years.add(y);
    for (const t of transbordos) {
      if (!t?.data) continue;
      const m = moment(t.data);
      if (m.isValid()) years.add(m.year());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [transbordos, today, selectedYear]);

  const kpis = useMemo(
    () => computeDashboardKpis(transbordos, produtos, referenceDate),
    [transbordos, produtos, referenceDate]
  );

  const monthlyData = useMemo(
    () => buildMonthlyVolumeSeries(transbordos, produtos, selectedYear, referenceDate),
    [transbordos, produtos, selectedYear, referenceDate]
  );

  const clientData = useMemo(
    () =>
      buildClientVolumeSeries(transbordos, {
        year: selectedYear,
        month: selectedMonth,
      }),
    [transbordos, selectedYear, selectedMonth]
  );

  const operatorData = useMemo(
    () =>
      buildOperatorVolumeSeries(transbordos, {
        year: selectedYear,
        month: selectedMonth,
      }),
    [transbordos, selectedYear, selectedMonth]
  );

  const pieData = useMemo(
    () =>
      clientData.map((item, i) => ({
        ...item,
        label: truncateLabel(item.name, 18),
        fill: PIE_COLORS[i % PIE_COLORS.length],
      })),
    [clientData]
  );

  const operatorChartData = useMemo(
    () =>
      operatorData.map((item) => ({
        ...item,
        label: truncateLabel(item.name, 12),
      })),
    [operatorData]
  );

  const hasMonthlyData = monthlyData.some((m) => m.volume > 0 || m.volumeFiltered > 0);
  const clientTotal = clientData.reduce((s, c) => s + c.volume, 0);
  const isCurrentPeriod =
    selectedMonth === today.month() && selectedYear === today.year();
  const subtitleDate = isCurrentPeriod
    ? `${today.date()} de ${MONTH_LABELS[today.month()]} de ${today.year()}`
    : `${MONTH_LABELS[selectedMonth]} de ${selectedYear}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Indicadores de transbordo · {subtitleDate}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border px-3 py-2 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Mês</label>
            <Select
              value={String(selectedMonth)}
              onValueChange={(v) => setSelectedMonth(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs mt-0.5 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index)} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Ano</label>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs mt-0.5 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)} className="text-xs">
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <KpiCard
          title="Volume no mês"
          value={kpis.hasCurrentData ? `${formatVolume(kpis.volumeCurrent)} L` : "-"}
          subtitle={
            kpis.hasCurrentData
              ? `Filtrado: ${formatVolume(kpis.volumeFiltered)} L (${formatPercent(kpis.filteredPercent)}%)`
              : undefined
          }
          comparison={kpis.hasCurrentData ? kpis.volumeChange : undefined}
          comparisonLabel={
            kpis.hasCurrentData && kpis.volumeChange != null ? "vs mês anterior" : undefined
          }
          icon={BarChart3}
          color={COLORS.blue}
        />
        <KpiCard
          title="Produto com maior volume"
          value={kpis.topProduct ? kpis.topProduct.name : "-"}
          subtitle={
            kpis.topProduct
              ? `${formatVolume(kpis.topProduct.volume)} L · ${formatPercent(kpis.topProduct.percent)}% do mês`
              : undefined
          }
          icon={Trophy}
          color={COLORS.amber}
        />
        <KpiCard
          title="Operador com maior volume"
          value={kpis.topOperator ? kpis.topOperator.name : "-"}
          subtitle={
            kpis.topOperator
              ? `${formatVolume(kpis.topOperator.volume)} L · ${formatPercent(kpis.topOperator.percent)}% do mês`
              : undefined
          }
          icon={User}
          color={COLORS.green}
        />
      </div>

      <div className="mb-6">
        <ChartCard title="Volume transbordado por mês">
          {!hasMonthlyData ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              Nenhum transbordo registrado neste ano.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                  tickFormatter={(v) => formatVolume(v)}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${formatVolume(value)} L`,
                    name === "volume"
                      ? "Volume total"
                      : name === "volumeFiltered"
                        ? "Volume filtrado"
                        : "Tendência",
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === "volume"
                      ? "Volume total"
                      : value === "volumeFiltered"
                        ? "Volume filtrado"
                        : "Tendência"
                  }
                />
                <Bar dataKey="volume" name="volume" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry) => (
                    <Cell
                      key={entry.monthIndex}
                      fill={entry.isCurrent ? COLORS.blueCurrent : COLORS.blue}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="volumeFiltered"
                  name="volumeFiltered"
                  fill={COLORS.teal}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="volume"
                  stroke={COLORS.gray}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="tendencia"
                  legendType="line"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title="Volume transbordado por cliente">
          {pieData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              Nenhum dado no período selecionado.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="relative h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="volume"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={105}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, _name, props) => [
                        `${formatVolume(value)} L (${formatPercent(props.payload.percent)}%)`,
                        props.payload.name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="text-sm font-bold">{formatVolume(clientTotal)} L</span>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left py-2 pr-3">Cliente</th>
                      <th className="text-right py-2 pr-3">Volume</th>
                      <th className="text-right py-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieData.map((item, i) => (
                      <tr key={item.name} className="border-b border-border/50">
                        <td className="py-2 pr-3 flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="font-medium truncate" title={item.name}>
                            {item.name}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-muted-foreground whitespace-nowrap">
                          {formatVolume(item.volume)} L
                        </td>
                        <td className="py-2 text-right font-medium whitespace-nowrap">
                          {formatPercent(item.percent)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Volume transbordado por operador">
          {operatorChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              Nenhum dado no período selecionado.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={operatorChartData} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                  tickFormatter={(v) => formatVolume(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={90}
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                />
                <Tooltip
                  formatter={(value) => [`${formatVolume(value)} L`, "Volume"]}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.name || ""}
                />
                <Bar dataKey="volume" name="Volume" radius={[0, 4, 4, 0]} barSize={18}>
                  {operatorChartData.map((entry, i) => (
                    <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
