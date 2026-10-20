import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Copy, ListChecks } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import SearchableSelect from '@transbordo/components/cadastro/SearchableSelect';
import { useSubmitGuard } from '@/shared/hooks/useSubmitGuard';
import { useUnsavedChangesGuard } from '@/shared/hooks/useUnsavedChangesGuard';
import ChecklistExpedicaoItensEditor, {
  validateChecklistItens,
} from '@painel/components/configuracao/ChecklistExpedicaoItensEditor';
import ChecklistExpedicaoValidadeTestesConfig from '@painel/components/configuracao/ChecklistExpedicaoValidadeTestesConfig';
import {
  DEFAULT_VALIDADE_TESTES_CONFIG,
  createTempItemId,
  getChecklistExpedicaoConfig,
  getDefaultChecklistDescricoes,
  isChecklistExpedicaoConfigAvailable,
  isChecklistExpedicaoDestinosAvailable,
  isChecklistExpedicaoTableAvailable,
  isChecklistExpedicaoTanqueVazioAvailable,
  isChecklistExpedicaoTestesAvailable,
  listChecklistExpedicaoClientes,
  listChecklistExpedicaoItens,
  saveChecklistExpedicao,
  saveChecklistExpedicaoConfig,
} from '@painel/lib/checklistExpedicaoConfig';
import {
  VALIDADE_TESTES_PRAZO_MAX_DIAS,
  VALIDADE_TESTES_PRAZO_MIN_DIAS,
  normalizePrazoDias,
  parsePrazoDias,
  validarPrazosPorDestino,
} from '@painel/lib/validadeTestesTanque';
import { persistClienteSelecionado } from '@painel/lib/saidaClientes';
import checklistSql from '@transbordo/sql/039_t_checklist_expedicao_itens.sql?raw';
import checklistConfigSql from '@transbordo/sql/040_t_checklist_expedicao_config.sql?raw';
import checklistDestinosSql from '@transbordo/sql/042_t_checklist_expedicao_validade_destinos.sql?raw';
import checklistDestinosColorSql from '@transbordo/sql/043_t_checklist_expedicao_validade_destinos_color_cod.sql?raw';
import checklistTestesSql from '@transbordo/sql/044_t_checklist_expedicao_validade_testes.sql?raw';
import checklistTanqueVazioSql from '@transbordo/sql/051_t_checklist_expedicao_tanque_vazio.sql?raw';

/**
 * Estado de edição da validade dos testes (`dias` como texto para permitir digitação livre).
 * `destinos`: destino, color cod e os testes (nome + prazo) daquele destino.
 */
const DEFAULT_CONFIG_FORM = {
  ativo: DEFAULT_VALIDADE_TESTES_CONFIG.ativo,
  dias: String(DEFAULT_VALIDADE_TESTES_CONFIG.dias),
  destinos: [],
};

