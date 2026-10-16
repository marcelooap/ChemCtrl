import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Textarea } from "@shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import {
  matchProdutoCliente,
  normProdutoKey,
} from "@transbordo/lib/cadastroProdutosCentral";

const emptyToNull = (v) => (v === "" || v == null ? null : v);

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const labelClass = "text-xs font-medium text-muted-foreground";
const fieldClass = "bg-white";

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
  const [capacidade, setCapacidade] = useState("26000");
  const [inicioLocacao, setInicioLocacao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingIsotanque) {
      setCodigoItku(editingIsotanque.codigo_itku || "");
      setTanka(editingIsotanque.nome || editingIsotanque.tanka || "");
      setProdutoId(editingIsotanque.produto_id || "");
      setProdutoNome(editingIsotanque.produto_nome || "");
      setClienteId(editingIsotanque.cliente_id || "");
      setClienteNome(editingIsotanque.cliente_nome || "");
      setCapacidade(
        editingIsotanque.capacidade != null && editingIsotanque.capacidade !== ""
          ? String(editingIsotanque.capacidade)
          : "26000"
      );
      setInicioLocacao(
        editingIsotanque.inicio_locacao
          ? String(editingIsotanque.inicio_locacao).slice(0, 10)
          : ""
      );
      setObservacao(editingIsotanque.observacao || "");
    } else {
      setCodigoItku("");
      setTanka("");
      setProdutoId("");
      setProdutoNome("");
      setClienteId("");
      setClienteNome("");
      setCapacidade("26000");
      setInicioLocacao(todayISODate());
      setObservacao("");
    }
    setError("");
    setSaving(false);
  }, [editingIsotanque, open]);

  const clienteOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const c of clientes || []) {
      const nome = String(c?.nome || "").trim();
      if (!nome) continue;
      const key = normProdutoKey(nome);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ id: c.id, nome });
    }
    if (clienteNome && !seen.has(normProdutoKey(clienteNome))) {
      list.unshift({
        id: clienteId || `nome:${clienteNome}`,
        nome: clienteNome,
      });
    }
    return list.sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
    );
  }, [clientes, clienteId, clienteNome]);

  const produtoOptions = useMemo(() => {
    if (!clienteNome && !clienteId) return [];
    const seen = new Set();
    const options = [];
    for (const p of produtos || []) {
      if (!matchProdutoCliente(p, { clienteId, clienteNome })) continue;
      const nome = String(p.produto || "").trim();
      if (!nome) continue;
      const key = normProdutoKey(nome);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(p);
    }
    if (
      produtoId &&
      !options.some((p) => String(p.id) === String(produtoId))
    ) {
      const ghostNome = String(produtoNome || "").trim();
      if (ghostNome && !seen.has(normProdutoKey(ghostNome))) {
        options.unshift({
          id: produtoId,
          produto: ghostNome,
          codigo: "",
          cliente_id: clienteId || null,
          cliente_nome: clienteNome || "",
        });
      }
    }
    return options.sort((a, b) =>
      String(a.produto || "").localeCompare(String(b.produto || ""), "pt-BR", {
        sensitivity: "base",
      })
    );
  }, [produtos, clienteId, clienteNome, produtoId, produtoNome]);

  const handleClientChange = (value) => {
    const selected = clienteOptions.find((c) => String(c.id) === String(value));
    const nextId = selected?.id && !String(selected.id).startsWith("nome:")
      ? selected.id
      : "";
    const nextNome = selected?.nome || "";
    setClienteId(nextId);
    setClienteNome(nextNome);

    const stillValid =
      Boolean(produtoNome) &&
      (produtos || []).some(
        (p) =>
          matchProdutoCliente(p, {
            clienteId: nextId,
            clienteNome: nextNome,
          }) &&
          normProdutoKey(p.produto) === normProdutoKey(produtoNome)
      );
    if (!stillValid) {
      setProdutoId("");
      setProdutoNome("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!codigoItku.trim()) {
      setError("Código ITKU é obrigatório.");
      return;
    }
    if (!tanka.trim()) {
      setError("Nome da tanka é obrigatório.");
      return;
    }
    if (!clienteNome.trim()) {
      setError("Cliente é obrigatório.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        codigo_itku: codigoItku.trim(),
        nome: tanka.trim(),
        tanka: tanka.trim(),
        produto_id: emptyToNull(produtoId),
        produto_nome: emptyToNull(produtoNome.trim()),
        cliente_id: emptyToNull(clienteId),
        cliente_nome: emptyToNull(clienteNome.trim()),
        capacidade:
          capacidade === "" || capacidade == null ? 26000 : Number(capacidade),
        inicio_locacao: emptyToNull(inicioLocacao),
        observacao: emptyToNull(observacao.trim()),
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

  const selectValue =
    clienteOptions.find(
      (c) =>
        (clienteId && String(c.id) === String(clienteId)) ||
        (clienteNome &&
          normProdutoKey(c.nome) === normProdutoKey(clienteNome))
    )?.id || "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className={labelClass}>Código ITKU *</Label>
              <Input
                className={fieldClass}
                value={codigoItku}
                onChange={(e) => setCodigoItku(e.target.value)}
                placeholder="Ex: ITKU-001"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Nome da Tanka *</Label>
              <Input
                className={fieldClass}
                value={tanka}
                onChange={(e) => setTanka(e.target.value)}
                placeholder="Ex: TANKA 01"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass}>Cliente *</Label>
            <Select
              value={selectValue}
              onValueChange={handleClientChange}
              disabled={readOnly}
            >
              <SelectTrigger className={fieldClass}>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                {clienteOptions.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass}>Produto em Uso</Label>
            <SearchableSelect
              value={produtoNome}
              onChange={(label, item) => {
                setProdutoNome(label || "");
                setProdutoId(item?.id || "");
              }}
              options={produtoOptions}
              getOptionLabel={(p) => p.produto || ""}
              getOptionValue={(p) => p.id}
              placeholder={
                clienteNome
                  ? "Selecione ou digite um produto"
                  : "Selecione o cliente primeiro"
              }
              disabled={readOnly || !clienteNome}
              inputClassName={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className={labelClass}>Capacidade (Litros)</Label>
              <NumberInputBr
                decimals={0}
                value={capacidade}
                onChange={(v) => setCapacidade(v === "" ? "" : v)}
                placeholder="26000"
                disabled={readOnly}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Início da Locação</Label>
              <Input
                type="date"
                className={fieldClass}
                value={inicioLocacao}
                onChange={(e) => setInicioLocacao(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass}>Observação</Label>
            <Textarea
              rows={2}
              className={fieldClass}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Observações sobre a tanka (opcional)"
              disabled={readOnly}
            />
          </div>

          {!readOnly && (
            <div className="flex justify-end gap-2 mt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                style={{ background: "#2575D1" }}
                className="text-white"
              >
                {saving
                  ? "Salvando..."
                  : editingIsotanque
                    ? "Salvar Alterações"
                    : "Cadastrar"}
              </Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
