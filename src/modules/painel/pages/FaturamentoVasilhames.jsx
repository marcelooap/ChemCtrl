import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@shared/components/ui/use-toast';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { entities } from '@transbordo/services/entities';
import {
  apurarFaturamentoVasilhames,
} from '@painel/lib/faturamentoVasilhames';
import {
  canManageFaturamentoTarifaHistory,
  createFaturamentoTarifaVasilhame,
  currentMonthRange,
  deleteFaturamentoTarifaVasilhame,
  listFaturamentoTarifasVasilhames,
} from '@painel/lib/faturamentoTarifasVasilhames';
import {
  ORIGEM_CAPACIDADE,
  indexCapacidadesByIdentity,
  listCapacidadesNominais,
  upsertCapacidadeNominal,
} from '@painel/lib/vasilhamesCapacidadeNominal';
import { uniqueClientesByNome } from '@painel/lib/recebimentoCatalog';
import FaturamentoFiltros from '@painel/components/faturamento/FaturamentoFiltros';
import FaturamentoVasilhamesTarifasPanel from '@painel/components/faturamento/vasilhames/FaturamentoVasilhamesTarifasPanel';
import FaturamentoVasilhamesKpis from '@painel/components/faturamento/vasilhames/FaturamentoVasilhamesKpis';
import FaturamentoVasilhamesTabela from '@painel/components/faturamento/vasilhames/FaturamentoVasilhamesTabela';
import FaturamentoVasilhamesDetalheModal from '@painel/components/faturamento/vasilhames/FaturamentoVasilhamesDetalheModal';

