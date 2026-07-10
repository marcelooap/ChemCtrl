import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, ListChecks, Save, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fmtDate, fmtDateTime, fmtNumber, fmtVolume, fmtMass } from '@/i18n/formatters';
import { translateProductionStatus, translatePriority } from '@/i18n/domainMaps';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { NotificationService } from '@/notifications/services/NotificationService';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
};

const statusBadgeColors = {
  'Aguardando Início': { bg: '#FEF3C7', text: '#92400E' },
  'Em Produção': { bg: '#E0E7FF', text: '#4338CA' },
  'Qualidade': { bg: '#FEF3C7', text: '#92400E' },
  'Envase': { bg: '#F3E8FF', text: '#5B21B6' },
  'Finalizado': { bg: '#D1FAE5', text: '#065F46' },
  'Cancelado': { bg: '#FEE2E2', text: '#991B1B' },
};

export default function ChecklistProducao() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: internalUser } = useInternalAuth();
  const [production, setProduction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: () => {}, confirmLabel: t('buttons.yes'), confirmColor: '#2575D1' });
  const [savingProgress, setSavingProgress] = useState(false);

  useEffect(() => {
    base44.entities.Production.get(id).then(setProduction).finally(() => setLoading(false));
  }, [id]);

  const grouped = useMemo(() => {
    const rms = parseArr(production?.raw_materials_used);
    if (!rms.length) return [];
    const map = new Map();
    rms.forEach(mp => {
      const key = mp.mp_code || mp.mp_name;
      if (!map.has(key)) {
        map.set(key, { mp_code: mp.mp_code, mp_name: mp.mp_name, lots: [] });
      }
      map.get(key).lots.push(mp);
    });
    return Array.from(map.values());
  }, [production?.raw_materials_used]);

  const toggleGroup = (groupIdx) => {
    const group = grouped[groupIdx];
    const allChecked = group.lots.every(l => l.checked);
    const updated = parseArr(production.raw_materials_used).map(mp =>
      group.lots.some(l => l === mp) ? { ...mp, checked: !allChecked } : mp
    );
    setProduction({ ...production, raw_materials_used: updated });
  };

  const allMPsChecked = grouped.length > 0 && grouped.every(g => g.lots.every(l => l.checked));
  const uncheckedCount = grouped.filter(g => !g.lots.every(l => l.checked)).length;

  const saveProgress = async () => {
    setSavingProgress(true);
    try {
      await base44.entities.Production.update(production.id, {
        raw_materials_used: production.raw_materials_used,
        pause_start_time: new Date().toISOString(),
      });
      toast({ title: t('production.checklist.saved') });
      navigate('/ordens');
    } catch (err) {
      toast({ title: t('production.checklistPage.saveError'), description: err.message, variant: 'destructive' });
    } finally {
      setSavingProgress(false);
    }
  };

  const finalizeProduction = () => {
    if (!allMPsChecked) {
      toast({ title: t('production.checklist.uncheckedWarning', { count: uncheckedCount }), variant: 'destructive' });
      return;
    }
    const nextStep = production.bypass_qc
      ? t('production.checklist.finishConfirm.nextPackaging')
      : t('production.checklist.finishConfirm.nextQuality');
    setConfirm({
      open: true,
      title: t('production.checklist.finishConfirm.title', { op: production.op_number }),
      message: t('production.checklist.finishConfirm.message', {
        product: production.product,
        lot: production.lot,
        nextStep,
      }),
      confirmLabel: t('production.checklistPage.finalizeConfirmLabel'),
      confirmColor: '#22c55e',
      onConfirm: async () => {
        const operatorName = internalUser?.nome_completo || internalUser?.nome || '';
        const nextStatus = production.bypass_qc ? 'Envase' : 'Qualidade';
        const now = new Date().toISOString();
        const updates = {
          raw_materials_used: production.raw_materials_used,
          status: nextStatus,
          end_time: now,
          pause_start_time: null,
          operator: operatorName,
        };
        if (nextStatus === 'Qualidade') {
          updates.qc_start_time = now;
        } else {
          updates.envase_start_time = now;
        }
        await base44.entities.Production.update(production.id, updates);
        if (nextStatus === 'Qualidade') {
          NotificationService.productionFinished({
            id: production.id,
            op_number: production.op_number,
            client: production.client,
          });
        }
        navigate('/ordens');
      },
    });
  };

  const fmt = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, i18n.language);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>;
  if (!production) return <div className="p-8 text-center text-muted-foreground">{t('production.checklistPage.notFound')}</div>;

  const colors = statusBadgeColors[production.status] || statusBadgeColors['Aguardando Início'];
  const hasSavedProgress = parseArr(production.raw_materials_used).some(mp => mp.checked);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/ordens')}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">OP: {production.op_number}</h1>
            <span className="text-[10px] font-semibold px-3 py-1 rounded-full" style={{ background: colors.bg, color: colors.text }}>{translateProductionStatus(production.status)}</span>
          </div>
          <p className="text-sm text-muted-foreground">{production.product} {production.client ? `— ${production.client}` : ''}</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-card rounded-xl shadow-sm border border-border p-5 mb-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t('production.checklistPage.opInfo')}</h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">{t('common.lot')}</p><p className="font-medium">{production.lot}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('common.date')}</p><p className="font-medium">{fmtDate(production.date, undefined, i18n.language)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('common.volume')}</p><p className="font-medium">{fmtVolume(production.volume, 'L', i18n.language)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('common.mass')}</p><p className="font-medium">{fmtMass(production.mass, 'kg', i18n.language)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('production.fields.recipeRevision')}</p><p className="font-medium">{production.recipe_revision || t('common.notAvailable')}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('production.fields.packaging')}</p><p className="font-medium">{production.packaging_info || production.packaging_type || t('common.notAvailable')}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('production.fields.priority')}</p><p className="font-medium">{translatePriority(production.priority)}</p></div>
          {production.start_time && <div><p className="text-xs text-muted-foreground">{t('production.fields.startTime')}</p><p className="font-medium">{fmtDateTime(production.start_time, undefined, i18n.language)}</p></div>}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('production.checklistPage.checklistTitle')}</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{t('production.checklistPage.clickToToggle')}</p>
        <div className="space-y-3">
          {grouped.map((group, gIdx) => {
            const allChecked = group.lots.every(l => l.checked);
            const isMultiLot = group.lots.length > 1;
            const totalQty = group.lots.reduce((s, l) => s + (l.qty_operational || 0), 0);
            return (
              <div key={gIdx}
                onClick={() => toggleGroup(gIdx)}
                className="border-2 rounded-lg p-3 cursor-pointer transition-all"
                style={{
                  borderColor: allChecked ? '#22c55e' : '#E5E7EB',
                  background: allChecked ? '#f0fdf4' : '#ffffff',
                }}
              >
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={allChecked} onChange={() => {}} onClick={e => e.stopPropagation()} className="mt-1 w-4 h-4 rounded" style={{ accentColor: '#2575D1' }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#E0E7FF', color: '#4338CA' }}>{group.mp_code}</span>
                      <span className="text-sm font-semibold">{group.mp_name}</span>
                    </div>
                    {!isMultiLot ? (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">{t('production.checklistPage.lotLabel', { lot: group.lots[0].lot || t('common.notAvailable') })}</p>
                        <p className="text-xs text-muted-foreground">{t('production.checklistPage.qtyOperationalLabel', { value: fmt(group.lots[0].qty_operational) })}</p>
                      </>
                    ) : (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">{t('production.checklistPage.totalLabel', { value: fmt(totalQty) })}</span>
                        </div>
                        <div className="space-y-2 ml-2">
                          {group.lots.map((lot, lIdx) => (
                            <div key={lIdx} className="flex items-center gap-2 pl-3 border-l-2" style={{ borderColor: '#E5E7EB' }}>
                              <input type="checkbox" checked={lot.checked || false} onChange={() => {}} onClick={e => e.stopPropagation()} className="w-3.5 h-3.5 rounded" style={{ accentColor: '#2575D1' }} />
                              <div className="flex-1 text-xs">
                                <span className="text-muted-foreground">{t('production.checklistPage.lotLabel', { lot: lot.lot || t('common.notAvailable') })}</span>
                                <span className="ml-3 text-muted-foreground">{t('production.checklistPage.qtyOperationalLabel', { value: fmt(lot.qty_operational) })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs font-bold mt-2" style={{ color: '#2575D1' }}>{t('production.checklistPage.sigmaTotal', { value: fmt(totalQty) })}</p>
                      </div>
                    )}
                  </div>
                  {allChecked && (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#dcfce7' }}>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Warning if not all checked */}
        {!allMPsChecked && uncheckedCount > 0 && (
          <div className="mt-4 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5" /> {t('production.checklistPage.uncheckedInline', { count: uncheckedCount })}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
          <Button variant="outline" onClick={saveProgress} disabled={savingProgress} className="gap-2">
            {savingProgress ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('production.checklistPage.saving')}</> : <><Save className="w-4 h-4" /> {t('production.actions.saveProgress')}</>}
          </Button>
          <Button onClick={finalizeProduction} className="gap-2 disabled:opacity-50" style={{ background: allMPsChecked ? '#22c55e' : '#94a3b8', color: 'white' }}>
            <CheckCircle className="w-4 h-4" /> {t('production.actions.finish')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={(open) => setConfirm(prev => ({ ...prev, open }))}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        confirmLabel={confirm.confirmLabel}
        confirmColor={confirm.confirmColor}
      />
    </div>
  );
}
