import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Eye, Pencil, Search, Trash2 } from "lucide-react";
import { Input } from "@shared/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/components/ui/alert-dialog";
import { useToast } from "@shared/components/ui/use-toast";
import { Can } from "@industrializacao/lib/rbac/Can";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import { base44 } from "@industrializacao/api/base44Client";
import { entities } from "@transbordo/services/entities";
import { listProdutos } from "@transbordo/lib/cadastroProdutosCentral";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";
import EntradaModal from "@transbordo/components/entrada/EntradaModal";
import ValidacaoViewDialog from "@transbordo/components/validacao/ValidacaoViewDialog";
import ValidacaoOrdemEnvaseEditor from "@painel/components/operacional/ValidacaoOrdemEnvaseEditor";
import {
  atualizarValidacaoIndustrializacao,
  efetivarValidacaoIndustrializacao,
  excluirValidacaoIndustrializacao,
  isValidacaoIndEntrada,
  parseEntradaPayload,
  resumoQuantidadeValidacaoInd,
  toValidacaoViewModel,
} from "@industrializacao/lib/validacaoIndustrializacao";
import { formatNum } from "@transbordo/lib/format";
import { useValidacaoNovas } from "@transbordo/context/ValidacaoNovasContext";

const PERM = "ind_validacao";

function formatNumero(n) {
  const num = Number(n) || 0;
  return String(num).padStart(2, "0");
}

