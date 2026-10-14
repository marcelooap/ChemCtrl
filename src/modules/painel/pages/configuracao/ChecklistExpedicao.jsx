import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Copy, ListChecks } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
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

/**
 * Estado de edição da validade dos testes (`dias` como texto para permitir digitação livre).
 * `destinos`: linhas "destino + prazo" com `key` estável para a lista.
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
      dias: String(p.dias),
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

export default function ChecklistExpedicao() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();

  const [clientes, setClientes] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [itens, setItens] = useState([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [loadingItens, setLoadingItens] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG_FORM);
  const [itensDirty, setItensDirty] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);
  const [destinosMissing, setDestinosMissing] = useState(false);
  const [showDestinoErrors, setShowDestinoErrors] = useState(false);
  const [hadConfig, setHadConfig] = useState(false);

  const dirty = itensDirty || configDirty;
  const resetDirty = useCallback(() => {
    setItensDirty(false);
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
        setItens([]);
        setConfig(DEFAULT_CONFIG_FORM);
        setHadConfig(false);
        resetDirty();
        setLoadingItens(false);
        return;
      }
      setLoadingItens(true);
      try {
        const [rows, savedConfig] = await Promise.all([
          listChecklistExpedicaoItens(clienteId),
          getChecklistExpedicaoConfig(clienteId),
        ]);
        setTableMissing(!isChecklistExpedicaoTableAvailable());
        setConfigMissing(!isChecklistExpedicaoConfigAvailable());
        setDestinosMissing(!isChecklistExpedicaoDestinosAvailable());
        setConfig(toConfigForm(savedConfig));
        setItens(
          rows.map((r) => ({
            id: r.id,
            descricao: r.descricao || '',
          }))
        );
        setHadConfig(rows.length > 0);
        resetDirty();
      } catch (err) {
        console.error('[ChecklistExpedicao] itens:', err);
        toast({
          title: t('painel.configuracao.checklistExpedicao.loadError'),
          description: err?.message,
          variant: 'destructive',
        });
        setItens([]);
        setConfig(DEFAULT_CONFIG_FORM);
        setHadConfig(false);
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

  const handleItensChange = (next) => {
    setItens(next);
    setItensDirty(true);
  };

  const handleUseDefaults = () => {
    const labels = getDefaultChecklistDescricoes(t);
    setItens(labels.map((descricao) => ({ id: createTempItemId(), descricao })));
    setItensDirty(true);
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
      const validation = validateChecklistItens(itens);
      if (!validation.ok) {
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

      const rangeParams = {
        min: VALIDADE_TESTES_PRAZO_MIN_DIAS,
        max: VALIDADE_TESTES_PRAZO_MAX_DIAS,
      };

      // O prazo existe só por destino: ativa a verificação exige ao menos um destino.
      if (config.ativo && config.destinos.length === 0) {
        toast({
          title: t('painel.configuracao.checklistExpedicao.saveError'),
          description: t(
            'painel.configuracao.checklistExpedicao.validadeTestes.destinos.requiredHint'
          ),
          variant: 'destructive',
        });
        return;
      }

      // Destino obrigatório, sem repetição e prazo inteiro positivo. Desativada, as linhas
      // estão ocultas: só as completas são gravadas.
      const destinosValidation = validarPrazosPorDestino(config.destinos);
      if (config.ativo && !destinosValidation.ok) {
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
        }

        const saved = itensDirty
          ? await saveChecklistExpedicao({ clienteId: persisted.id, itens: validation.itens })
          : null;

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
        if (saved) {
          setItens(saved.map((r) => ({ id: r.id, descricao: r.descricao || '' })));
          setHadConfig(saved.length > 0);
        }
        resetDirty();
        setTableMissing(!isChecklistExpedicaoTableAvailable());
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

  const showEmptyConfig =
    selected && !loadingItens && itens.length === 0 && !hadConfig && !itensDirty;

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
          sql: checklistDestinosSql,
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

      <div className="shrink-0 bg-card rounded-xl border border-border shadow-sm p-4">
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

      {selected && !loadingItens ? (
        <div className="shrink-0">
          <ChecklistExpedicaoValidadeTestesConfig
            value={config}
            onChange={handleConfigChange}
            disabled={saving || submitBusy}
            showErrors={showDestinoErrors}
          />
        </div>
      ) : null}

      <div className="flex-1 min-h-0">
        {!selected ? (
          <div className="h-full bg-card rounded-xl border border-border shadow-sm flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
            <ClipboardCheck className="w-10 h-10 opacity-40" />
            <p className="text-sm text-center max-w-sm">
              {t('painel.configuracao.checklistExpedicao.selectClient')}
            </p>
          </div>
        ) : loadingItens ? (
          <div className="h-full bg-card rounded-xl border border-border shadow-sm flex items-center justify-center text-sm text-muted-foreground">
            {t('painel.configuracao.checklistExpedicao.loading')}
          </div>
        ) : showEmptyConfig ? (
          <div className="h-full bg-card rounded-xl border border-border shadow-sm flex flex-col items-center justify-center gap-4 p-8">
            <ListChecks className="w-10 h-10 text-muted-foreground opacity-50" />
            <p className="text-sm text-center text-muted-foreground max-w-md">
              {t('painel.configuracao.checklistExpedicao.noConfig')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" variant="outline" onClick={handleUseDefaults}>
                {t('painel.configuracao.checklistExpedicao.useDefaults')}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  handleItensChange([{ id: createTempItemId(), descricao: '' }])
                }
                className="bg-primary hover:bg-primary/90"
              >
                {t('painel.configuracao.checklistExpedicao.addItem')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full bg-card rounded-xl border border-border shadow-sm p-4 flex flex-col min-h-0">
            <div className="shrink-0 mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                {t('painel.configuracao.checklistExpedicao.itemsTitle')}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('painel.configuracao.checklistExpedicao.itemsHint')}
              </p>
            </div>
            <div className="flex-1 min-h-0">
              <ChecklistExpedicaoItensEditor
                itens={itens}
                onChange={handleItensChange}
                disabled={saving || submitBusy}
              />
            </div>
          </div>
        )}
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
