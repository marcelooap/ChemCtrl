import { useState, useEffect } from "react";
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
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";

const emptyToNull = (v) => (v === "" || v == null ? null : v);

export default function IsotanqueModal({
  open,
  onClose,
  onSave,
  editingIsotanque,
  readOnly,
  produtos,
  clientes,
}) {
  const [codigoItku, setCodigoItku] = useState("");
  const [tanka, setTanka] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [inicioLocacao, setInicioLocacao] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingIsotanque) {
      setCodigoItku(editingIsotanque.codigo_itku || "");
      setTanka(editingIsotanque.tanka || "");
      setProdutoId(editingIsotanque.produto_id || "");
      setProdutoNome(editingIsotanque.produto_nome || "");
      setClienteId(editingIsotanque.cliente_id || "");
      setClienteNome(editingIsotanque.cliente_nome || "");
      setCapacidade(editingIsotanque.capacidade ?? "");
      setInicioLocacao(
        editingIsotanque.inicio_locacao
          ? String(editingIsotanque.inicio_locacao).slice(0, 10)
          : ""
      );
    } else {
      setCodigoItku("");
      setTanka("");
      setProdutoId("");
      setProdutoNome("");
      setClienteId("");
      setClienteNome("");
      setCapacidade("");
      setInicioLocacao("");
    }
    setError("");
    setSaving(false);
  }, [editingIsotanque, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!codigoItku) {
      setError("Código ITKU é obrigatório.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        codigo_itku: codigoItku.trim(),
        tanka: emptyToNull(tanka.trim()),
        produto_id: emptyToNull(produtoId),
        produto_nome: emptyToNull(produtoNome.trim()),
        cliente_id: emptyToNull(clienteId),
        cliente_nome: emptyToNull(clienteNome.trim()),
        capacidade: capacidade ? Number(capacidade) : null,
        inicio_locacao: emptyToNull(inicioLocacao),
      });
    } catch (err) {
      setError(err?.message || "Não foi possível salvar o isotanque.");
    } finally {
      setSaving(false);
    }
  };

  const title = readOnly
    ? "Visualizar Isotanque"
    : editingIsotanque
    ? "Editar Isotanque"
    : "Novo Isotanque";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Código ITKU *</Label>
              <Input
                value={codigoItku}
                onChange={(e) => setCodigoItku(e.target.value)}
                placeholder="Ex: ITKU-001"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tanka</Label>
              <Input
                value={tanka}
                onChange={(e) => setTanka(e.target.value)}
                placeholder="Ex: T-01"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Produto em Uso</Label>
            <SearchableSelect
              value={produtoNome}
              onChange={(label, item) => {
                setProdutoNome(label);
                if (item) {
                  setProdutoId(item.id);
                  setClienteId(item.cliente_id || "");
                  setClienteNome(item.cliente_nome || "");
                } else {
                  setProdutoId("");
                  setClienteId("");
                  setClienteNome("");
                }
              }}
              options={produtos}
              getOptionLabel={(p) => p.produto}
              getOptionValue={(p) => p.id}
              placeholder="Selecione ou digite um produto"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input
              value={clienteNome}
              placeholder="Preenchido automaticamente pelo produto"
              disabled
              className="bg-muted/40 text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Capacidade (Litros)</Label>
              <NumberInputBr
                decimals={0}
                value={capacidade}
                onChange={(v) => setCapacidade(v === "" ? "" : v)}
                placeholder="0"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Início da Locação</Label>
              <Input
                type="date"
                value={inicioLocacao}
                onChange={(e) => setInicioLocacao(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Salvando..."
                  : editingIsotanque
                  ? "Salvar Alterações"
                  : "Cadastrar Isotanque"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}