function StatusPill({ status, t }) {
  const isValidado = status === "validado";
  const isProcessando = status === "processando";
  const cls = isValidado
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : isProcessando
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : "bg-amber-100 text-amber-800 border-amber-200";
  const label = isValidado
    ? t("industrializacao.validacao.status.validado")
    : isProcessando
      ? t("industrializacao.validacao.status.processando")
      : t("industrializacao.validacao.status.pendente");
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export default function ValidacaoIndustrializacao() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();
  const { isNew, markAsRead, validacoesRevision } = useValidacaoNovas();

  const [loading, setLoading] = useState(true);
  const [validacoes, setValidacoes] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [search, setSearch] = useState("");
  const [editSaveError, setEditSaveError] = useState("");

  const [viewOpen, setViewOpen] = useState(false);
  const [viewValidacao, setViewValidacao] = useState(null);
  const [viewSaving, setViewSaving] = useState(false);

  const [editValidacao, setEditValidacao] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [validarId, setValidarId] = useState(null);
  const [validating, setValidating] = useState(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [vals, cliens, prods, ents, isos, vascs, trans] = await Promise.all([
        base44.entities.IndValidacao.list("-created_date"),
        entities.clientes.list(),
        listProdutos({ modulo: "INDUSTRIALIZACAO" }),
        entities.estoque.list(),
        listTankas(),
        entities.vasilhames.list(),
        entities.transbordos.list("-created_at"),
      ]);
      setValidacoes(vals || []);
      setClientes(cliens || []);
      setProdutos(prods || []);
      setEntradas(ents || []);
      setIsotanques(isos || []);
      setVasilhames(vascs || []);
      setTransbordos(trans || []);
    } catch (err) {
      console.error("[ValidacaoIndustrializacao] load:", err);
      toast({
        title: t("industrializacao.validacao.errors.loadTitle"),
        description:
          err?.message || t("industrializacao.validacao.errors.loadDescription"),
        variant: "destructive",
      });
    }
    if (!silent) setLoading(false);
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const validacoesRevisionSeen = useRef(validacoesRevision);
  useEffect(() => {
    if (validacoesRevision === validacoesRevisionSeen.current) return;
    validacoesRevisionSeen.current = validacoesRevision;
    loadData({ silent: true });
  }, [validacoesRevision, loadData]);

  const acknowledgeNew = (id) => {
    if (id && isNew(id)) markAsRead(id);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return validacoes;
    return validacoes.filter((v) => {
      const fields = [
        formatNumero(v.numero),
        v.produto_codigo,
        v.produto_nome,
        v.cliente_nome,
        v.lote,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      return fields.some((f) => f.includes(q));
    });
  }, [validacoes, search]);

  const pendentes = useMemo(
    () => validacoes.filter((v) => v.status === "pendente").length,
    [validacoes]
  );
  const validados = useMemo(
    () => validacoes.filter((v) => v.status === "validado").length,
    [validacoes]
  );

  const syncViewAfterUpdate = (updated, id) => {
    if (!viewOpen) return;
    if (viewValidacao?.id === id && updated) {
      setViewValidacao(updated);
    }
  };

  const handleSaveCamposView = async ({
    header,
    granelPayload,
    transbordoPayload,
    openEnvase = false,
    deferPersist = false,
  }) => {
    if (!viewValidacao?.id) return;

    // Alteração de pesagem/volume: abre envase sem gravar. Cancelar = descarta.
    if (deferPersist && openEnvase) {
      const pending = {
        ...viewValidacao,
        ...(header?.quantidade != null ? { quantidade: header.quantidade } : {}),
        ...(header?.unidade_medida
          ? { unidade_medida: header.unidade_medida }
          : {}),
        ...(header?.lote != null ? { lote: header.lote } : {}),
        entrada_payload: granelPayload ?? viewValidacao.entrada_payload,
        granel_payload: granelPayload ?? viewValidacao.granel_payload,
        transbordo_payload: transbordoPayload ?? viewValidacao.transbordo_payload,
      };
      setEditValidacao(pending);
      setEditSaveError("");
      setEditModalOpen(true);
      return;
    }

    setViewSaving(true);
    try {
      const updated = await atualizarValidacaoIndustrializacao({
        id: viewValidacao.id,
        header: header || null,
        ...(granelPayload != null ? { entradaPayload: granelPayload } : {}),
        ...(transbordoPayload != null
          ? { transbordoPayload }
          : {}),
      });
      await loadData({ silent: true });
      setViewValidacao(updated);
      if (openEnvase) {
        setEditValidacao(updated);
        setEditSaveError("");
        setEditModalOpen(true);
      }
      toast({
        title: t("industrializacao.validacao.editSuccessTitle"),
        description: t("industrializacao.validacao.editSuccessDescription"),
      });
    } catch (err) {
      console.error("[ValidacaoIndustrializacao] save campos view:", err);
      throw err;
    } finally {
      setViewSaving(false);
    }
  };

  const handleEditTransbordoFromView = () => {
    if (!viewValidacao || viewValidacao.status !== "pendente") return;
    setEditValidacao(viewValidacao);
    setEditSaveError("");
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (entradaPayload) => {
    if (!editValidacao) return;
    const updated = await atualizarValidacaoIndustrializacao({
      id: editValidacao.id,
      entradaPayload,
    });
    await loadData({ silent: true });
    syncViewAfterUpdate(updated, editValidacao.id);
    setEditModalOpen(false);
    setEditValidacao(null);
    toast({
      title: t("industrializacao.validacao.editSuccessTitle"),
      description: t("industrializacao.validacao.editSuccessDescription"),
    });
  };

  const handleSaveEditTransbordo = async (
    transbordoPayload,
    granelFromEditor = null
  ) => {
    if (!editValidacao) return;
    setEditSaveError("");
    try {
      const nextEntrada = granelFromEditor
        ? granelFromEditor
        : parseEntradaPayload(editValidacao.entrada_payload);
      const syncedEntrada = nextEntrada
        ? {
            ...nextEntrada,
            data: transbordoPayload.data || nextEntrada.data,
            cliente_nome:
              transbordoPayload.cliente_nome || nextEntrada.cliente_nome,
            produto_nome:
              transbordoPayload.produto_nome || nextEntrada.produto_nome,
            produto_codigo:
              transbordoPayload.produto_codigo || nextEntrada.produto_codigo,
            densidade: transbordoPayload.densidade || nextEntrada.densidade,
          }
        : null;
      const updated = await atualizarValidacaoIndustrializacao({
        id: editValidacao.id,
        entradaPayload: syncedEntrada,
        transbordoPayload,
      });
      await loadData({ silent: true });
      syncViewAfterUpdate(updated, editValidacao.id);
      setEditModalOpen(false);
      setEditValidacao(null);
      toast({
        title: t("industrializacao.validacao.editSuccessTitle"),
        description: t("industrializacao.validacao.editSuccessDescription"),
      });
    } catch (err) {
      setEditSaveError(
        err?.message || t("industrializacao.validacao.errors.editGeneric")
      );
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await excluirValidacaoIndustrializacao(deleteId);
      await loadData({ silent: true });
      toast({ title: t("industrializacao.validacao.deleteSuccessTitle") });
    } catch (err) {
      toast({
        title: t("industrializacao.validacao.errors.deleteTitle"),
        description: err?.message || t("industrializacao.validacao.errors.deleteDescription"),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const handleConfirmValidar = async () => {
    if (!validarId) return;
    setValidating(true);
    try {
      await efetivarValidacaoIndustrializacao({
        id: validarId,
        validadoPor: user
          ? { id: user.id, nome: user.nome || user.email || null }
          : null,
      });
      await loadData({ silent: true });
      toast({
        title: t("industrializacao.validacao.validateSuccessTitle"),
        description: t("industrializacao.validacao.validateSuccessDescription"),
      });
    } catch (err) {
      toast({
        title: t("industrializacao.validacao.errors.validateTitle"),
        description: err?.message || t("industrializacao.validacao.errors.validateDescription"),
        variant: "destructive",
      });
    } finally {
      setValidating(false);
      setValidarId(null);
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("industrializacao.validacao.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("industrializacao.validacao.subtitle", {
              total: validacoes.length,
              pendentes,
              validados,
            })}
          </p>
        </div>
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("industrializacao.validacao.searchPlaceholder")}
            className="pl-10 bg-card"
          />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full min-w-[1000px] table-fixed text-sm">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[110px]" />
              <col className="w-[168px]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.id")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.operador")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.produto")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.cliente")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.lote")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap text-right">
                  {t("industrializacao.validacao.table.quantidade")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">
                  {t("industrializacao.validacao.table.validar")}
                </th>
                <th className="px-3 py-3 font-medium whitespace-nowrap sticky right-0 bg-muted/40 z-20 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                  {t("industrializacao.validacao.table.acoes")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    {t("industrializacao.validacao.empty")}
                  </td>
                </tr>
              ) : (
                filtered.map((v, i) => {
                  const produtoLabel = v.produto_codigo
                    ? `${v.produto_codigo} - ${v.produto_nome || "-"}`
                    : v.produto_nome || "-";
                  const isPendente = v.status === "pendente";
                  const qtd = resumoQuantidadeValidacaoInd(v);
                  const qtdLabel = qtd.quantidade
                    ? `${formatNum(Number(qtd.quantidade), 2)}${
                        qtd.unidade_medida ? ` ${qtd.unidade_medida}` : ""
                      }`
                    : "-";
                  const rowBg = i % 2 === 1 ? "bg-muted/20" : "bg-card";
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors group ${rowBg}`}
                    >
                      <td className="px-3 py-3 align-middle font-semibold text-primary whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          #{formatNumero(v.numero)}
                          {isNew(v.id) ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none bg-primary/10 text-primary">
                              Novo
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-foreground">
                        <span
                          className="block truncate"
                          title={v.criado_por_nome || ""}
                        >
                          {v.criado_por_nome || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-foreground">
                        <span className="block truncate" title={produtoLabel}>
                          {produtoLabel}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-muted-foreground">
                        <span
                          className="block truncate"
                          title={v.cliente_nome || ""}
                        >
                          {v.cliente_nome || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-foreground">
                        <span className="block truncate" title={v.lote || ""}>
                          {v.lote || "-"}
                        </span>
                      </td>
                      <td
                        className="px-3 py-3 align-middle text-foreground font-medium whitespace-nowrap text-right tabular-nums"
                        title={qtdLabel}
                      >
                        {qtdLabel}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <StatusPill status={v.status} t={t} />
                      </td>
                      <td
                        className={`px-3 py-3 align-middle sticky right-0 z-10 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)] ${rowBg} group-hover:bg-muted/40`}
                      >
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <Can permission={`${PERM}.view`}>
                            <button
                              type="button"
                              onClick={() => {
                                acknowledgeNew(v.id);
                                setViewValidacao(v);
                                setViewOpen(true);
                              }}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title={t("industrializacao.validacao.actions.view")}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </Can>
                          {isPendente && (
                            <Can permission={`${PERM}.edit`}>
                              <button
                                type="button"
                                onClick={() => {
                                  acknowledgeNew(v.id);
                                  if (v.status !== "pendente") return;
                                  setEditValidacao(v);
                                  setEditSaveError("");
                                  setEditModalOpen(true);
                                }}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                title={t("industrializacao.validacao.actions.edit")}
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            </Can>
                          )}
                          {isPendente && (
                            <Can permission={`${PERM}.delete`}>
                              <button
                                type="button"
                                onClick={() => setDeleteId(v.id)}
                                className="text-red-400 hover:text-red-600 transition-colors"
                                title={t("industrializacao.validacao.actions.delete")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </Can>
                          )}
                          {isPendente && (
                            <Can permission={`${PERM}.validate`}>
                              <button
                                type="button"
                                onClick={() => {
                                  acknowledgeNew(v.id);
                                  setValidarId(v.id);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {t("industrializacao.validacao.actions.validate")}
                              </button>
                            </Can>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            {t("industrializacao.validacao.summary.total")}:{" "}
            <span className="font-medium text-foreground">{validacoes.length}</span>
          </span>
          <span className="text-muted-foreground">
            {t("industrializacao.validacao.status.pendente")}:{" "}
            <span className="font-medium text-amber-700">{pendentes}</span>
          </span>
          <span className="text-muted-foreground">
            {t("industrializacao.validacao.status.validado")}:{" "}
            <span className="font-medium text-emerald-700">{validados}</span>
          </span>
        </div>
      </div>

      <ValidacaoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewValidacao(null);
        }}
        validacao={toValidacaoViewModel(viewValidacao)}
        produtos={produtos}
        entradas={entradas}
        canEdit
        saving={viewSaving}
        onSaveCampos={handleSaveCamposView}
        onEditTransbordo={handleEditTransbordoFromView}
      />

      {isValidacaoIndEntrada(editValidacao) ? (
        <EntradaModal
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setEditValidacao(null);
          }}
          onSave={handleSaveEdit}
          editingEntrada={parseEntradaPayload(editValidacao?.entrada_payload)}
          clientes={clientes}
          produtos={produtos}
          hideIrParaTransbordo
          hidePesagemGranel
          lockTipo
          allowedTipos={["embalado", "vasilhame"]}
          submitLabel={t("industrializacao.validacao.actions.edit")}
        />
      ) : (
        <ValidacaoOrdemEnvaseEditor
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setEditValidacao(null);
            setEditSaveError("");
          }}
          onSave={handleSaveEditTransbordo}
          validacao={toValidacaoViewModel(editValidacao)}
          isotanques={isotanques}
          vasilhames={vasilhames}
          transbordos={transbordos}
          externalError={editSaveError}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && !deleting && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("industrializacao.validacao.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("industrializacao.validacao.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel", "Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("industrializacao.validacao.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!validarId} onOpenChange={(v) => !v && !validating && setValidarId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("industrializacao.validacao.validateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("industrializacao.validacao.validateConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={validating}>{t("common.cancel", "Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={validating}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmValidar();
              }}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {validating
                ? t("common.processing")
                : t("industrializacao.validacao.actions.validate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
