import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { Search, FileCheck, CheckCircle, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductionCard from '@/components/ProductionCard';
import moment from 'moment';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const fmtNum = (n) => {
  if (n === null || n === undefined || n === '') return '';
  const num = typeof n === 'number' ? n : parseFloat(String(n).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return n;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const isTextAnalysis = (name) => {
  const n = (name || '').toUpperCase().trim();
  return n === 'COR' || n === 'ASPECTO';
};

export default function ProducoesCQ() {
  const { data: allProds, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: tests } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500));
  const { data: results, reload: load } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedProd, setSelectedProd] = useState(null);
  const [analysisForm, setAnalysisForm] = useState({ analyst: '', observations: '', results: [] });

  const productions = useMemo(() =>
    allProds.filter(p =>
      p.status === 'Qualidade' || (p.bypass_qc && p.status === 'Envase' && !results.some(res => res.production_id === p.id))
    ),
    [allProds, results]
  );

  const openAnalysis = (prod) => {
    setSelectedProd(prod);
    const test = tests.find(t => t.product === prod.product);
    const existing = results.find(r => r.production_id === prod.id);
    if (existing) {
      setAnalysisForm({ analyst: existing.analyst || '', observations: existing.observations || '', results: parseArr(existing.results) });
    } else {
      const items = parseArr(test?.analyses).map(a => ({
        analysis_name: a.analysis_name, methodology: a.methodology, unit: a.unit,
        min_limit: a.min_limit, max_limit: a.max_limit, specification: a.specification,
        result: '', status: '—'
      }));
      setAnalysisForm({ analyst: '', observations: '', results: items });
    }
    setShowAnalysis(true);
  };

  const updateResult = (idx, val) => {
    const r = [...analysisForm.results];
    r[idx] = { ...r[idx], result: val };
    const item = r[idx];
    if (isTextAnalysis(item.analysis_name)) {
      const spec = (item.specification || '').trim();
      const valUpper = (val || '').trim();
      r[idx].status = (valUpper === 'Conforme' || (spec && valUpper === spec)) ? 'Aprovado' : 'Reprovado';
    } else {
      const num = parseFloat(String(val).replace(/\./g, '').replace(',', '.'));
      if (!isNaN(num)) {
        if ((item.min_limit != null && num < item.min_limit) || (item.max_limit != null && num > item.max_limit)) {
          r[idx].status = 'Reprovado';
        } else {
          r[idx].status = 'Aprovado';
        }
      } else {
        r[idx].status = '—';
      }
    }
    setAnalysisForm({ ...analysisForm, results: r });
  };

  const computeOverallStatus = () => {
    const statuses = analysisForm.results.map(r => r.status);
    if (statuses.length === 0 || statuses.some(s => s === '—')) return null;
    if (statuses.every(s => s === 'Aprovado')) return 'Aprovado';
    if (statuses.some(s => s === 'Reprovado')) return 'Reprovado';
    return 'Aprovado';
  };

  const overallStatus = computeOverallStatus();

  const saveAndApprove = async (status) => {
    let analystName = '';
    try { const user = await base44.auth.me(); analystName = user?.nome || user?.full_name || user?.email || ''; } catch (_) {}
    const existing = results.find(r => r.production_id === selectedProd.id);
    const data = {
      production_id: selectedProd.id, op_number: selectedProd.op_number,
      product: selectedProd.product, client: selectedProd.client, lot: selectedProd.lot,
      date: new Date().toISOString(), analyst: analystName,
      status, observations: analysisForm.observations, results: analysisForm.results,
    };
    if (existing) await base44.entities.QualityResult.update(existing.id, data);
    else await base44.entities.QualityResult.create(data);

    const newProdStatus = status === 'Aprovado' ? 'Envase' : (status === 'Reprovado' ? 'Cancelado' : 'Envase');
    const prodUpdates = { qc_status: status, qc_analyst: analystName, qc_observations: analysisForm.observations, status: newProdStatus };
    if (newProdStatus === 'Envase') {
      prodUpdates.envase_start_time = new Date().toISOString();
    }
    await base44.entities.Production.update(selectedProd.id, prodUpdates);

    setShowAnalysis(false);
    load();
  };

  const filtered = productions.filter(p => { const q = search.toLowerCase(); return !q || [p.op_number, p.product, p.client].some(v => (v || '').toLowerCase().includes(q)); });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>Controle de Qualidade</h1>
          <p className="text-sm text-muted-foreground">{productions.length} produção(ões) aguardando análise</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(prod => (
            <ProductionCard key={prod.id} prod={prod}>
              <Button onClick={() => openAnalysis(prod)} className="w-full text-white" style={{ background: '#1e40af' }}>
                <FileCheck className="w-3.5 h-3.5 mr-1.5" /> Analisar
              </Button>
            </ProductionCard>
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-1">Nenhuma produção aguardando qualidade</p>
        </div>
      )}

      {/* Analysis Dialog */}
      <Dialog open={showAnalysis} onOpenChange={setShowAnalysis}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Análise CQ — {selectedProd?.product} · Lote {selectedProd?.lot}</DialogTitle></DialogHeader>
          {selectedProd && (
            <div>
              <div className="grid grid-cols-3 gap-3 text-sm mb-4 bg-gray-50 rounded-lg p-3">
                <div><p className="text-xs text-muted-foreground">OP</p><p className="font-bold">{selectedProd.op_number}</p></div>
                <div><p className="text-xs text-muted-foreground">Volume</p><p className="font-medium">{(selectedProd.volume || 0).toLocaleString('pt-BR')} L</p></div>
                <div><p className="text-xs text-muted-foreground">Data</p><p className="font-medium">{moment(selectedProd.date).format('DD/MM/YYYY')}</p></div>
              </div>
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground">Analista Responsável</p>
                <p className="text-sm font-semibold text-gray-700 mt-1">Registrado automaticamente pelo usuário logado</p>
              </div>
              <h4 className="text-sm font-semibold mb-2">Resultados — {selectedProd.recipe_revision || 'Rev.01'}</h4>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead><tr className="text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">ANÁLISE</th><th className="px-3 py-2 text-left">MÉTODO</th><th className="px-3 py-2 text-left">UNID.</th>
                  <th className="px-3 py-2 text-right">MÍN.</th><th className="px-3 py-2 text-right">MÁX.</th><th className="px-3 py-2 text-left">ESPECIFICAÇÃO</th><th className="px-3 py-2 text-left">RESULTADO</th><th className="px-3 py-2 text-left">STATUS</th>
                </tr></thead>
                <tbody>
                  {analysisForm.results.map((r, idx) => {
                    const isText = isTextAnalysis(r.analysis_name);
                    const statusColor = r.status === 'Aprovado' ? 'text-green-600 font-semibold' : r.status === 'Reprovado' ? 'text-red-600 font-semibold' : 'text-muted-foreground';
                    return (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.analysis_name}</td>
                        <td className="px-3 py-2">{r.methodology}</td>
                        <td className="px-3 py-2">{r.unit || '—'}</td>
                        <td className="px-3 py-2 text-right">{isText ? '—' : (r.min_limit != null ? fmtNum(r.min_limit) : '—')}</td>
                        <td className="px-3 py-2 text-right">{isText ? '—' : (r.max_limit != null ? fmtNum(r.max_limit) : '—')}</td>
                        <td className="px-3 py-2 text-xs">{isText ? (r.specification || '—') : '—'}</td>
                        <td className="px-2 py-1">
                          {isText ? (
                            <Select value={r.result} onValueChange={v => updateResult(idx, v)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Conforme..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Conforme">Conforme</SelectItem>
                                {r.specification && r.specification !== 'Conforme' && <SelectItem value={r.specification}>{r.specification}</SelectItem>}
                                <SelectItem value="Não Conforme">Não Conforme</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input value={r.result} onChange={e => updateResult(idx, e.target.value)} className="h-8 text-xs" placeholder="Resultado" />
                          )}
                        </td>
                        <td className={`px-3 py-2 text-xs ${statusColor}`}>{r.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4"><label className="text-xs font-medium text-muted-foreground">Observações</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2} value={analysisForm.observations} onChange={e => setAnalysisForm({ ...analysisForm, observations: e.target.value })} /></div>

              {/* Overall Status — at the bottom for "final result" impression */}
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Resultado Final</span>
                  {overallStatus ? (
                    <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg ${overallStatus === 'Aprovado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {overallStatus === 'Aprovado' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {overallStatus}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Preencha todos os resultados</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowAnalysis(false)}>Cancelar</Button>
                <Button variant="outline" className="text-amber-600 border-amber-300" onClick={() => saveAndApprove('Com Restrição')}>Liberar com Pendência</Button>
                <Button variant="destructive" onClick={() => saveAndApprove('Reprovado')}>Bloquear</Button>
                <Button onClick={() => saveAndApprove('Aprovado')} disabled={overallStatus !== 'Aprovado'} className="text-white" style={{ background: overallStatus === 'Aprovado' ? '#2575D1' : '#94a3b8' }} title={overallStatus !== 'Aprovado' ? 'Todas as análises devem estar aprovadas' : ''}>Salvar e Liberar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
