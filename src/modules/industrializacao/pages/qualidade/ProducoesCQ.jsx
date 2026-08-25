import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@industrializacao/api/base44Client';
import { useRealtimeEntity } from '@industrializacao/hooks/useRealtimeEntity';
import { Search, FileCheck } from 'lucide-react';
import { Input } from '@shared/components/ui/input';
import { Button } from '@shared/components/ui/button';
import ProductionCard from '@industrializacao/components/ProductionCard';
import QualityAnalysisDialog from '@industrializacao/components/qualidade/QualityAnalysisDialog';

export default function ProducoesCQ() {
  const { t } = useTranslation();
  const { data: allProds, loading } = useRealtimeEntity('Production', () => base44.entities.Production.list('-created_date', 500));
  const { data: tests } = useRealtimeEntity('QualityTest', () => base44.entities.QualityTest.list('-created_date', 500));
  const { data: results, reload: load } = useRealtimeEntity('QualityResult', () => base44.entities.QualityResult.list('-created_date', 500));
  const [search, setSearch] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedProd, setSelectedProd] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const productions = useMemo(() =>
    allProds.filter(p =>
      p.status === 'Qualidade' ||
      (p.bypass_qc && ['Envase', 'Finalizado'].includes(p.status) && !results.some(res => res.production_id === p.id))
    ),
    [allProds, results]
  );

  const openAnalysis = useCallback((prod) => {
    setSelectedProd(prod);
    setShowAnalysis(true);
  }, []);

  useEffect(() => {
    const prodId = searchParams.get('prod');
    if (prodId && !loading && !showAnalysis) {
      const prod = productions.find(p => p.id === prodId);
      if (prod) {
        openAnalysis(prod);
        searchParams.delete('prod');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, loading, productions, showAnalysis, openAnalysis, setSearchParams]);

  const selectedTest = selectedProd ? tests.find(item => item.product === selectedProd.product) : null;
  const selectedResult = selectedProd ? results.find(r => r.production_id === selectedProd.id) : null;

  const filtered = productions.filter(p => {
    const q = search.toLowerCase();
    return !q || [p.op_number, p.product, p.client].some(v => (v || '').toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('quality.producoesCq.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('quality.producoesCq.subtitle', { count: productions.length })}</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t('common.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(prod => (
            <ProductionCard key={prod.id} prod={prod}>
              <Button onClick={() => openAnalysis(prod)} className="w-full text-white" style={{ background: '#1e40af' }}>
                <FileCheck className="w-3.5 h-3.5 mr-1.5" /> {t('quality.producoesCq.analyze')}
              </Button>
            </ProductionCard>
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-1">{t('quality.producoesCq.empty')}</p>
        </div>
      )}

      <QualityAnalysisDialog
        open={showAnalysis}
        onOpenChange={setShowAnalysis}
        production={selectedProd}
        qualityTest={selectedTest}
        existingResult={selectedResult}
        onSaved={load}
      />
    </div>
  );
}
