import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { fmtNumber, fmtCurrency } from '@/i18n/formatters';
import { buildPedidosFilterUrl } from '@/lib/dashboardMetrics';
import { canAccessRoute } from '@/lib/permissions';

const COLORS = {
  blue: '#2563eb',
  purple: '#7c3aed',
};

function ChartTooltip({ active, payload, fmtVol, fmtMoney, t, kgUnit }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="bg-card border border-border rounded-lg shadow-md px-3 py-2 text-sm">
      <p className="font-semibold mb-1.5">{row.client}</p>
      <p className="text-muted-foreground">
        {t('dashboard.charts.volumeLabel')}: <span className="text-foreground font-medium">{fmtVol(row.volume)} L</span>
      </p>
      <p className="text-muted-foreground">
        {t('dashboard.charts.revenueLabel')}: <span className="text-foreground font-medium">{fmtMoney(row.revenue)}</span>
      </p>
      <p className="text-muted-foreground">
        {t('dashboard.charts.avgPricePerKgLabel')}:{' '}
        <span className="text-foreground font-medium">
          {row.avgPricePerKg != null ? `${fmtMoney(row.avgPricePerKg)}/${kgUnit}` : '-'}
        </span>
      </p>
    </div>
  );
}

export default function ClientVolumeRevenueChart({ data, user, emptyMessage }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const canNavigate = canAccessRoute(user, '/pedidos');

  const fmtVol = (n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language);
  const fmtMoney = (n) => fmtCurrency(n || 0, 'BRL', i18n.language);
  const kgUnit = t('common.units.kg');

  const hasData = data.some((d) => d.volume > 0 || d.revenue > 0);

  const handleClientClick = (row) => {
    if (!canNavigate || !row?.client || row.client === '—') return;
    navigate(buildPedidosFilterUrl({ client: row.client }));
  };

  const handleBarClick = (barData) => {
    handleClientClick(barData?.payload);
  };

  const handleLineClick = (lineData) => {
    handleClientClick(lineData?.payload);
  };

  if (!hasData) {
    return <p className="text-sm text-muted-foreground text-center py-16">{emptyMessage}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="clientLabel"
          tick={{ fontSize: 11 }}
          stroke="#9ca3af"
          angle={-35}
          textAnchor="end"
          height={70}
          interval={0}
        />
        <YAxis
          yAxisId="volume"
          tick={{ fontSize: 11 }}
          stroke="#9ca3af"
          tickFormatter={(v) => fmtVol(v)}
        />
        <YAxis
          yAxisId="revenue"
          orientation="right"
          tick={{ fontSize: 11 }}
          stroke="#9ca3af"
          tickFormatter={(v) => fmtMoney(v)}
        />
        <Tooltip
          content={(
            <ChartTooltip
              fmtVol={fmtVol}
              fmtMoney={fmtMoney}
              t={t}
              kgUnit={kgUnit}
            />
          )}
        />
        <Legend />
        <Bar
          yAxisId="volume"
          dataKey="volume"
          name={t('dashboard.charts.volumeLabel')}
          fill={COLORS.blue}
          radius={[4, 4, 0, 0]}
          cursor={canNavigate ? 'pointer' : 'default'}
          onClick={handleBarClick}
        />
        <Line
          yAxisId="revenue"
          type="monotone"
          dataKey="revenue"
          name={t('dashboard.charts.revenueLabel')}
          stroke={COLORS.purple}
          strokeWidth={2.5}
          dot={{ r: 4, fill: COLORS.purple, cursor: canNavigate ? 'pointer' : 'default' }}
          activeDot={{ r: 6, cursor: canNavigate ? 'pointer' : 'default', onClick: handleLineClick }}
          onClick={handleLineClick}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
