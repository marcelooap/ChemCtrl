import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import OrdemTransbordoEnvaseModal from "@painel/components/operacional/OrdemTransbordoEnvaseModal";
import {
  buildEnvaseEditModelFromValidacao,
  buildGranelPrefillFromPayload,
} from "@transbordo/lib/validacaoTransbordo";
import { roundVolume } from "@transbordo/lib/format";
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

const INPUT_EDITABLE = "bg-white";

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
    setLote(baseModel.lote || "");
    setGranelPayload(baseModel.granelPayload || null);
    setGranelDraft(granelToDraft(baseModel.granelPayload));
    setGranelOpen(false);
  }, [open, baseModel]);

  const syncLoteFromOrigens = useCallback((tankaList, vasilhameList, tipo) => {
    if (tipo === "tanka") {
      const label = (tankaList || [])
        .map((o) => String(o.lote || "").trim())
        .filter(Boolean)
        .join(" / ");
      if (label) setLote(label);
      return;
    }
    if (tipo === "vasilhame") {
      const label = (vasilhameList || [])
        .map((o) => String(o.lote || "").trim())
        .filter(Boolean)
        .join(" / ");
      if (label) setLote(label);
    }
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
    }
  };

  const handleOrigemQuantidadeChange = (index, value) => {
    const tipo = baseModel?.origemTipoOperacional;
    if (tipo === "tanka") {
      setTankaOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index ? { ...o, quantidade: value } : o
        );
        const total = roundVolume(
          next.reduce((s, o) => s + (Number(o.quantidade) || 0), 0)
        );
        setQuantidade(total > 0 ? total : "");
        syncLoteFromOrigens(next, null, "tanka");
        return next;
      });
      return;
    }
    if (tipo === "vasilhame") {
      setVasilhameOrigens((prev) => {
        const next = prev.map((o, i) =>
          i === index ? { ...o, quantidade: value } : o
        );
        const total = roundVolume(
          next.reduce((s, o) => s + (Number(o.quantidade) || 0), 0)
        );
        setQuantidade(total > 0 ? total : "");
        syncLoteFromOrigens(null, next, "vasilhame");
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
        onTankaOrigemQuantidadeChange={handleOrigemQuantidadeChange}
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
        quantidadeEditable={baseModel.quantidadeEditable}
        granelPayload={granelPrefill || granelPayload}
        initialPayload={baseModel.initialPayload}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
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
                  decimals={0}
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
