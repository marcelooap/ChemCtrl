import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import OrdemTransbordoEnvaseModal from "@painel/components/operacional/OrdemTransbordoEnvaseModal";
import {
  buildEnvaseEditModelFromValidacao,
  buildGranelPrefillFromPayload,
} from "@transbordo/lib/validacaoTransbordo";
import {
  formatQuantidade,
  parseDensidade,
  roundVolume,
} from "@transbordo/lib/format";
import { loteToLitros } from "@transbordo/lib/conversao";
import { matchesProdutoOperacional } from "@transbordo/lib/produtoMatch";
import {
  computeEstoqueQuantidadesPorLocal,
  getEstoqueUnidadeEntrada,
  isEstoqueEmbalado,
  isUnidadeVolumeEntrada,
} from "@transbordo/lib/estoqueSaldo";
import { Button } from "@shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import { UNIDADES } from "@transbordo/components/entrada/LoteBlock";

/** Saldo do estoque embalado (UOM de entrada) → litros operacionais. */
function embaladoSaldoToLitros(saldo, unidade, dens) {
  return roundVolume(
    loteToLitros({
      quantidade: saldo,
      unidade_medida: unidade || "kg",
      densidade: dens,
    })
  );
}

const INPUT_EDITABLE = "bg-card";

function emptyGranelDraft() {
  return {
    nota_fiscal: "",
    quantidade: "",
    unidade_medida: "kg",
    lote: "",
    fornecedor: "",
    data_fabricacao: "",
    data_validade: "",
    densidade: "",
    preco_unitario: "",
    granel_ticket: "",
    granel_peso_bruto: "",
    granel_peso_liquido: "",
  };
}

function granelToDraft(granel) {
  if (!granel) return emptyGranelDraft();
  const lote0 = Array.isArray(granel.lotes) ? granel.lotes[0] : null;
  return {
    nota_fiscal: granel.nota_fiscal || lote0?.nota_fiscal || "",
    quantidade:
      granel.quantidade ?? lote0?.quantidade ?? "",
    unidade_medida:
      granel.unidade_medida || lote0?.unidade_medida || "kg",
    lote: granel.lote || lote0?.lote || "",
    fornecedor: granel.fornecedor || lote0?.fornecedor || "",
    data_fabricacao:
      granel.data_fabricacao || lote0?.data_fabricacao || "",
    data_validade: granel.data_validade || lote0?.data_validade || "",
    densidade: granel.densidade || lote0?.densidade || "",
    preco_unitario: granel.preco_unitario ?? lote0?.preco_unitario ?? "",
    granel_ticket: granel.granel_ticket || "",
    granel_peso_bruto: granel.granel_peso_bruto ?? "",
    granel_peso_liquido: granel.granel_peso_liquido ?? "",
  };
}

function applyDraftToGranel(granel, draft) {
  const base = granel && typeof granel === "object" ? { ...granel } : {};
  const qty = draft.quantidade === "" ? "" : Number(draft.quantidade);
  const dens = draft.densidade === "" ? "" : draft.densidade;
  const nextLote = {
    ...(Array.isArray(base.lotes) && base.lotes[0] ? base.lotes[0] : {}),
    nota_fiscal: draft.nota_fiscal || "",
    quantidade: qty === "" ? 0 : qty,
    quantidade_nf: qty === "" ? 0 : qty,
    unidade_medida: draft.unidade_medida || "kg",
    lote: draft.lote || "",
    fornecedor: draft.fornecedor || "",
    data_fabricacao: draft.data_fabricacao || null,
    data_validade: draft.data_validade || null,
    densidade: dens,
    preco_unitario: Number(draft.preco_unitario) || 0,
  };
  return {
    ...base,
    nota_fiscal: draft.nota_fiscal || "",
    quantidade: qty === "" ? 0 : qty,
    unidade_medida: draft.unidade_medida || "kg",
    lote: draft.lote || "",
    fornecedor: draft.fornecedor || "",
    data_fabricacao: draft.data_fabricacao || null,
    data_validade: draft.data_validade || null,
    densidade: dens,
    preco_unitario: Number(draft.preco_unitario) || 0,
    granel_ticket: draft.granel_ticket || null,
    granel_peso_bruto:
      draft.granel_peso_bruto === "" ? null : Number(draft.granel_peso_bruto) || 0,
    granel_peso_liquido:
      draft.granel_peso_liquido === ""
        ? null
        : Number(draft.granel_peso_liquido) || 0,
    lotes: [nextLote],
  };
}

