import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProductCombobox from '@/components/ui/ProductCombobox';
import { fmtNumber, fmtDate, fmtDateTime } from '@/i18n/formatters';
import i18n from '@/i18n';
import jsPDF from 'jspdf';

// ── Conversão de unidades para kg ────────────────────────────────────────────
const convertToKg = (value, unit, density) => {
  const d = density || 1;
  switch (unit) {
    case 'kg':  return value;
    case 'L':   return value * d;
    case 'gal': return value * 3.78541 * d;
    case 'lb':  return value * 0.453592;
    default:    return value;
  }
};

const isWater = (name) =>
  /^água$/i.test((name || '').trim()) || /^agua$/i.test((name || '').trim());

// ── PDF ───────────────────────────────────────────────────────────────────────
function generateSimulacaoPDF({ recipe, volume, density, mass, rows, user, lang }) {
  const locale = lang || i18n.language || 'pt-BR';
  const t = (key, opts) => i18n.t(key, { ...opts, lng: locale });
  const fmt3 = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, locale);
  const doc = new jsPDF();
  const M = 14;
  const PW = 210;
  const CW = PW - 2 * M;

  const now = new Date();
  const dateStr = fmtDate(now, undefined, locale);
  const timeStr = fmtDateTime(now, { hour: '2-digit', minute: '2-digit' }, locale).split(' ').slice(-1)[0] || '';

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(28, 53, 91);
  doc.text(t('pdf.simulation.title'), M, 22);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(130, 140, 155);
  doc.text(`${recipe.product_name} · ${dateStr} ${timeStr}`, M, 29);

  doc.setDrawColor(37, 99, 195);
  doc.setLineWidth(0.6);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.2);

  let y = 44;

  const infoItems = [
    [t('pdf.simulation.fields.product'), recipe.product_name],
    [t('pdf.simulation.fields.client'), recipe.client || '—'],
    [t('pdf.simulation.fields.revision'), recipe.revision || '—'],
    [t('pdf.simulation.fields.simulatedVolume'), `${fmt3(volume)} L`],
    [t('pdf.simulation.fields.density'), fmt3(density)],
    [t('pdf.simulation.fields.totalMass'), fmt3(mass)],
    [t('pdf.simulation.fields.dateTime'), `${dateStr} ${timeStr}`],
    [t('pdf.simulation.fields.user'), user || '—'],
  ];

  const colW = CW / 2;
  const rowH = 13;
  doc.setDrawColor(220, 224, 230);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, Math.ceil(infoItems.length / 2) * rowH);

  infoItems.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * colW;
    const ry = y + row * rowH;

    if (col === 1) {
      doc.setLineWidth(0.3);
      doc.line(x, ry, x, ry + rowH);
    }
    if (row > 0) {
      doc.setLineWidth(0.15);
      doc.line(col === 0 ? M : x, ry, col === 0 ? M + colW : M + CW, ry);
    }

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(130, 140, 155);
    doc.text(item[0].toUpperCase(), x + 3, ry + 4.5);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(String(item[1]), x + 3, ry + 10);
  });

  y += Math.ceil(infoItems.length / 2) * rowH + 10;

  // Table header
  const cols = [
    { label: t('pdf.simulation.columns.rawMaterial'), w: 60 },
    { label: t('pdf.simulation.columns.percentMM'), w: 25 },
    { label: t('pdf.simulation.columns.currentStock'), w: 40 },
    { label: t('pdf.simulation.columns.recipeQty'), w: 30 },
    { label: t('pdf.simulation.columns.sendQty'), w: 27 },
  ];

  doc.setFillColor(28, 53, 91);
  doc.rect(M, y, CW, 8, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  let x = M;
  cols.forEach((c) => {
    doc.text(c.label, x + 2.5, y + 5.5);
    x += c.w;
  });
  y += 8;

  // Table rows
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  let totalReceita = 0;
  let totalEnviar = 0;

  rows.forEach((row, ri) => {
    const rowH2 = 7.5;
    if (y + rowH2 > 277) {
      doc.addPage();
      y = 20;
    }
    if (ri % 2 === 0) {
      doc.setFillColor(248, 249, 251);
      doc.rect(M, y, CW, rowH2, 'F');
    }
    doc.setDrawColor(220, 224, 230);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH2, M + CW, y + rowH2);

    doc.setTextColor(30, 30, 30);
    let cx = M;
    const cells = [
      row.mp_name,
      fmt3(row.percentage) + '%',
      fmt3(row.estoque_kg),
      fmt3(row.receita_kg),
      row.enviar > 0 ? fmt3(row.enviar) : '—',
    ];
    cells.forEach((cell, ci) => {
      const maxChars = Math.floor((cols[ci].w - 5) / 1.55);
      doc.text(
        cell.length > maxChars ? cell.substring(0, maxChars) + '…' : cell,
        cx + 2.5,
        y + 5.2
      );
      cx += cols[ci].w;
    });

    totalReceita += row.receita_kg || 0;
    totalEnviar += row.enviar > 0 ? row.enviar : 0;
    y += rowH2;
  });

  // Totals row
  doc.setFillColor(235, 240, 250);
  doc.rect(M, y, CW, 8, 'F');
  doc.setDrawColor(37, 99, 195);
  doc.setLineWidth(0.4);
  doc.line(M, y, M + CW, y);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(28, 53, 91);
  const totalCells = [t('pdf.common.total').toUpperCase(), '', '', fmt3(totalReceita) + ' kg', totalEnviar > 0 ? fmt3(totalEnviar) + ' kg' : '—'];
  let tx = M;
  totalCells.forEach((cell, ci) => {
    doc.text(cell, tx + 2.5, y + 5.5);
    tx += cols[ci].w;
  });
  y += 8;

  // Footer
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 224, 230);
    doc.setLineWidth(0.3);
    doc.line(M, 289, PW - M, 289);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130, 140, 155);
    doc.text(t('pdf.simulation.footer'), M, 294);
    doc.text(t('pdf.page', { current: i, total: pages }), PW - M, 294, { align: 'right' });
  }

  doc.save(`simulacao-${(recipe.product_name || 'receita').replace(/\s+/g, '-')}.pdf`);
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function SimuladorReceita({ recipes, open, onOpenChange }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user: internalUser } = useInternalAuth();
  const parseArr = (val) => {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) || []; } catch { return []; }
  };

  const { data: stocks } = useRealtimeEntity(
    'RawMaterialStock',
    () => base44.entities.RawMaterialStock.list('-created_date', 500),
    []
  );

  const [selectedProduct, setSelectedProduct] = useState('');
  const [volume, setVolume] = useState('');
  const [density, setDensity] = useState('');

  const recipe = useMemo(
    () => recipes.find((r) => r.product_name === selectedProduct) || null,
    [recipes, selectedProduct]
  );

  const mass = useMemo(() => {
    const v = parseFloat(volume) || 0;
    const d = parseFloat(density) || 0;
    return v * d;
  }, [volume, density]);

  const stockByMP = useMemo(() => {
    const map = {};
    stocks.forEach((s) => {
      const key = (s.mp_code || '').trim().toLowerCase();
      if (!key) return;
      const kg = convertToKg(s.current_stock || 0, s.unit, s.density || 1);
      map[key] = (map[key] || 0) + kg;
    });
    return map;
  }, [stocks]);

  const rows = useMemo(() => {
    if (!recipe) return [];
    const mps = parseArr(recipe.raw_materials);
    return mps.map((m) => {
      const pct = m.percentage || 0;
      const receita_kg = mass * (pct / 100);
      const estoque_kg = stockByMP[(m.mp_code || '').trim().toLowerCase()] || 0;
      const diff = receita_kg - estoque_kg;
      const enviar = isWater(m.mp_name) ? 0 : diff > 0 ? diff : 0;
      return { mp_name: m.mp_name, percentage: pct, estoque_kg, receita_kg, enviar };
    });
  }, [recipe, mass, stockByMP]);

  const handleProductSelect = useCallback(
    (productName) => {
      setSelectedProduct(productName);
      const r = recipes.find((rec) => rec.product_name === productName);
      if (r) setDensity(String(r.density || ''));
    },
    [recipes]
  );

  const handleGeneratePDF = () => {
    const user = internalUser?.nome_completo || internalUser?.username || '';
    generateSimulacaoPDF({
      recipe,
      volume: parseFloat(volume) || 0,
      density: parseFloat(density) || 0,
      mass,
      rows,
      user,
      lang,
    });
  };

  const productOptions = useMemo(
    () => recipes.map((r) => ({ value: r.product_name, label: r.product_name })),
    [recipes]
  );

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, lang);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🔬 {t('recipes.simulator.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('recipes.simulator.product')}</label>
            <ProductCombobox
              value={selectedProduct}
              onChange={handleProductSelect}
              options={productOptions}
              placeholder={t('recipes.simulator.selectProduct')}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('recipes.simulator.volumeL')}</label>
            <Input
              type="number"
              step="0.001"
              placeholder={t('recipes.simulator.volumePlaceholder')}
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('recipes.simulator.density')}</label>
            <Input
              type="number"
              step="0.001"
              placeholder={t('recipes.simulator.densityPlaceholder')}
              value={density}
              onChange={(e) => setDensity(e.target.value)}
            />
          </div>
        </div>

        {mass > 0 && (
          <div className="mb-2 text-xs text-muted-foreground">
            {t('recipes.simulator.calculatedMass')}{' '}
            <strong className="text-foreground">{fmt(mass)} {t('common.units.kg')}</strong>
          </div>
        )}

        {recipe && rows.length > 0 ? (
          <>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm chemctrl-table">
                <thead>
                  <tr>
                    <th className="px-3 py-2.5 text-left">{t('recipes.simulator.rawMaterial')}</th>
                    <th className="px-3 py-2.5 text-right">{t('recipes.simulator.percentMass')}</th>
                    <th className="px-3 py-2.5 text-right">{t('recipes.simulator.currentStockKg')}</th>
                    <th className="px-3 py-2.5 text-right">{t('recipes.simulator.recipeKg')}</th>
                    <th className="px-3 py-2.5 text-right">{t('recipes.simulator.sendKg')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{row.mp_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.percentage)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.estoque_kg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {mass > 0 ? fmt(row.receita_kg) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {mass > 0 ? (
                          row.enviar > 0 ? (
                            <span className="font-semibold text-red-600">{fmt(row.enviar)}</span>
                          ) : (
                            <span className="text-green-600 font-medium">—</span>
                          )
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {mass > 0 && (
                  <tfoot>
                    <tr className="border-t bg-blue-50/60">
                      <td className="px-3 py-2 font-bold text-xs" style={{ color: '#2575D1' }}>{t('recipes.simulator.total')}</td>
                      <td className="px-3 py-2 text-right font-bold text-xs" style={{ color: '#2575D1' }}>
                        {fmt(rows.reduce((s, r) => s + r.percentage, 0))}%
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-xs" style={{ color: '#2575D1' }}>
                        {fmt(rows.reduce((s, r) => s + r.estoque_kg, 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-xs" style={{ color: '#2575D1' }}>
                        {fmt(rows.reduce((s, r) => s + r.receita_kg, 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-xs text-red-600">
                        {rows.reduce((s, r) => s + r.enviar, 0) > 0
                          ? fmt(rows.reduce((s, r) => s + r.enviar, 0))
                          : '—'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {mass > 0 && (
              <div className="flex justify-end mt-3">
                <Button variant="outline" size="sm" onClick={handleGeneratePDF} className="gap-2">
                  <FileText className="w-4 h-4" /> {t('buttons.generatePdf')}
                </Button>
              </div>
            )}
          </>
        ) : recipe ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t('recipes.simulator.enterVolumeDensity')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t('recipes.simulator.selectProductHint')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
