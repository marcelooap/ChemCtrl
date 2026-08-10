import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { AlertCircle } from "lucide-react";
import { UNIDADES } from "@transbordo/components/entrada/LoteBlock";
import { formatCurrency } from "@transbordo/lib/format";
import {
  getEstoqueNotaFiscal,
  getEstoqueNotaFiscalTroca,
} from "@transbordo/lib/estoqueSaldo";

function toInputDate(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function EstoqueEditModal({ open, onClose, onSave, item }) {
  const [notaFiscal, setNotaFiscal] = useState("");
  const [notaFiscalTroca, setNotaFiscalTroca] = useState("");
  const [lote, setLote] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState("kg");
  const [dataFabricacao, setDataFabricacao] = useState("");
  const [dataValidade, setDataValidade] = useState("");
  const [precoUnitario, setPrecoUnitario] = useState("");
  const [pesoLiquido, setPesoLiquido] = useState("");
  const [qtdEmbalagens, setQtdEmbalagens] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const itemId = item?.id;

  const embalado = !!item?.embalado;

  useEffect(() => {
    if (!open || !item) return;
    setNotaFiscal(getEstoqueNotaFiscal(item));
    setNotaFiscalTroca(getEstoqueNotaFiscalTroca(item));
    setLote(item.lote || "");
    setQuantidade(
      item.quantidade != null && item.quantidade !== ""
        ? String(item.quantidade)
        : ""
    );
    setUnidade(item.unidade_medida || "kg");
    setDataFabricacao(toInputDate(item.data_fabricacao));
    setDataValidade(toInputDate(item.data_validade));
    setPrecoUnitario(
      item.preco_unitario != null && item.preco_unitario !== ""
        ? String(item.preco_unitario)
        : ""
    );
    setPesoLiquido(
      item.peso_liquido != null && item.peso_liquido !== ""
        ? String(item.peso_liquido)
        : ""
    );
    setQtdEmbalagens(
      item.quantidade_embalagens != null && item.quantidade_embalagens !== ""
        ? String(item.quantidade_embalagens)
        : ""
    );
    setError("");
    savingRef.current = false;
    setSaving(false);
  }, [open, itemId]);

  const qtd = parseFloat(quantidade) || 0;
  const preco = parseFloat(precoUnitario) || 0;
  const custoTotal = qtd * preco;
  const peso = parseFloat(pesoLiquido) || 0;
  const embQtd = parseFloat(qtdEmbalagens) || 0;
  const totalEmbalagens = peso * embQtd;
  const embalagemDiverge =
    embalado && qtd > 0 && Math.abs(totalEmbalagens - qtd) > 0.001;

  const produtoLabel =
    item?.produto_codigo && item?.produto_nome
      ? `${item.produto_codigo} — ${item.produto_nome}`
      : item?.produto_nome || item?.produto_codigo || "-";

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (savingRef.current) return;

    if (!notaFiscal.trim()) {
      setError("Nota Fiscal é obrigatória.");
      return;
    }
    if (!lote.trim()) {
      setError("Lote é obrigatório.");
      return;
    }
    if (!quantidade || qtd <= 0) {
      setError("Quantidade deve ser positiva.");
      return;
    }
    if (!unidade) {
      setError("Unidade de Medida é obrigatória.");
      return;
    }
    if (embalado && embalagemDiverge) {
      setError(
        "A soma do peso líquido das embalagens deve ser igual à quantidade."
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        nota_fiscal: notaFiscal.trim(),
        nota_fiscal_troca: notaFiscalTroca.trim() || null,
        lote: lote.trim(),
        quantidade: qtd,
        unidade_medida: unidade,
        data_fabricacao: dataFabricacao || null,
        data_validade: dataValidade || null,
        preco_unitario: preco,
        custo_total: custoTotal,
        peso_liquido: embalado ? peso || null : null,
        quantidade_embalagens: embalado ? embQtd || null : null,
      });
    } catch (err) {
      setError(err?.message || "Não foi possível salvar. Tente novamente.");
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open && !!item}
      onOpenChange={(v) => {
        if (!v && !savingRef.current) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Estoque</DialogTitle>
        </DialogHeader>

        {!item ? null : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-muted/40">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Cliente</Label>
              <p className="text-sm font-medium text-foreground">
                {item.cliente_nome || "-"}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Produto</Label>
              <p className="text-sm font-medium text-foreground break-words">
                {produtoLabel}
              </p>
              {embalado && (
                <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-200 text-orange-800">
                  Embalado
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nota Fiscal *</Label>
              <Input
                value={notaFiscal}
                onChange={(e) => setNotaFiscal(e.target.value)}
                placeholder="NF original"
                disabled={saving}
                className="bg-card"
              />
              <p className="text-[11px] text-muted-foreground">
                Nota fiscal original — preservada após troca.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Troca Fiscal</Label>
              <Input
                value={notaFiscalTroca}
                onChange={(e) => setNotaFiscalTroca(e.target.value)}
                placeholder="Nova NF após troca"
                disabled={saving}
                className="bg-card"
              />
              <p className="text-[11px] text-muted-foreground">
                Informe a nova nota fiscal, se houver troca.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Lote *</Label>
            <Input
              value={lote}
              onChange={(e) => setLote(e.target.value)}
              placeholder="Número do lote"
              disabled={saving}
              className="bg-card"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantidade *</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0"
                disabled={saving}
                className="bg-card"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade *</Label>
              <select
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                disabled={saving}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data de Fabricação</Label>
              <Input
                type="date"
                value={dataFabricacao}
                onChange={(e) => setDataFabricacao(e.target.value)}
                disabled={saving}
                className="bg-card"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data de Validade</Label>
              <Input
                type="date"
                value={dataValidade}
                onChange={(e) => setDataValidade(e.target.value)}
                disabled={saving}
                className="bg-card"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Preço Unitário (R$)</Label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={precoUnitario}
                onChange={(e) => setPrecoUnitario(e.target.value)}
                placeholder="0,0000"
                disabled={saving}
                className="bg-card"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Custo Total (R$)</Label>
              <Input
                value={formatCurrency(custoTotal)}
                disabled
                className="bg-muted/40 font-medium text-green-600"
              />
            </div>
          </div>

          {embalado && (
            <div className="space-y-3 p-3 rounded-lg border border-border">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Embalagem
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Peso Líq.</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={pesoLiquido}
                    onChange={(e) => setPesoLiquido(e.target.value)}
                    placeholder="0"
                    disabled={saving}
                    className="bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Qtd. Embalagens</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={qtdEmbalagens}
                    onChange={(e) => setQtdEmbalagens(e.target.value)}
                    placeholder="0"
                    disabled={saving}
                    className="bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Total</Label>
                  <Input
                    value={totalEmbalagens || ""}
                    disabled
                    className={`bg-muted/40 font-medium ${
                      embalagemDiverge ? "text-red-600" : ""
                    }`}
                  />
                </div>
              </div>
              {embalagemDiverge && (
                <p className="text-xs text-red-600">
                  Peso líq. × qtd. embalagens deve ser igual à quantidade (
                  {qtd}).
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