/**
 * Reedita uma validação pendente com o mesmo modal de envase da Ordem de Transbordo.
 * Mantém quantidade/origens em estado local e devolve o transbordo_payload no onSave.
 * Para granel, permite editar NF/lote/fab/val/pesagem via diálogo auxiliar.
 *
 * onSave(transbordoPayload, granelPayload?)
 */
export default function ValidacaoOrdemEnvaseEditor({
  open,
  onClose,
  onSave,
  validacao,
  isotanques = [],
  vasilhames = [],
  transbordos = [],
  entradas = [],
  validacoesPendentes = [],
  externalError = "",
}) {
  const { t } = useTranslation();
  const baseModel = useMemo(
    () => buildEnvaseEditModelFromValidacao(validacao),
    [validacao]
  );

  const [quantidade, setQuantidade] = useState("");
  const [densidade, setDensidade] = useState("");
  const [tankaOrigens, setTankaOrigens] = useState([]);
  const [vasilhameOrigens, setVasilhameOrigens] = useState([]);
  const [embaladoOrigens, setEmbaladoOrigens] = useState([]);
  const [lote, setLote] = useState("");
  const [granelPayload, setGranelPayload] = useState(null);
  const [granelOpen, setGranelOpen] = useState(false);
  const [granelDraft, setGranelDraft] = useState(emptyGranelDraft);

  useEffect(() => {
    if (!open || !baseModel) return;
    setQuantidade(
      baseModel.quantidade === "" || baseModel.quantidade == null
        ? ""
        : baseModel.quantidade
    );
    setDensidade(baseModel.densidade || "");
    setTankaOrigens(baseModel.tankaOrigens || []);
    setVasilhameOrigens(baseModel.vasilhameOrigens || []);
    setEmbaladoOrigens(baseModel.embaladoOrigens || []);
    setLote(baseModel.lote || "");
    setGranelPayload(baseModel.granelPayload || null);
    setGranelDraft(granelToDraft(baseModel.granelPayload));
    setGranelOpen(false);
  }, [open, baseModel]);

  const syncLoteFromOrigens = useCallback((list) => {
    const label = (list || [])
      .map((o) => String(o.lote || "").trim())
      .filter(Boolean)
      .join(" / ");
    setLote(label || "");
  }, []);

  const syncTotalFromOrigens = useCallback((list) => {
    const total = roundVolume(
      (list || []).reduce((s, o) => s + (Number(o.quantidade) || 0), 0)
    );
    setQuantidade(total > 0 ? total : "");
  }, []);

  const handleQuantidadeChange = (value) => {
    setQuantidade(value);
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka" && tankaOrigens.length === 1) {
      setTankaOrigens((prev) =>
        prev.map((o, i) => (i === 0 ? { ...o, quantidade: value } : o))
      );
    } else if (tipo === "vasilhame" && vasilhameOrigens.length === 1) {
      setVasilhameOrigens((prev) =>
        prev.map((o, i) => (i === 0 ? { ...o, quantidade: value } : o))
      );
    } else if (tipo === "embalado" && embaladoOrigens.length === 1) {
      setEmbaladoOrigens((prev) =>
        prev.map((o, i) => (i === 0 ? { ...o, quantidade: value } : o))
      );
    }
  };

  const handleLoteChange = (value) => {
    setLote(value);
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka" && tankaOrigens.length === 1) {
      setTankaOrigens((prev) =>
        prev.map((o, i) => (i === 0 ? { ...o, lote: value } : o))
      );
    } else if (tipo === "vasilhame" && vasilhameOrigens.length === 1) {
      setVasilhameOrigens((prev) =>
        prev.map((o, i) => (i === 0 ? { ...o, lote: value } : o))
      );
    } else if (tipo === "embalado" && embaladoOrigens.length <= 1) {
      setEmbaladoOrigens((prev) => {
        if (prev.length === 0) {
          return [
            {
              entrada_id: null,
              lote: value,
              unidade_medida: "kg",
              saldo_atual: 0,
              volume_l: 0,
              quantidade: quantidade === "" ? "" : quantidade,
            },
          ];
        }
        return prev.map((o, i) => (i === 0 ? { ...o, lote: value } : o));
      });
    }
  };

  const handleOrigemQuantidadeChange = (index, value) => {
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka") {
      setTankaOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index ? { ...o, quantidade: value } : o
        );
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "vasilhame") {
      setVasilhameOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index ? { ...o, quantidade: value } : o
        );
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "embalado") {
      setEmbaladoOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index ? { ...o, quantidade: value } : o
        );
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
    }
  };

  const densOperacional = useMemo(
    () =>
      parseDensidade(densidade || baseModel?.densidade || "") ||
      parseDensidade(granelPayload?.densidade) ||
      0,
    [densidade, baseModel?.densidade, granelPayload?.densidade]
  );

  /** Estoque embalado no pátio do produto — mesma regra da Nova Ordem. */
  const embaladosComSaldo = useMemo(() => {
    if (baseModel?.origemTipoOperacional !== "embalado") return [];
    if (!baseModel?.produtoId && !baseModel?.produtoCodigo) return [];
    const produtoCtx = {
      produtoId: baseModel.produtoId,
      produtoNome: baseModel.produtoNome,
      produtoCodigo: baseModel.produtoCodigo,
      clienteId: baseModel.clienteId,
      clienteNome: baseModel.clienteNome,
    };
    return (entradas || [])
      .filter(
        (e) => isEstoqueEmbalado(e) && matchesProdutoOperacional(e, produtoCtx)
      )
      .map((e) => {
        const locais = computeEstoqueQuantidadesPorLocal(e, {
          transbordos,
          vasilhames,
          saldo: e.saldo_atual,
        });
        const saldoPatio = Number(locais?.patio) || 0;
        if (!(saldoPatio > 0)) return null;
        const um = getEstoqueUnidadeEntrada(e) || locais.unidade || "kg";
        const loteLabel =
          String(e.lote || e.lotes?.[0]?.lote || "").trim() || "—";
        return {
          ...e,
          embalado: true,
          unidade_medida: um,
          saldo_atual: saldoPatio,
          lote: loteLabel,
          display_label: `${loteLabel} - ${formatQuantidade(saldoPatio)} ${um}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        String(a.lote).localeCompare(String(b.lote), "pt-BR", {
          sensitivity: "base",
        })
      );
  }, [
    baseModel?.origemTipoOperacional,
    baseModel?.produtoId,
    baseModel?.produtoNome,
    baseModel?.produtoCodigo,
    baseModel?.clienteId,
    baseModel?.clienteNome,
    entradas,
    transbordos,
    vasilhames,
  ]);

  const getOrigemLoteOptions = useCallback(
    (index) => {
      const tipo = baseModel?.origemTipoOperacional;
      if (tipo === "embalado") {
        const selectedIds = new Set(
          embaladoOrigens
            .map((it, i) => (i === index ? null : it.entrada_id))
            .filter(Boolean)
            .map(String)
        );
        const current = embaladoOrigens[index];
        let opts = embaladosComSaldo.filter(
          (e) =>
            String(e.id) === String(current?.entrada_id || "") ||
            !selectedIds.has(String(e.id))
        );
        if (
          current?.entrada_id &&
          !opts.some((e) => String(e.id) === String(current.entrada_id))
        ) {
          const um = current.unidade_medida || "kg";
          const saldo = Number(current.saldo_atual) || 0;
          opts = [
            {
              id: current.entrada_id,
              lote: current.lote || "",
              unidade_medida: um,
              saldo_atual: saldo,
              display_label: `${current.lote || "—"} - ${formatQuantidade(saldo)} ${um}`,
            },
            ...opts,
          ];
        }
        return opts;
      }
      if (tipo === "tanka") {
        const produtoCtx = {
          produtoId: baseModel?.produtoId,
          produtoNome: baseModel?.produtoNome,
          produtoCodigo: baseModel?.produtoCodigo,
        };
        return (isotanques || [])
          .filter((i) => matchesProdutoOperacional(i, produtoCtx))
          .map((i) => {
            const codigo = i.nome || i.tanka || i.codigo_itku || "";
            return {
              id: i.id,
              tankaId: i.id,
              tankaCodigo: codigo,
              lote: codigo,
              display_label: codigo,
            };
          });
      }
      if (tipo === "vasilhame") {
        const produtoCtx = {
          produtoId: baseModel?.produtoId,
          produtoNome: baseModel?.produtoNome,
          produtoCodigo: baseModel?.produtoCodigo,
        };
        return (vasilhames || [])
          .filter((v) => matchesProdutoOperacional(v, produtoCtx))
          .map((v) => {
            const codigo =
              [v.placa, v.barril].filter(Boolean).join(" - ") ||
              v.codigo ||
              "Vasilhame";
            const loteLabel = String(v.lote || "").trim();
            return {
              id: v.id,
              vasilhameId: v.id,
              codigo,
              lote: loteLabel,
              display_label: loteLabel
                ? `${codigo} · ${loteLabel}`
                : codigo,
            };
          });
      }
      return [];
    },
    [
      baseModel?.origemTipoOperacional,
      baseModel?.produtoId,
      baseModel?.produtoNome,
      baseModel?.produtoCodigo,
      embaladoOrigens,
      embaladosComSaldo,
      isotanques,
      vasilhames,
    ]
  );

  const handleOrigemLoteChange = (index, value, row = null) => {
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka") {
      setTankaOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index
            ? {
                ...o,
                tankaId: row?.tankaId || row?.id || o.tankaId || "",
                tankaCodigo:
                  row?.tankaCodigo || row?.display_label || o.tankaCodigo || "",
                lote: row?.lote || value || o.lote || "",
              }
            : o
        );
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "vasilhame") {
      setVasilhameOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index
            ? {
                ...o,
                vasilhameId: row?.vasilhameId || row?.id || o.vasilhameId || "",
                codigo: row?.codigo || o.codigo || "Vasilhame",
                lote: row?.lote || value || o.lote || "",
              }
            : o
        );
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "embalado") {
      setEmbaladoOrigens((prev) => {
        const patchFromRow = (o) => {
          if (!row) {
            return { ...o, lote: value || "" };
          }
          const um =
            row.unidade_medida || getEstoqueUnidadeEntrada(row) || "kg";
          const saldo = Number(row.saldo_atual) || 0;
          const dens =
            densOperacional ||
            parseDensidade(row.densidade) ||
            parseDensidade(row.lotes?.[0]?.densidade) ||
            0;
          const volumeL =
            dens > 0 || isUnidadeVolumeEntrada(um)
              ? embaladoSaldoToLitros(saldo, um, dens)
              : 0;
          return {
            ...o,
            entrada_id: row.id || null,
            lote: row.lote || value || "",
            unidade_medida: um,
            saldo_atual: saldo,
            volume_l: volumeL,
            quantidade: volumeL > 0 ? volumeL : "",
          };
        };
        let next;
        if (prev.length === 0) {
          next = [
            patchFromRow({
              entrada_id: null,
              lote: "",
              unidade_medida: "kg",
              saldo_atual: 0,
              volume_l: 0,
              quantidade: "",
            }),
          ];
        } else {
          next = prev.map((o, i) => (i === index ? patchFromRow(o) : o));
        }
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
    }
  };

  const handleAddOrigem = () => {
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka") {
      setTankaOrigens((prev) => {
        const next = [
          ...prev,
          { tankaId: "", tankaCodigo: "", lote: "", quantidade: "" },
        ];
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "vasilhame") {
      setVasilhameOrigens((prev) => {
        const next = [
          ...prev,
          {
            vasilhameId: "",
            codigo: "Vasilhame",
            lote: "",
            quantidade: "",
            lotes_retirados: [],
            lotes_disponiveis: [],
          },
        ];
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "embalado") {
      setEmbaladoOrigens((prev) => {
        const um = prev[0]?.unidade_medida || "kg";
        const next = [
          ...prev,
          {
            entrada_id: null,
            lote: "",
            unidade_medida: um,
            saldo_atual: 0,
            volume_l: 0,
            quantidade: "",
          },
        ];
        syncLoteFromOrigens(next);
        return next;
      });
    }
  };

  const handleRemoveOrigem = (index) => {
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka") {
      setTankaOrigens((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== index);
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "vasilhame") {
      setVasilhameOrigens((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== index);
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
      return;
    }
    if (tipo === "embalado") {
      setEmbaladoOrigens((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== index);
        syncTotalFromOrigens(next);
        syncLoteFromOrigens(next);
        return next;
      });
    }
  };

  const patchGranelDraft = (key, value) => {
    setGranelDraft((prev) => ({ ...prev, [key]: value }));
  };

  const applyGranelDraft = () => {
    const next = applyDraftToGranel(granelPayload, granelDraft);
    setGranelPayload(next);
    if (granelDraft.lote) setLote(granelDraft.lote);
    if (granelDraft.quantidade !== "" && granelDraft.quantidade != null) {
      setQuantidade(granelDraft.quantidade);
    }
    if (granelDraft.densidade !== "" && granelDraft.densidade != null) {
      setDensidade(granelDraft.densidade);
    }
    setGranelOpen(false);
  };

  const granelPrefill = useMemo(() => {
    if (!granelPayload) return null;
    return buildGranelPrefillFromPayload(granelPayload);
  }, [granelPayload]);

  const handleSaveEnvase = async (transbordoPayload) => {
    const dens =
      transbordoPayload?.densidade || densidade || granelPayload?.densidade;
    const nextGranel = granelPayload
      ? {
          ...granelPayload,
          data: transbordoPayload?.data || granelPayload.data,
          cliente_id: transbordoPayload?.cliente_id || granelPayload.cliente_id,
          cliente_nome:
            transbordoPayload?.cliente_nome || granelPayload.cliente_nome,
          produto_id:
            transbordoPayload?.produto_id || granelPayload.produto_id,
          produto_nome:
            transbordoPayload?.produto_nome || granelPayload.produto_nome,
          produto_codigo:
            transbordoPayload?.produto_codigo || granelPayload.produto_codigo,
          densidade: dens || granelPayload.densidade,
          lote: lote || granelPayload.lote,
          quantidade:
            quantidade !== "" && quantidade != null
              ? Number(quantidade)
              : granelPayload.quantidade,
        }
      : null;
    await onSave?.(transbordoPayload, nextGranel);
  };

  if (!open || !baseModel) return null;

  const canEditOrdem = Boolean(granelPayload);

  return (
    <>
      <OrdemTransbordoEnvaseModal
        open={open}
        onClose={onClose}
        onSave={handleSaveEnvase}
        onQuantidadeChange={handleQuantidadeChange}
        onLoteChange={handleLoteChange}
        onTankaOrigemQuantidadeChange={handleOrigemQuantidadeChange}
        onOrigemLoteChange={handleOrigemLoteChange}
        getOrigemLoteOptions={getOrigemLoteOptions}
        onAddOrigem={handleAddOrigem}
        onRemoveOrigem={handleRemoveOrigem}
        lotesEditable
        productLabel={baseModel.productLabel}
        produtoId={baseModel.produtoId}
        produtoNome={baseModel.produtoNome}
        produtoCodigo={baseModel.produtoCodigo}
        lote={lote}
        quantidade={quantidade}
        unidade={baseModel.unidade}
        densidade={densidade || baseModel.densidade}
        dataOp={baseModel.dataOp}
        clienteId={baseModel.clienteId}
        clienteNome={baseModel.clienteNome}
        origemTipoOperacional={baseModel.origemTipoOperacional}
        tankaOrigens={tankaOrigens}
        vasilhameOrigens={vasilhameOrigens}
        embaladoOrigens={embaladoOrigens}
        quantidadeEditable={
          baseModel.origemTipoOperacional === "embalado"
            ? embaladoOrigens.length <= 1
            : baseModel.origemTipoOperacional === "tanka"
              ? tankaOrigens.length <= 1
              : baseModel.origemTipoOperacional === "vasilhame"
                ? vasilhameOrigens.length <= 1
                : baseModel.quantidadeEditable
        }
        granelPayload={granelPrefill || granelPayload}
        initialPayload={baseModel.initialPayload}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        validacoesPendentes={validacoesPendentes}
        excludeValidacaoId={validacao?.id || null}
        externalError={externalError}
        submitLabel={t("common.save", { defaultValue: "Salvar" })}
        headerActions={
          canEditOrdem ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setGranelDraft(granelToDraft(granelPayload));
                setGranelOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("painel.operacional.ordemTransbordo.envaseModal.editOrdem", {
                defaultValue: "Editar ordem",
              })}
            </Button>
          ) : null
        }
      />

      <Dialog
        open={granelOpen}
        onOpenChange={(v) => {
          if (!v) setGranelOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("painel.operacional.ordemTransbordo.envaseModal.editOrdemTitle", {
                defaultValue: "Editar dados da ordem",
              })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.nf")} *
                </Label>
                <Input
                  value={granelDraft.nota_fiscal}
                  onChange={(e) => patchGranelDraft("nota_fiscal", e.target.value)}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.lot")} *
                </Label>
                <Input
                  value={granelDraft.lote}
                  onChange={(e) => patchGranelDraft("lote", e.target.value)}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.qty")} *
                </Label>
                <NumberInputBr
                  decimals={3}
                  min={0}
                  value={granelDraft.quantidade}
                  onChange={(v) =>
                    patchGranelDraft("quantidade", v === "" ? "" : v)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.unit")} *
                </Label>
                <SearchableSelect
                  value={granelDraft.unidade_medida}
                  onChange={(_label, item) =>
                    patchGranelDraft("unidade_medida", item?.value || "kg")
                  }
                  options={UNIDADES.map((u) => ({ value: u }))}
                  getOptionLabel={(u) => u.value}
                  getOptionValue={(u) => u.value}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.density")}
                </Label>
                <NumberInputBr
                  decimals={4}
                  min={0}
                  value={granelDraft.densidade}
                  onChange={(v) =>
                    patchGranelDraft("densidade", v === "" ? "" : v)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.supplier")}
                </Label>
                <Input
                  value={granelDraft.fornecedor}
                  onChange={(e) =>
                    patchGranelDraft("fornecedor", e.target.value)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.manufacture")}
                </Label>
                <DateInputBr
                  value={granelDraft.data_fabricacao || ""}
                  onChange={(v) =>
                    patchGranelDraft("data_fabricacao", v || "")
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.expiry")}
                </Label>
                <DateInputBr
                  value={granelDraft.data_validade || ""}
                  onChange={(v) => patchGranelDraft("data_validade", v || "")}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.unitPrice")}
                </Label>
                <NumberInputBr
                  decimals={4}
                  min={0}
                  value={granelDraft.preco_unitario}
                  onChange={(v) =>
                    patchGranelDraft("preco_unitario", v === "" ? "" : v)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.ticket")}
                </Label>
                <Input
                  value={granelDraft.granel_ticket}
                  onChange={(e) =>
                    patchGranelDraft("granel_ticket", e.target.value)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.gross")}
                </Label>
                <NumberInputBr
                  decimals={0}
                  min={0}
                  value={granelDraft.granel_peso_bruto}
                  onChange={(v) =>
                    patchGranelDraft("granel_peso_bruto", v === "" ? "" : v)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("painel.operacional.ordemTransbordo.fields.net")}
                </Label>
                <NumberInputBr
                  decimals={0}
                  min={0}
                  value={granelDraft.granel_peso_liquido}
                  onChange={(v) =>
                    patchGranelDraft("granel_peso_liquido", v === "" ? "" : v)
                  }
                  className={INPUT_EDITABLE}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGranelOpen(false)}
            >
              {t("common.cancel", "Cancelar")}
            </Button>
            <Button type="button" onClick={applyGranelDraft}>
              {t("common.apply", { defaultValue: "Aplicar" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
