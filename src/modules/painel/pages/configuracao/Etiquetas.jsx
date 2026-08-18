import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Factory, Search, Tag, Truck } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { useToast } from '@shared/components/ui/use-toast';
import EtiquetaCamposEditor from '@painel/components/configuracao/EtiquetaCamposEditor';
import EtiquetaPreview from '@painel/components/configuracao/EtiquetaPreview';
import {
  ETIQUETA_PREVIEW_MOCK,
  extractDateFormat,
  extractOrientation,
  findConfigInList,
  getDefaultCampos,
  isEtiquetaTableAvailable,
  listEtiquetaClientes,
  listEtiquetaConfigs,
  normalizeCampos,
  saveEtiquetaConfig,
} from '@transbordo/lib/etiquetaConfig';
import etiquetaSql from '@transbordo/sql/026_t_etiqueta_configs.sql?raw';

const CONTEXTO_TAB_TRIGGER_CLASS =
  'gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md';

export default function Etiquetas() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [contexto, setContexto] = useState('industrializacao');
  const [clientes, setClientes] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [campos, setCampos] = useState(() => getDefaultCampos('industrializacao'));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [responsavelTecnico, setResponsavelTecnico] = useState('');
  const [dateFormat, setDateFormat] = useState('dmy');
  const [orientation, setOrientation] = useState('horizontal');
  const [tableMissing, setTableMissing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cli, cfg] = await Promise.all([
        listEtiquetaClientes(),
        listEtiquetaConfigs(),
      ]);
      setClientes(cli);
      setConfigs(cfg);
      setTableMissing(!isEtiquetaTableAvailable());
    } catch (err) {
      console.error('[Etiquetas] load:', err);
      toast({
        title: t('painel.configuracao.etiquetas.loadError'),
        description: err?.message,
        variant: 'destructive',
      });
      setClientes([]);
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredClientes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nome.toLowerCase().includes(q));
  }, [clientes, search]);

  const selected = useMemo(
    () => clientes.find((c) => (c.id || c.nome) === selectedKey) || null,
    [clientes, selectedKey]
  );

  const stateRef = useRef({});
  stateRef.current = { selected, contexto, campos, dirty, responsavelTecnico, dateFormat, orientation };

  const persistCurrent = useCallback(async () => {
    const s = stateRef.current;
    if (!s.dirty || !s.selected) return null;
    const saved = await saveEtiquetaConfig({
      clienteId: s.selected.id,
      clienteNome: s.selected.nome,
      contexto: s.contexto,
      campos: s.campos,
      dateFormat: s.dateFormat,
      orientation: s.orientation,
      responsavelTecnico: s.responsavelTecnico,
    });
    setConfigs((prev) => {
      const without = prev.filter((c) => {
        if (c.id === saved.id) return false;
        if (c.contexto !== saved.contexto) return true;
        const sameId =
          saved.cliente_id && c.cliente_id && String(c.cliente_id) === String(saved.cliente_id);
        const sameNome =
          String(c.cliente_nome || '').trim().toLowerCase() ===
          String(saved.cliente_nome || '').trim().toLowerCase();
        return !(sameId || sameNome);
      });
      return [saved, ...without];
    });
    const rt = String(s.responsavelTecnico || '').trim();
    setClientes((prev) =>
      prev.map((c) =>
        (c.id || c.nome) === (s.selected.id || s.selected.nome)
          ? { ...c, responsavel_tecnico: rt }
          : c
      )
    );
    setTableMissing(!isEtiquetaTableAvailable());
    setDirty(false);
    return saved;
  }, []);

  useEffect(() => {
    if (!selected) {
      setCampos(getDefaultCampos(contexto));
      setResponsavelTecnico('');
      setDateFormat('dmy');
      setOrientation('horizontal');
      setDirty(false);
      return;
    }
    const saved = findConfigInList(configs, {
      clienteId: selected.id,
      clienteNome: selected.nome,
      contexto,
    });
    setCampos(normalizeCampos(saved?.campos, contexto));
    setResponsavelTecnico(String(selected.responsavel_tecnico || '').trim());
    setDateFormat(extractDateFormat(saved));
    setOrientation(extractOrientation(saved));
    setDirty(false);
  }, [selected, contexto, configs]);

  const handleCamposChange = (next) => {
    setCampos(next);
    setDirty(true);
  };

  const handleResponsavelChange = (value) => {
    setResponsavelTecnico(value);
    setDirty(true);
  };

  const handleDateFormatChange = (value) => {
    setDateFormat(value);
    setDirty(true);
  };

  const handleOrientationChange = (value) => {
    setOrientation(value);
    setDirty(true);
  };

  const saveErrorDescription = (err) => {
    if (err?.code === 'RESPONSAVEL_TECNICO_REQUIRED') {
      return t('painel.configuracao.etiquetas.responsavelRequired');
    }
    return err?.message;
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(etiquetaSql);
      toast({ title: t('painel.configuracao.etiquetas.sqlCopied') });
    } catch {
      toast({
        title: t('painel.configuracao.etiquetas.sqlCopyError'),
        variant: 'destructive',
      });
    }
  };

  const switchContext = async (next) => {
    if (next === contexto) return;
    try {
      await persistCurrent();
    } catch (err) {
      toast({
        title: t('painel.configuracao.etiquetas.saveError'),
        description: saveErrorDescription(err),
        variant: 'destructive',
      });
      return;
    }
    setContexto(next);
  };

  const selectClient = async (key) => {
    if (key === selectedKey) return;
    try {
      await persistCurrent();
    } catch (err) {
      toast({
        title: t('painel.configuracao.etiquetas.saveError'),
        description: saveErrorDescription(err),
        variant: 'destructive',
      });
      return;
    }
    setSelectedKey(key);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await persistCurrent();
      toast({ title: t('painel.configuracao.etiquetas.saved') });
    } catch (err) {
      toast({
        title: t('painel.configuracao.etiquetas.saveError'),
        description: saveErrorDescription(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const previewValues = useMemo(
    () => ({
      ...ETIQUETA_PREVIEW_MOCK,
      client: selected?.nome || ETIQUETA_PREVIEW_MOCK.client,
      responsavel_tecnico: responsavelTecnico || '—',
    }),
    [selected, responsavelTecnico]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('painel.configuracao.etiquetas.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('painel.configuracao.etiquetas.subtitle')}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!selected || !dirty || saving}
          className="bg-primary hover:bg-primary/90"
        >
          {saving ? t('common.saving') : t('buttons.save')}
        </Button>
      </div>

      {tableMissing && (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1">{t('painel.configuracao.etiquetas.tableMissingBanner')}</p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 bg-white gap-2"
            onClick={handleCopySql}
          >
            <Copy className="w-4 h-4" />
            {t('painel.configuracao.etiquetas.copySql')}
          </Button>
        </div>
      )}

      <div className="shrink-0 flex flex-wrap items-center gap-3">
        <Tabs value={contexto} onValueChange={switchContext}>
          <TabsList className="bg-muted/60 h-auto p-1">
            <TabsTrigger value="industrializacao" className={CONTEXTO_TAB_TRIGGER_CLASS}>
              <Factory className="w-4 h-4" />
              {t('painel.configuracao.etiquetas.industrializacao')}
            </TabsTrigger>
            <TabsTrigger value="convencional" className={CONTEXTO_TAB_TRIGGER_CLASS}>
              <Truck className="w-4 h-4" />
              {t('painel.configuracao.etiquetas.convencional')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <aside className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-border space-y-2 shrink-0">
            <h2 className="text-sm font-semibold">{t('painel.configuracao.etiquetas.clients')}</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('painel.configuracao.etiquetas.searchClient')}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <p className="px-3 py-8 text-sm text-center text-muted-foreground">
                {t('painel.configuracao.etiquetas.loading')}
              </p>
            ) : filteredClientes.length === 0 ? (
              <div className="px-3 py-8 text-center text-muted-foreground">
                <Tag className="w-7 h-7 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('painel.configuracao.etiquetas.noClients')}</p>
              </div>
            ) : (
              <ul>
                {filteredClientes.map((c) => {
                  const key = c.id || c.nome;
                  const active = selectedKey === key;
                  const hasConfig = Boolean(
                    findConfigInList(configs, {
                      clienteId: c.id,
                      clienteNome: c.nome,
                      contexto,
                    })
                  );
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => selectClient(key)}
                        className={`w-full text-left px-3 py-2.5 text-sm border-b border-border last:border-0 transition-colors ${
                          active
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-muted/50 text-foreground'
                        }`}
                      >
                        <span className="block truncate">{c.nome}</span>
                        {hasConfig && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t('painel.configuracao.etiquetas.configured')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className="min-h-0 min-w-0">
          {!selected ? (
            <div className="h-full bg-card rounded-xl border border-border shadow-sm flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
              <Tag className="w-10 h-10 opacity-40" />
              <p className="text-sm text-center max-w-sm">
                {t('painel.configuracao.etiquetas.selectClient')}
              </p>
            </div>
          ) : (
            <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-0">
              <div className="bg-card rounded-xl border border-border shadow-sm p-3 flex flex-col min-h-0 overflow-hidden">
                <EtiquetaCamposEditor
                  campos={campos}
                  onChange={handleCamposChange}
                  responsavelTecnico={responsavelTecnico}
                  onResponsavelTecnicoChange={handleResponsavelChange}
                  dateFormat={dateFormat}
                  onDateFormatChange={handleDateFormatChange}
                  orientation={orientation}
                  onOrientationChange={handleOrientationChange}
                />
              </div>
              <div className="bg-muted/30 rounded-xl border border-border shadow-sm p-4 flex items-center justify-center overflow-auto">
                <EtiquetaPreview
                  campos={campos}
                  values={previewValues}
                  dateFormat={dateFormat}
                  orientation={orientation}
                  consultaPath={contexto === 'convencional' ? '/consulta-produto' : '/consulta'}
                  emphasis={contexto === 'industrializacao'}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