export default function FaturamentoVasilhames() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const month = useMemo(() => currentMonthRange(), []);
  const [loading, setLoading] = useState(true);
  const [savingTarifa, setSavingTarifa] = useState(false);
  const [savingCapacidade, setSavingCapacidade] = useState(false);

  const [vasilhames, setVasilhames] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [tarifas, setTarifas] = useState([]);
  const [capacidades, setCapacidades] = useState([]);

  const [clienteId, setClienteId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(month.from);
  const [dateTo, setDateTo] = useState(month.to);
  const [viewRow, setViewRow] = useState(null);

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [vasilhamesList, saidasList, clientesList, tarifasList, capacidadesList] =
          await Promise.all([
            entities.vasilhames.list('-created_date'),
            entities.saidas.list('-created_date'),
            entities.clientes.list(),
            listFaturamentoTarifasVasilhames().catch(() => []),
            listCapacidadesNominais().catch(() => []),
          ]);
        setVasilhames(vasilhamesList || []);
        setSaidas(saidasList || []);
        setClientes(uniqueClientesByNome(clientesList || []));
        setTarifas(tarifasList || []);
        setCapacidades(capacidadesList || []);
      } catch (err) {
        console.error('[FaturamentoVasilhames] loadData:', err);
        toast({
          title: t('painel.faturamentoVasilhames.loadErrorTitle'),
          description:
            err?.message || t('painel.faturamentoVasilhames.loadErrorDescription'),
          variant: 'destructive',
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t, toast]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clienteNomeSelecionado = useMemo(() => {
    if (!clienteId) return '';
    const found = clientes.find((c) => String(c.id) === String(clienteId));
    return found?.nome || found?.cliente_nome || '';
  }, [clienteId, clientes]);

  const registryMap = useMemo(
    () => indexCapacidadesByIdentity(capacidades),
    [capacidades]
  );

  const apuracao = useMemo(
    () =>
      apurarFaturamentoVasilhames({
        vasilhames,
        saidas,
        capacidadesConfirmadas: registryMap,
        tarifas,
        periodFrom: dateFrom,
        periodTo: dateTo,
        clienteId,
        clienteNome: clienteNomeSelecionado,
        statusFilter,
        search,
      }),
    [
      vasilhames,
      saidas,
      registryMap,
      tarifas,
      dateFrom,
      dateTo,
      clienteId,
      clienteNomeSelecionado,
      statusFilter,
      search,
    ]
  );

  const canManageHistory = useMemo(
    () => canManageFaturamentoTarifaHistory(user),
    [user]
  );

  // Mantém o modal sincronizado com a apuração após salvar capacidade
  useEffect(() => {
    if (!viewRow?.key) return;
    const next = apuracao.rows.find((r) => r.key === viewRow.key);
    if (next) setViewRow(next);
  }, [apuracao.rows, viewRow?.key]);

  const handleSaveTarifa = async (payload) => {
    setSavingTarifa(true);
    try {
      await createFaturamentoTarifaVasilhame({
        ...payload,
        created_by: user?.nome || user?.full_name || user?.email || user?.id || null,
      });
      const next = await listFaturamentoTarifasVasilhames();
      setTarifas(next || []);
      toast({ title: t('painel.faturamentoVasilhames.tarifas.saved') });
      return true;
    } catch (err) {
      console.error('[FaturamentoVasilhames] saveTarifa:', err);
      toast({
        title: t('painel.faturamentoVasilhames.tarifas.saveError'),
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingTarifa(false);
    }
  };

  const handleDeleteTarifa = async (row) => {
    if (!canManageHistory || !row?.id) return false;
    setSavingTarifa(true);
    try {
      await deleteFaturamentoTarifaVasilhame(row.id);
      const next = await listFaturamentoTarifasVasilhames();
      setTarifas(next || []);
      toast({ title: t('painel.faturamentoVasilhames.tarifas.deleted') });
      return true;
    } catch (err) {
      console.error('[FaturamentoVasilhames] deleteTarifa:', err);
      toast({
        title: t('painel.faturamentoVasilhames.tarifas.deleteError'),
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingTarifa(false);
    }
  };

  const handleSaveCapacidade = async (row, capacidadeLitros) => {
    if (!row || !capacidadeLitros) return false;
    setSavingCapacidade(true);
    try {
      const vasilhameId = row.registroId || row.detail?.tankId || null;

      await upsertCapacidadeNominal({
        placa: row.placa,
        barril: row.barril,
        capacidade_litros: capacidadeLitros,
        origem: ORIGEM_CAPACIDADE.MANUAL,
        confirmada: true,
        vasilhame_id: vasilhameId,
        updated_by: user?.nome || user?.full_name || user?.email || user?.id || null,
        force: true,
      });

      // Espelha no cadastro operacional do tanque quando possível (sem alterar fluxos)
      try {
        if (vasilhameId && entities?.vasilhames?.update) {
          await entities.vasilhames.update(vasilhameId, {
            capacidade: Number(capacidadeLitros),
          });
        }
      } catch (syncErr) {
        console.warn('[FaturamentoVasilhames] sync capacidade t_vasilhames:', syncErr);
      }

      const [nextCaps, nextVasilhames] = await Promise.all([
        listCapacidadesNominais(),
        entities.vasilhames.list('-created_date'),
      ]);
      setCapacidades(nextCaps || []);
      setVasilhames(nextVasilhames || []);
      toast({ title: t('painel.faturamentoVasilhames.modal.capacidadeSaved') });
      return true;
    } catch (err) {
      console.error('[FaturamentoVasilhames] saveCapacidade:', err);
      toast({
        title: t('painel.faturamentoVasilhames.modal.capacidadeSaveError'),
        description: err?.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingCapacidade(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="space-y-3 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.faturamentoVasilhames.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.faturamentoVasilhames.subtitle')}
          </p>
        </div>

        <FaturamentoVasilhamesTarifasPanel
          tarifas={tarifas}
          saving={savingTarifa}
          canManageHistory={canManageHistory}
          onSave={handleSaveTarifa}
          onDelete={handleDeleteTarifa}
        />

        <FaturamentoVasilhamesKpis totals={apuracao.totals} />

        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 border-b border-border/50">
          <FaturamentoFiltros
            clientes={clientes}
            clienteId={clienteId}
            showStatusFilter
            status={statusFilter}
            search={search}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onClienteChange={setClienteId}
            onStatusChange={setStatusFilter}
            onSearchChange={setSearch}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        </div>

        <FaturamentoVasilhamesTabela rows={apuracao.rows} onView={setViewRow} />
      </div>

      <FaturamentoVasilhamesDetalheModal
        row={viewRow}
        open={Boolean(viewRow)}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
        savingCapacidade={savingCapacidade}
        onSaveCapacidade={handleSaveCapacidade}
      />
    </div>
  );
}
