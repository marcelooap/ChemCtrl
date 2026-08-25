import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import ProdutoFdsSection from "@transbordo/components/cadastro/ProdutoFdsSection";
import {
  ORGAOS_REGULAMENTADORES,
  OrgaoRegulamentadorLogo,
} from "@transbordo/components/cadastro/OrgaoRegulamentadorBadge";

function normKey(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function ProdutoModal({
  open,
  onClose,
  onSave,
  editingProduto,
  readOnly,
  clientes = [],
  produtos = [],
  estoque = [],
  externalError = "",
  uploadedBy = "",
  onFdsMetadataChange,
}) {
  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [densidadeTabelada, setDensidadeTabelada] = useState(false);
  const [densidade, setDensidade] = useState("");
  const [filtrado, setFiltrado] = useState(false);
  const [controlado, setControlado] = useState(false);
  const [orgaoRegulamentador, setOrgaoRegulamentador] = useState("");
  const [error, setError] = useState("");
  const [clienteAutoFilled, setClienteAutoFilled] = useState(false);
  const [fdsMeta, setFdsMeta] = useState({
    fds_url: null,
    fds_filename: null,
    fds_uploaded_at: null,
  });

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
      setControlado(Boolean(editingProduto.controlado));
      setOrgaoRegulamentador(editingProduto.orgao_regulamentador || "");
      setClienteAutoFilled(false);
      setFdsMeta({
        fds_url: editingProduto.fds_url || null,
        fds_filename: editingProduto.fds_filename || null,
        fds_uploaded_at: editingProduto.fds_uploaded_at || null,
      });
    } else {
      setCodigo("");
      setProduto("");
      setClienteId("");
      setClienteNome("");
      setDensidadeTabelada(false);
      setDensidade("");
      setFiltrado(false);
      setControlado(false);
      setOrgaoRegulamentador("");
      setClienteAutoFilled(false);
      setFdsMeta({
        fds_url: null,
        fds_filename: null,
        fds_uploaded_at: null,
      });
    }
    setError("");
  }, [editingProduto?.id, open]);

  const handleFdsMetadataChange = (metadata) => {
    setFdsMeta((prev) => ({ ...prev, ...metadata }));
    onFdsMetadataChange?.(metadata);
  };

  /** Códigos únicos já cadastrados. */
  const codigoOptions = useMemo(() => {
    const map = new Map();
    for (const p of produtos || []) {
      const cod = String(p.codigo || "").trim();
      if (!cod) continue;
      const key = normKey(cod);
      if (!map.has(key)) {
        map.set(key, { id: key, codigo: cod });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })
    );
  }, [produtos]);

  const codigoNorm = normKey(codigo);

  /** Descrições já em estoque para o código selecionado (somente referência). */
  const descricoesEmEstoque = useMemo(() => {
    if (!codigoNorm) return [];
    const map = new Map();
    for (const e of estoque || []) {
      if ((Number(e.saldo_atual) || 0) <= 0) continue;
      if (normKey(e.produto_codigo) !== codigoNorm) continue;
      const nome = String(e.produto_nome || "").trim();
      if (!nome) continue;
      const key = normKey(nome);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          produto: nome,
          cliente_id: e.cliente_id || null,
          cliente_nome: e.cliente_nome || "",
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.produto.localeCompare(b.produto, "pt-BR", { sensitivity: "base" })
    );
  }, [estoque, codigoNorm]);

  /** Produtos cadastrados com o mesmo código (para validar duplicidade e cliente). */
  const produtosDoCodigo = useMemo(() => {
    if (!codigoNorm) return [];
    return (produtos || []).filter((p) => normKey(p.codigo) === codigoNorm);
  }, [produtos, codigoNorm]);

  const isDuplicateDescricao = useMemo(() => {
    const nomeNorm = normKey(produto);
    if (!codigoNorm || !nomeNorm) return false;
    return produtosDoCodigo.some((p) => {
      if (editingProduto?.id && p.id === editingProduto.id) return false;
      return normKey(p.produto) === nomeNorm;
    });
  }, [produtosDoCodigo, produto, codigoNorm, editingProduto?.id]);

  const aplicarClienteDoCodigo = (codLabel) => {
    const key = normKey(codLabel);
    if (!key) {
      setClienteAutoFilled(false);
      return;
    }

    // Só preenche automaticamente se o código já tiver saldo em estoque
    const est = (estoque || []).find(
      (e) =>
        (Number(e.saldo_atual) || 0) > 0 &&
        normKey(e.produto_codigo) === key &&
        (e.cliente_nome || e.cliente_id)
    );
    if (est) {
      setClienteId(est.cliente_id || "");
      setClienteNome(est.cliente_nome || "");
      setClienteAutoFilled(true);
      return;
    }

    setClienteAutoFilled(false);
  };

  const handleCodigoChange = (label) => {
    setCodigo(label);
    setError("");
    if (!editingProduto && !readOnly) {
      aplicarClienteDoCodigo(label);
    }
  };

  const handleProdutoChange = (label) => {
    setProduto(label);
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!codigo?.trim() || !produto?.trim()) {
      setError("Preencha os campos obrigatórios (Código e Nome).");
      return;
    }
    if (isDuplicateDescricao) {
      setError(
        "Já existe um produto cadastrado com este código e esta descrição. Informe uma descrição diferente."
      );
      return;
    }
    if (controlado && !orgaoRegulamentador) {
      setError("Selecione o órgão regulamentador do produto controlado.");
      return;
    }
    onSave({
      codigo: codigo.trim(),
      produto: produto.trim(),
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      densidade: densidadeTabelada ? densidade || "-" : "-",
      densidade_tabelada: densidadeTabelada,
      filtrado,
      controlado,
      orgao_regulamentador: controlado ? orgaoRegulamentador : null,
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

  const displayError = error || externalError;
  const codigoJaExiste = codigoNorm && codigoOptions.some((o) => o.id === codigoNorm);
  const temEstoqueNoCodigo = descricoesEmEstoque.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Código do Produto *</Label>
              <SearchableSelect
                value={codigo}
                onChange={(label) => handleCodigoChange(label)}
                options={codigoOptions}
                getOptionLabel={(o) => o.codigo}
                getOptionValue={(o) => o.id}
                placeholder="Selecione ou digite um código"
                disabled={readOnly}
              />
              {!editingProduto && codigoJaExiste ? (
                <p className="text-[11px] text-muted-foreground">
                  Código já cadastrado — você pode criar outra descrição.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Nome do Produto *</Label>
              <SearchableSelect
                value={produto}
                onChange={(label) => handleProdutoChange(label)}
                options={descricoesEmEstoque}
                getOptionLabel={(o) => o.produto}
                getOptionValue={(o) => o.id}
                placeholder={
                  temEstoqueNoCodigo
                    ? "Nova descrição (veja as existentes)"
                    : "Ex: INIPOL AD 1700"
                }
                disabled={readOnly}
              />
              {temEstoqueNoCodigo ? (
                <p className="text-[11px] text-muted-foreground">
                  Lista mostra descrições já em estoque para este código.
                </p>
              ) : null}
              {isDuplicateDescricao ? (
                <p className="text-[11px] text-red-600">
                  Esta descrição já está cadastrada para este código.
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <SearchableSelect
              value={clienteNome}
              onChange={(label, item) => {
                setClienteNome(label);
                setClienteId(item?.id || "");
                setClienteAutoFilled(false);
              }}
              options={clientes}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Selecione ou digite um cliente"
              disabled={readOnly}
            />
            {clienteAutoFilled && !editingProduto ? (
              <p className="text-[11px] text-muted-foreground">
                Cliente preenchido automaticamente a partir do código em estoque.
              </p>
            ) : null}
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
              <NumberInputBr
                decimals={3}
                value={densidade}
                onChange={(v) => setDensidade(v === "" ? "" : v)}
                placeholder="0,000"
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

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40/50">
            <div>
              <Label>Produto Controlado?</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Indica se o produto é controlado por órgão regulamentador
              </p>
            </div>
            <Switch
              checked={controlado}
              onCheckedChange={(checked) => {
                setControlado(checked);
                if (!checked) setOrgaoRegulamentador("");
                setError("");
              }}
              disabled={readOnly}
            />
          </div>

          {controlado && (
            <div className="space-y-1.5">
              <Label>Órgão Regulamentador *</Label>
              <Select
                value={orgaoRegulamentador || undefined}
                onValueChange={(value) => {
                  setOrgaoRegulamentador(value);
                  setError("");
                }}
                disabled={readOnly}
              >
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue placeholder="Selecione o órgão" />
                </SelectTrigger>
                <SelectContent>
                  {ORGAOS_REGULAMENTADORES.map((orgao) => (
                    <SelectItem key={orgao.value} value={orgao.value}>
                      <span className="inline-flex items-center gap-2">
                        <OrgaoRegulamentadorLogo
                          orgao={orgao.value}
                          className="w-4 h-4"
                        />
                        {orgao.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {editingProduto?.id ? (
            <ProdutoFdsSection
              produtoId={editingProduto.id}
              fdsUrl={fdsMeta.fds_url}
              fdsFilename={fdsMeta.fds_filename}
              fdsUploadedAt={fdsMeta.fds_uploaded_at}
              uploadedBy={uploadedBy}
              onMetadataChange={handleFdsMetadataChange}
              readOnly={readOnly}
            />
          ) : null}

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isDuplicateDescricao}>
                {editingProduto ? "Salvar Alterações" : "Cadastrar Produto"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
