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
import { Switch } from "@shared/components/ui/switch";
import SearchableSelect from "@chemflow/components/cadastro/SearchableSelect";


export default function ProdutoModal({
  open,
  onClose,
  onSave,
  editingProduto,
  readOnly,
  clientes,
}) {
  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [densidadeTabelada, setDensidadeTabelada] = useState(false);
  const [densidade, setDensidade] = useState("");
  const [filtrado, setFiltrado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editingProduto) {
      setCodigo(editingProduto.codigo || "");
      setProduto(editingProduto.produto || "");
      setClienteId(editingProduto.cliente_id || "");
      setClienteNome(editingProduto.cliente_nome || "");
      setDensidadeTabelada(editingProduto.densidade_tabelada || false);
      setDensidade(
        editingProduto.densidade && editingProduto.densidade !== "-"
          ? editingProduto.densidade
          : ""
      );
      setFiltrado(editingProduto.filtrado || false);
    } else {
      setCodigo("");
      setProduto("");
      setClienteId("");
      setClienteNome("");
      setDensidadeTabelada(false);
      setDensidade("");
      setFiltrado(false);
    }
    setError("");
  }, [editingProduto, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!codigo || !produto) {
      setError("Preencha os campos obrigatórios (Código e Nome).");
      return;
    }
    onSave({
      codigo,
      produto,
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      densidade: densidadeTabelada ? densidade || "-" : "-",
      densidade_tabelada: densidadeTabelada,
      filtrado,
      data_cadastro:
        editingProduto?.data_cadastro ||
        new Date().toISOString().split("T")[0],
    });
  };

  const title = readOnly
    ? "Visualizar Produto"
    : editingProduto
    ? "Editar Produto"
    : "Novo Produto";

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
              <Label>Código do Produto *</Label>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex: AD1700"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome do Produto *</Label>
              <Input
                value={produto}
                onChange={(e) => setProduto(e.target.value)}
                placeholder="Ex: INIPOL AD 1700"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <SearchableSelect
              value={clienteNome}
              onChange={(label, item) => {
                setClienteNome(label);
                setClienteId(item?.id || "");
              }}
              options={clientes}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Selecione ou digite um cliente"
              disabled={readOnly}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40/50">
            <div>
              <Label>Densidade Tabelada?</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Indica se o produto possui densidade cadastrada
              </p>
            </div>
            <Switch
              checked={densidadeTabelada}
              onCheckedChange={setDensidadeTabelada}
              disabled={readOnly}
            />
          </div>

          {densidadeTabelada && (
            <div className="space-y-1.5">
              <Label>Densidade (g/cm³)</Label>
              <Input
                type="number"
                step="0.001"
                value={densidade}
                onChange={(e) => setDensidade(e.target.value)}
                placeholder="0.000"
                disabled={readOnly}
              />
            </div>
          )}

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40/50">
            <div>
              <Label>Produto Filtrado?</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Indica se o produto passa por filtração
              </p>
            </div>
            <Switch
              checked={filtrado}
              onCheckedChange={setFiltrado}
              disabled={readOnly}
            />
          </div>

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit">
                {editingProduto ? "Salvar Alterações" : "Cadastrar Produto"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