function toConfigForm(config) {
  return {
    ativo: Boolean(config?.ativo),
    dias: String(normalizePrazoDias(config?.dias)),
    destinos: (config?.prazosPorDestino || []).map((p) => ({
      key: createTempItemId(),
      destino: p.destino,
      color_cod: p.color_cod || '',
      testes: (p.testes || []).map((teste) => ({
        key: createTempItemId(),
        nome: teste.nome,
        dias: String(teste.dias),
      })),
    })),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clienteOptionKey(c) {
  if (!c) return null;
  if (c.id != null && String(c.id).trim() !== '') return String(c.id);
  return String(c.nome || '').trim().toLowerCase() || null;
}

function isPersistedClienteId(id) {
  return UUID_RE.test(String(id || ''));
}

function toItemForm(rows = []) {
  return (rows || []).map((r) => ({
    id: r.id,
    descricao: r.descricao || '',
  }));
}

const TIPO_TAB_TRIGGER_CLASS =
  'gap-2 px-4 py-2 text-sm font-semibold bg-white text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

export default function ChecklistExpedicao() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();

  const [clientes, setClientes] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [itensCheio, setItensCheio] = useState([]);
  const [itensVazio, setItensVazio] = useState([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [loadingItens, setLoadingItens] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG_FORM);
  const [itensCheioDirty, setItensCheioDirty] = useState(false);
  const [itensVazioDirty, setItensVazioDirty] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);
  const [destinosMissing, setDestinosMissing] = useState(false);
  const [testesMissing, setTestesMissing] = useState(false);
  const [tanqueVazioMissing, setTanqueVazioMissing] = useState(false);
  const [showDestinoErrors, setShowDestinoErrors] = useState(false);
  const [hadItensCheio, setHadItensCheio] = useState(false);
  const [hadItensVazio, setHadItensVazio] = useState(false);
  /** Aba em edição: os dois checklists do cliente permanecem cadastrados. */
  const [tipoCarga, setTipoCarga] = useState('cheio');

  const dirty = itensCheioDirty || itensVazioDirty || configDirty;
  const resetDirty = useCallback(() => {
    setItensCheioDirty(false);
    setItensVazioDirty(false);
    setConfigDirty(false);
    setShowDestinoErrors(false);
  }, []);

  const {
    discardDialog,
    confirmDiscard,
    cancelDiscard,
    requestProceed,
  } = useUnsavedChangesGuard(dirty);

  const selected = useMemo(
    () => clientes.find((c) => clienteOptionKey(c) === String(selectedKey)) || null,
    [clientes, selectedKey]
  );

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      const list = await listChecklistExpedicaoClientes();
      setClientes(list);
    } catch (err) {
      console.error('[ChecklistExpedicao] clientes:', err);
      toast({
        title: t('painel.configuracao.checklistExpedicao.loadError'),
        description: err?.message,
        variant: 'destructive',
      });
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadClientes();
  }, [loadClientes]);

  const loadItens = useCallback(
    async (clienteId) => {
      if (!isPersistedClienteId(clienteId)) {
        setItensCheio([]);
        setItensVazio([]);
        setConfig(DEFAULT_CONFIG_FORM);
        setHadItensCheio(false);
        setHadItensVazio(false);
        resetDirty();
        setLoadingItens(false);
        return;
      }
      setLoadingItens(true);
      try {
        const [rowsCheio, rowsVazio, savedConfig] = await Promise.all([
          listChecklistExpedicaoItens(clienteId, { tanqueVazio: false }),
          listChecklistExpedicaoItens(clienteId, { tanqueVazio: true }),
          getChecklistExpedicaoConfig(clienteId),
        ]);
        setTableMissing(!isChecklistExpedicaoTableAvailable());
        setConfigMissing(!isChecklistExpedicaoConfigAvailable());
        setDestinosMissing(!isChecklistExpedicaoDestinosAvailable());
        setTestesMissing(!isChecklistExpedicaoTestesAvailable());
        setTanqueVazioMissing(!isChecklistExpedicaoTanqueVazioAvailable());
        setConfig(toConfigForm(savedConfig));
        setItensCheio(toItemForm(rowsCheio));
        setItensVazio(toItemForm(rowsVazio));
        setHadItensCheio(rowsCheio.length > 0);
        setHadItensVazio(rowsVazio.length > 0);
        resetDirty();
      } catch (err) {
        console.error('[ChecklistExpedicao] itens:', err);
        toast({
          title: t('painel.configuracao.checklistExpedicao.loadError'),
          description: err?.message,
          variant: 'destructive',
        });
        setItensCheio([]);
        setItensVazio([]);
        setConfig(DEFAULT_CONFIG_FORM);
        setHadItensCheio(false);
        setHadItensVazio(false);
        resetDirty();
      } finally {
        setLoadingItens(false);
      }
    },
    [resetDirty, t, toast]
  );

  useEffect(() => {
    loadItens(selected?.id);
  }, [selected?.id, loadItens]);

  const selectClient = (option) => {
    const key = clienteOptionKey(option);
    if (!key || key === String(selectedKey)) return;
    requestProceed(() => {
      resetDirty();
      setSelectedKey(key);
    });
  };

  const handleItensCheioChange = (next) => {
    setItensCheio(next);
    setItensCheioDirty(true);
  };

  const handleItensVazioChange = (next) => {
    setItensVazio(next);
    setItensVazioDirty(true);
  };

  const handleUseDefaults = () => {
    const labels = getDefaultChecklistDescricoes(t);
    setItensCheio(labels.map((descricao) => ({ id: createTempItemId(), descricao })));
    setItensCheioDirty(true);
  };

  const handleConfigChange = (next) => {
    setConfig(next);
    setConfigDirty(true);
  };

  const handleCopySql = async (sql) => {
    try {
      await navigator.clipboard.writeText(sql);
      toast({ title: t('painel.configuracao.checklistExpedicao.sqlCopied') });
    } catch {
      toast({
        title: t('painel.configuracao.checklistExpedicao.sqlCopyError'),
        variant: 'destructive',
      });
    }
  };

  const handleSave = () =>
    runSubmit(async () => {
      if (!selected?.nome) return;

      const itemChecks = [
        ['cheio', itensCheio, itensCheioDirty],
        ['vazio', itensVazio, itensVazioDirty],
      ];
      // Valida primeiro a aba visível, para o aviso corresponder ao que está na tela.
      if (tipoCarga === 'vazio') itemChecks.reverse();

      const validated = { cheio: { ok: true, itens: itensCheio }, vazio: { ok: true, itens: itensVazio } };
      for (const [kind, list, isDirty] of itemChecks) {
        if (!isDirty) continue;
        const validation = validateChecklistItens(list);
        validated[kind] = validation;
        if (!validation.ok) {
          setTipoCarga(kind);
          toast({
            title: t('painel.configuracao.checklistExpedicao.saveError'),
            description:
              validation.code === 'DUPLICATE_DESCRICAO'
                ? t('painel.configuracao.checklistExpedicao.duplicateHint')
                : t('painel.configuracao.checklistExpedicao.emptyHint'),
            variant: 'destructive',
          });
          return;
        }
      }

      const rangeParams = {
        min: VALIDADE_TESTES_PRAZO_MIN_DIAS,
        max: VALIDADE_TESTES_PRAZO_MAX_DIAS,
      };

      // Validade dos testes pertence ao tanque cheio. Só bloqueia o save quando
      // essa configuração foi alterada ou está visível na aba atual.
      let destinosValidation = { ok: true, items: [] };
      if (configDirty || tipoCarga === 'cheio') {
        if (config.ativo && config.destinos.length === 0) {
          setTipoCarga('cheio');
          toast({
            title: t('painel.configuracao.checklistExpedicao.saveError'),
            description: t(
              'painel.configuracao.checklistExpedicao.validadeTestes.destinos.requiredHint'
            ),
            variant: 'destructive',
          });
          return;
        }

        destinosValidation = validarPrazosPorDestino(config.destinos);
        if (config.ativo && !destinosValidation.ok) {
          setTipoCarga('cheio');
          setShowDestinoErrors(true);
          toast({
            title: t('painel.configuracao.checklistExpedicao.saveError'),
            description: t(
              'painel.configuracao.checklistExpedicao.validadeTestes.destinos.invalidHint',
              rangeParams
            ),
            variant: 'destructive',
          });
          return;
        }
      }

      setSaving(true);
      try {
        // Garante UUID em t_clientes (clientes só da Industrialização entram com id temporário).
        const persisted = await persistClienteSelecionado(selected.id, selected.nome);
        if (!persisted?.id) {
          throw new Error(t('painel.configuracao.checklistExpedicao.selectClient'));
        }

        if (configDirty) {
          const savedConfig = await saveChecklistExpedicaoConfig({
            clienteId: persisted.id,
            ativo: config.ativo,
            // Coluna legada obrigatória no banco; não é mais usada nem exibida.
            dias: parsePrazoDias(config.dias) ?? DEFAULT_VALIDADE_TESTES_CONFIG.dias,
            prazosPorDestino: destinosValidation.items,
          });
          setConfig(toConfigForm(savedConfig));
          setConfigDirty(false);
          setConfigMissing(!isChecklistExpedicaoConfigAvailable());
          setDestinosMissing(!isChecklistExpedicaoDestinosAvailable());
          setTestesMissing(!isChecklistExpedicaoTestesAvailable());
        }

        if (itensCheioDirty) {
          const savedCheio = await saveChecklistExpedicao({
            clienteId: persisted.id,
            itens: validated.cheio.itens,
            tanqueVazio: false,
          });
          setItensCheio(toItemForm(savedCheio));
          setHadItensCheio(savedCheio.length > 0);
          setItensCheioDirty(false);
        }

        if (itensVazioDirty) {
          const savedVazio = await saveChecklistExpedicao({
            clienteId: persisted.id,
            itens: validated.vazio.itens,
            tanqueVazio: true,
          });
          setItensVazio(toItemForm(savedVazio));
          setHadItensVazio(savedVazio.length > 0);
          setItensVazioDirty(false);
        }

        const nextKey = String(persisted.id);
        setClientes((prev) => {
          const without = prev.filter(
            (c) =>
              clienteOptionKey(c) !== String(selectedKey) &&
              String(c.id) !== nextKey &&
              String(c.nome || '').trim().toLowerCase() !==
                String(persisted.nome || selected.nome).trim().toLowerCase()
          );
          return [
            ...without,
            { id: persisted.id, nome: persisted.nome || selected.nome },
          ].sort((a, b) =>
            String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' })
          );
        });
        setSelectedKey(nextKey);
        resetDirty();
        setTableMissing(!isChecklistExpedicaoTableAvailable());
        setTanqueVazioMissing(!isChecklistExpedicaoTanqueVazioAvailable());
        toast({ title: t('painel.configuracao.checklistExpedicao.saved') });
      } catch (err) {
        if (String(err?.message || '').includes('039_t_checklist')) {
          setTableMissing(true);
        }
        if (String(err?.message || '').includes('040_t_checklist')) {
          setConfigMissing(true);
        }
        if (String(err?.message || '').includes('042_t_checklist')) {
          setDestinosMissing(true);
        }
        if (String(err?.message || '').includes('044_t_checklist')) {
          setTestesMissing(true);
        }
        if (String(err?.message || '').includes('051_t_checklist')) {
          setTanqueVazioMissing(true);
        }
        toast({
          title: t('painel.configuracao.checklistExpedicao.saveError'),
          description: err?.message,
          variant: 'destructive',
        });
      } finally {
        setSaving(false);
      }
    });

  const canSave =
    Boolean(selected) && dirty && !saving && !submitBusy && !loadingItens;

  const editingLocked = saving || submitBusy;
  const isVazioTab = tipoCarga === 'vazio';
  const activeItens = isVazioTab ? itensVazio : itensCheio;
  const activeHadItens = isVazioTab ? hadItensVazio : hadItensCheio;
  const activeItensDirty = isVazioTab ? itensVazioDirty : itensCheioDirty;
  const showEmptyConfig =
    selected &&
    !loadingItens &&
    activeItens.length === 0 &&
    !activeHadItens &&
    !activeItensDirty;

  const handleActiveItensChange = isVazioTab
    ? handleItensVazioChange
    : handleItensCheioChange;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.configuracao.checklistExpedicao.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.configuracao.checklistExpedicao.subtitle')}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="bg-primary hover:bg-primary/90"
        >
          {saving || submitBusy
            ? t('common.saving')
            : t('painel.configuracao.checklistExpedicao.save')}
        </Button>
      </div>

      {[
        { missing: tableMissing, messageKey: 'tableMissingBanner', sql: checklistSql },
        {
          missing: configMissing,
          messageKey: 'validadeTestes.tableMissingBanner',
          sql: checklistConfigSql,
        },
        {
          // Só faz sentido instalar os prazos por destino depois da configuração (040).
          missing: destinosMissing && !configMissing,
          messageKey: 'validadeTestes.destinos.tableMissingBanner',
          sql: `${checklistDestinosSql}\n\n${checklistDestinosColorSql}`,
        },
        {
          missing: testesMissing && !destinosMissing && !configMissing,
          messageKey: 'validadeTestes.testesColumnMissingBanner',
          sql: checklistTestesSql,
        },
        {
          missing: tanqueVazioMissing && !tableMissing,
          messageKey: 'tanqueVazio.tableMissingBanner',
          sql: checklistTanqueVazioSql,
        },
      ]
        .filter((banner) => banner.missing)
        .map((banner) => (
          <div
            key={banner.messageKey}
            className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <p className="flex-1">
              {t(`painel.configuracao.checklistExpedicao.${banner.messageKey}`)}
            </p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 bg-white gap-2"
              onClick={() => handleCopySql(banner.sql)}
            >
              <Copy className="w-4 h-4" />
              {t('painel.configuracao.checklistExpedicao.copySql')}
            </Button>
          </div>
        ))}

      <div className="shrink-0 bg-card rounded-xl border border-border shadow-sm p-4 space-y-3">
        <div>
          <Label htmlFor="checklist-expedicao-cliente" className="text-sm font-medium">
            {t('painel.configuracao.checklistExpedicao.clientLabel')}
          </Label>
          <div className="mt-1.5 max-w-lg">
            <SearchableSelect
              selectOnly
              options={clientes}
              value={selected?.nome || ''}
              onChange={(_label, option) => {
                if (option) selectClient(option);
              }}
              getOptionLabel={(o) => o.nome}
              getOptionValue={(o) => clienteOptionKey(o)}
              placeholder={
                loadingClientes
                  ? t('painel.configuracao.checklistExpedicao.loading')
                  : t('painel.configuracao.checklistExpedicao.searchClient')
              }
              disabled={loadingClientes || saving}
              ariaLabel={t('painel.configuracao.checklistExpedicao.clientLabel')}
            />
          </div>
        </div>
        {selected ? (
          <div className="border-t border-border pt-3 space-y-2">
            <Tabs value={tipoCarga} onValueChange={setTipoCarga}>
              <TabsList
                aria-label={t('painel.configuracao.checklistExpedicao.tipoCarga.label')}
                className="h-auto p-1 gap-1 bg-muted/80 border border-border shadow-sm w-full sm:w-fit"
              >
                {[
                  {
                    value: 'cheio',
                    label: t('painel.configuracao.checklistExpedicao.tipoCarga.cheio'),
                    count: itensCheio.length,
                    unsaved: itensCheioDirty || configDirty,
                  },
                  {
                    value: 'vazio',
                    label: t('painel.configuracao.checklistExpedicao.tipoCarga.vazio'),
                    count: itensVazio.length,
                    unsaved: itensVazioDirty,
                  },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    disabled={editingLocked || loadingItens}
                    className={`${TIPO_TAB_TRIGGER_CLASS} flex-1 sm:flex-none`}
                  >
                    {tab.label}
                    {!loadingItens ? (
                      <span
                        className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                          tipoCarga === tab.value
                            ? 'bg-white/20 text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                        aria-label={t(
                          'painel.configuracao.checklistExpedicao.tipoCarga.count',
                          { count: tab.count }
                        )}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                    {tab.unsaved ? (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                        title={t('painel.configuracao.checklistExpedicao.tipoCarga.unsaved')}
                      />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {t('painel.configuracao.checklistExpedicao.tipoCarga.hint')}
            </p>
          </div>
        ) : null}
      </div>

      {/* Cliente fica fixo no topo; validade dos testes e itens rolam juntos. */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 pb-1">
        {selected && !loadingItens && !isVazioTab ? (
          <ChecklistExpedicaoValidadeTestesConfig
            value={config}
            onChange={handleConfigChange}
            disabled={editingLocked}
            showErrors={showDestinoErrors}
          />
        ) : null}

        <div>
          {!selected ? (
            <div className="min-h-[16rem] bg-card rounded-xl border border-border shadow-sm flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
              <ClipboardCheck className="w-10 h-10 opacity-40" />
              <p className="text-sm text-center max-w-sm">
                {t('painel.configuracao.checklistExpedicao.selectClient')}
              </p>
            </div>
          ) : loadingItens ? (
            <div className="min-h-[16rem] bg-card rounded-xl border border-border shadow-sm flex items-center justify-center text-sm text-muted-foreground">
              {t('painel.configuracao.checklistExpedicao.loading')}
            </div>
          ) : showEmptyConfig ? (
            <div className="min-h-[16rem] bg-card rounded-xl border border-border shadow-sm flex flex-col items-center justify-center gap-4 p-8">
              <ListChecks className="w-10 h-10 text-muted-foreground opacity-50" />
              <p className="text-sm text-center text-muted-foreground max-w-md">
                {isVazioTab
                  ? t('painel.configuracao.checklistExpedicao.tanqueVazio.noConfig')
                  : t('painel.configuracao.checklistExpedicao.noConfig')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {!isVazioTab ? (
                  <Button type="button" variant="outline" onClick={handleUseDefaults}>
                    {t('painel.configuracao.checklistExpedicao.useDefaults')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() =>
                    handleActiveItensChange([{ id: createTempItemId(), descricao: '' }])
                  }
                  className="bg-primary hover:bg-primary/90"
                >
                  {t('painel.configuracao.checklistExpedicao.addItem')}
                </Button>
              </div>
            </div>
          ) : (
            <div
              className={`bg-card rounded-xl border shadow-sm p-4 ${
                isVazioTab ? 'border-sky-200' : 'border-border'
              }`}
            >
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {isVazioTab
                    ? t('painel.configuracao.checklistExpedicao.tanqueVazio.itemsTitle')
                    : t('painel.configuracao.checklistExpedicao.itemsTitle')}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isVazioTab
                    ? t('painel.configuracao.checklistExpedicao.tanqueVazio.itemsHint')
                    : t('painel.configuracao.checklistExpedicao.itemsHint')}
                </p>
              </div>
              <ChecklistExpedicaoItensEditor
                itens={activeItens}
                onChange={handleActiveItensChange}
                disabled={editingLocked}
              />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={discardDialog.open}
        onOpenChange={(v) => {
          if (!v) cancelDiscard();
        }}
        title={t('painel.configuracao.checklistExpedicao.discardTitle')}
        message={t('painel.configuracao.checklistExpedicao.discardConfirm')}
        confirmLabel={t('painel.configuracao.checklistExpedicao.discardConfirmAction')}
        confirmColor="#dc2626"
        onConfirm={async () => {
          confirmDiscard();
        }}
      />
    </div>
  );
}
