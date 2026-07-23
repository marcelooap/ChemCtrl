import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { generateTransferPDF } from '@/lib/pdfReports';
import { fmtDate, fmtNumber, fmtVolume, fmtMass } from '@/i18n/formatters';
import { translateTransferType, translatePackagingType } from '@/i18n/domainMaps';

const parseArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

export default function TransferViewDialog({ transfer, density, recipeCode, containers, onClose }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  if (!transfer) return null;

  const origins = parseArr(transfer.origins);
  const dests = parseArr(transfer.destinations);

  const containerLot = {};
  (Array.isArray(containers) ? containers : []).forEach(c => { if (c.id && c.lot) containerLot[c.id] = c.lot; });
  const liveLotFor = (o) => (o.container_id && containerLot[o.container_id]) ? containerLot[o.container_id] : o.lot;

  const noLotLabel = t('transfer.viewDialog.noLot');
  const lotMap = {};
  origins.forEach(o => {
    const key = liveLotFor(o) || noLotLabel;
    if (!lotMap[key]) lotMap[key] = { volume: 0, mass: 0 };
    lotMap[key].volume += parseFloat(o.volume_used) || 0;
    lotMap[key].mass += (parseFloat(o.volume_used) || 0) * (density || 0);
  });
  const lotKeys = Object.keys(lotMap);

  const totalVolUsed = origins.reduce((s, o) => s + (parseFloat(o.volume_used) || 0), 0);
  const totalMassUsed = totalVolUsed * (density || 0);
  const totalVolDest = dests.reduce((s, d) => s + (parseFloat(d.volume) || 0), 0);
  const totalMassDest = dests.reduce((s, d) => s + (parseFloat(d.mass) || 0), 0);

  const fmt0 = (n) => fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, lang);
  const fmt3 = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, lang);

  return (
    <Dialog open={!!transfer} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold">
              {transfer.transfer_number} — {transfer.product}
            </DialogTitle>
            <Button size="sm" style={{ background: '#2575D1' }} className="text-white hover:opacity-90"
              onClick={() => generateTransferPDF(transfer, density, containers, recipeCode)}>
              <FileDown className="w-4 h-4 mr-2" /> {t('buttons.generatePdf')}
            </Button>
          </div>
        </DialogHeader>

        <div className="grid gap-5">
          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('transfer.viewDialog.generalData')}</h4>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <Info label={t('common.date')} value={fmtDate(transfer.date, undefined, lang)} />
              <Info label={t('common.product')} value={transfer.product} />
              <Info label={t('common.client')} value={transfer.client || '—'} />
              <Info label={t('common.operator')} value={transfer.operator || '—'} />
              <Info label={t('recipes.simulator.density')} value={density ? `${fmt3(density)} g/mL` : '—'} />
              <div className="col-span-2"><Info label={t('common.observations')} value={transfer.observations || '—'} /></div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('transfer.viewDialog.origins')}</h4>
            <table className="w-full chemctrl-table border border-border rounded-lg overflow-hidden">
              <thead><tr>
                <th className="px-3 py-2 text-left">{t('transfer.viewDialog.container')}</th>
                <th className="px-3 py-2 text-left">{t('transfer.viewDialog.barrel')}</th>
                <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                <th className="px-3 py-2 text-right">{t('transfer.viewDialog.volumeWithdrawnL')}</th>
                <th className="px-3 py-2 text-right">{t('transfer.viewDialog.remainingBalanceL')}</th>
              </tr></thead>
              <tbody>
                {origins.map((o, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-sm font-medium">{o.container_number || '—'}</td>
                    <td className="px-3 py-2 text-sm">{o.barril_number || '—'}</td>
                    <td className="px-3 py-2 text-sm">{liveLotFor(o) || '—'}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt0(o.volume_used)}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt0(o.remaining_stock)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-blue-50/50">
                  <td className="px-3 py-2 text-xs font-bold" colSpan={3}>{t('common.total')}</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmtVolume(totalVolUsed, 'L', lang)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('transfer.viewDialog.lotSummary')}</h4>
            <table className="w-full chemctrl-table border border-border rounded-lg overflow-hidden">
              <thead><tr>
                <th className="px-3 py-2 text-left">{t('common.lot')}</th>
                <th className="px-3 py-2 text-right">{t('common.volume')} (L)</th>
                <th className="px-3 py-2 text-right">{t('transfer.viewDialog.massKg')}</th>
              </tr></thead>
              <tbody>
                {lotKeys.map(k => (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-2 text-sm font-medium">{k}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt0(lotMap[k].volume)}</td>
                    <td className="px-3 py-2 text-sm text-right">{fmt0(lotMap[k].mass)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-blue-50/50">
                  <td className="px-3 py-2 text-xs font-bold">{t('common.total')}</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmtVolume(totalVolUsed, 'L', lang)}</td>
                  <td className="px-3 py-2 text-sm font-bold text-right">{fmt0(totalMassUsed)} kg</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('transfer.viewDialog.destinations')}</h4>
            {dests.map((d, i) => (
              <div key={i} className="border rounded-lg p-3 mb-2">
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Info label={t('common.type')} value={d.type ? translateTransferType(d.type) : '—'} />
                  <Info label={d.type === 'Transbordo' ? t('transfer.viewDialog.plateNumber') : t('transfer.destination.vehiclePlate')} value={d.placa || '—'} />
                  <Info label={d.type === 'Transbordo' ? t('transfer.viewDialog.barrel') : t('transfer.viewDialog.driver')} value={d.type === 'Transbordo' ? (d.barril || '—') : (d.driver || '—')} />
                  <Info label={t('common.volume')} value={fmt0(d.volume)} />
                  <Info label={t('common.mass')} value={fmt0(d.mass)} />
                  {d.type === 'Transbordo' ? (
                    <>
                      <Info label={t('transfer.viewDialog.packagingType')} value={d.packaging_type ? translatePackagingType(d.packaging_type) : '—'} />
                      <Info label={t('transfer.viewDialog.sling')} value={d.sling || '—'} />
                      <Info label={t('containers.vasilhames.gps')} value={d.gps || '—'} />
                      <Info label={t('transfer.viewDialog.minTestDate')} value={fmtDate(d.min_test_date, undefined, lang)} />
                      <Info label={t('containers.vasilhames.tare')} value={fmt0(d.tare)} />
                      <Info label={t('packaging.fields.seals')} value={d.seals || '—'} wrap />
                    </>
                  ) : (
                    <>
                      <Info label={t('transfer.viewDialog.netWeightKg')} value={fmt0(d.net_weight)} />
                      <Info label={t('containers.vasilhames.tare')} value={fmt0(d.tare)} />
                      <Info label={t('transfer.viewDialog.grossWeightKg')} value={fmt0(d.gross_weight)} />
                      <Info label={t('packaging.fields.seals')} value={d.seals || '—'} wrap />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3" style={{ color: '#2A5A95' }}>{t('transfer.viewDialog.grandTotals')}</h4>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <Info label={t('transfer.viewDialog.totalVolumeWithdrawn')} value={fmtVolume(totalVolUsed, 'L', lang)} />
              <Info label={t('transfer.viewDialog.totalMassWithdrawn')} value={fmtMass(totalMassUsed, 'kg', lang)} />
              <Info label={t('transfer.viewDialog.totalDestinationVolume')} value={fmtVolume(totalVolDest, 'L', lang)} />
              <Info label={t('transfer.viewDialog.totalDestinationMass')} value={fmtMass(totalMassDest, 'kg', lang)} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, wrap }) {
  return (
    <div className={`border border-border rounded-md px-2.5 py-1.5 bg-muted/50/50 ${wrap ? 'col-span-4' : ''}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium text-foreground ${wrap ? 'break-words whitespace-normal' : 'truncate'}`}>{value}</p>
    </div>
  );
}
