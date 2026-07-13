import React from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fmtNumber } from '@/i18n/formatters';

const COLORS = ['#2563eb', '#00875a', '#f59e0b', '#7c3aed', '#0891b2', '#dc2626', '#6b7280', '#ec4899', '#14b8a6', '#f97316'];

export default function ProductDistributionSection({ title, items, total, emptyMessage }) {
  const { t, i18n } = useTranslation();
  const fmtVol = (n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);
  const chartData = items.map((item, i) => ({
    name: item.product,
    value: item.volume,
    percent: item.percent,
    fill: COLORS[i % COLORS.length],
  }));

  const totalFormatted = `${fmtVol(total)} L`;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
          <div className="relative h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={105}
                  paddingAngle={2}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name, props) => [
                    `${fmtVol(value)} L (${props.payload.percent.toFixed(1)}%)`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xs text-muted-foreground">{t('dashboard.charts.totalLabel')}</span>
              <span className="text-sm font-bold">{totalFormatted}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                  <th className="text-left py-2 pr-4">{t('dashboard.charts.productColumn')}</th>
                  <th className="text-right py-2 pr-4">{t('dashboard.charts.volumeColumn')}</th>
                  <th className="text-right py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.product} className="border-b border-border/50">
                    <td className="py-2 pr-4 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="font-medium truncate max-w-[180px]" title={item.product}>{item.product}</span>
                    </td>
                    <td className="py-2 pr-4 text-right text-muted-foreground">{fmtVol(item.volume)} L</td>
                    <td className="py-2 text-right font-medium">{item.percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
