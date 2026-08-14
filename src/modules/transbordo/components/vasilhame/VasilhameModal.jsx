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
import { AlertCircle } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { formatMass, parseDensidade } from "@transbordo/lib/format";

const emptyToNull = (v) => (v === "" || v == null ? null : v);

const INPUT_EDITABLE = "bg-white";
const INPUT_LOCKED = "bg-muted/40 font-medium";

const TIPOS = ["Contentor", "Vasilhame", "Tambor", "Bombona", "IBC", "One Way"];

const EDITABLE_WHEN_VASILHAME = new Set([
  "tipo",
  "lote",
  "lacres",
  "tara",
  "eslinga",
  "gps",
  "menor_teste",
  "densidade",
]);

function produtoTemDensidade(produto) {
  if (!produto) return false;
  if (produto.densidade_tabelada) {
    const d = parseDensidade(produto.densidade);
    return d > 0;
  }
  const d = parseDensidade(produto.densidade);
  return d > 0 && String(produto.densidade || "").trim() !== "-";
}

export default function VasilhameModal({
  open,
  onClose,
  onSave,
  editingVasilhame,
  readOnly,
  clientes,
  produtos,
}) {
  const [numeroOp, setNumeroOp] = useState("Manual");
  const [placa, setPlaca] = useState("");
  const [barril, setBarril] = useState("");
  const [tipo, setTipo] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [produtoDisplay, setProdutoDisplay] = useState("");
  const [densidade, setDensidade] = useState("");
  const [densidadeDoCadastro, setDensidadeDoCadastro] = useState(false);
  const [lote, setLote] = useState("");
  const [volume, setVolume] = useState("");
  const [tara, setTara] = useState("");
  const [lacres, setLacres] = useState("");
  const [eslinga, setEslinga] = useState("");
  const [gps, setGps] = useState("");
  const [menorTeste, setMenorTeste] = useState("");
  const [dataSaida, setDataSaida] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [fracionado, setFracionado] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingVasilhame) {
      const prod = (produtos || []).find(
        (p) =>
          p.id === editingVasilhame.produto_id ||
          (p.codigo && p.codigo === editingVasilhame.produto_codigo)
      );
      const fromCadastro = produtoTemDensidade(prod);
      setNumeroOp(editingVasilhame.numero_op || "Manual");
      setPlaca(editingVasilhame.placa || "");
      setBarril(editingVasilhame.barril || "");
      setTipo(editingVasilhame.tipo || "");
      setClienteId(editingVasilhame.cliente_id || "");
      setClienteNome(editingVasilhame.cliente_nome || "");
      setProdutoId(editingVasilhame.produto_id || "");
      setProdutoNome(editingVasilhame.produto_nome || "");
      setProdutoCodigo(editingVasilhame.produto_codigo || "");
      setProdutoDisplay(
        editingVasilhame.produto_codigo && editingVasilhame.produto_nome
          ? `${editingVasilhame.produto_codigo} - ${editingVasilhame.produto_nome}`
          : editingVasilhame.produto_nome || ""
      );
      setDensidadeDoCadastro(fromCadastro);
      setDensidade(
        fromCadastro
          ? prod.densidade || editingVasilhame.densidade || ""
          : editingVasilhame.densidade || ""
      );
      setLote(editingVasilhame.lote || "");
      setVolume(editingVasilhame.volume ?? "");
      setTara(editingVasilhame.tara ?? "");
      setLacres(editingVasilhame.lacres || "");
      setEslinga(editingVasilhame.eslinga || "");
      setGps(editingVasilhame.gps || "");
      setMenorTeste(editingVasilhame.menor_teste || "");
      setDataSaida(editingVasilhame.data_saida || "");
      setResponsavel(editingVasilhame.responsavel || "");
      setFracionado(!!editingVasilhame.fracionado);
    } else {
      setNumeroOp("Manual");
      setPlaca("");
      setBarril("");
      setTipo("");
      setClienteId("");
      setClienteNome("");
      setProdutoId("");
      setProdutoNome("");
      setProdutoCodigo("");
      setProdutoDisplay("");
      setDensidade("");
      setDensidadeDoCadastro(false);
      setLote("");
      setVolume("");
      setTara("");
      setLacres("");
      setEslinga("");
      setGps("");
      setMenorTeste("");
      setDataSaida("");
      setResponsavel("");
      setFracionado(false);
    }
    setError("");
    setSaving(false);
  }, [editingVasilhame, open, produtos]);

  const clientesComProdutos = produtos
    .filter((p) => p.cliente_nome)
    .reduce((acc, p) => {
      if (!acc.find((c) => c.nome === p.cliente_nome)) {
        const matched = clientes.find(
          (c) => c.nome.toLowerCase() === p.cliente_nome.toLowerCase()
        );
        acc.push({ id: matched?.id || p.cliente_id || "", nome: p.cliente_nome });
      }
      return acc;
    }, []);

  const filteredProdutos = produtos.filter(
    (p) => !clienteNome || p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
  );

  const dens = parseDensidade(densidade);
  const vol = parseFloat(volume) || 0;
  const tar = parseFloat(tara) || 0;
  const pesoLiquido = vol * dens;
  const pesoBruto = tar + pesoLiquido;
  const status = dataSaida ? "Expedido" : "No Pátio";

  const isEditing = !!editingVasilhame && !readOnly;
  const isTipoVasilhame = (tipo || "") === "Vasilhame";

  /**
   * Em edição:
   * - tipo Vasilhame → tipo, lote, lacres, tara, eslinga, gps, menor teste, densidade
   * - demais tipos → somente tipo e lote
   * Cadastro novo: todos os campos liberados.
   */
  const canEditField = (field) => {
    if (readOnly) return false;
    if (!isEditing) return true;
    if (field === "tipo" || field === "lote") return true;
    return isTipoVasilhame && EDITABLE_WHEN_VASILHAME.has(field);
  };

  const densLockedByCadastro = !isEditing && densidadeDoCadastro;
  const densEditable = canEditField("densidade") && !densLockedByCadastro;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!placa) {
      setError("Nº da Placa é obrigatório.");
      return;
    }
    if (!produtoNome) {
      setError("Produto é obrigatório.");
      return;
    }
    if (!vol || vol <= 0) {
      setError("Volume deve ser maior que zero.");
      return;
    }
    if (densEditable && dens <= 0) {
      setError("Informe a densidade do produto.");
      return;
    }

    setError("");
    setSaving(true);
    try {
      await onSave({
        numero_op: numeroOp,
        placa,
        barril: barril || null,
        tipo: tipo || null,
        produto_id: emptyToNull(produtoId),
        produto_nome: produtoNome,
        produto_codigo: produtoCodigo || null,
        cliente_id: emptyToNull(clienteId),
        cliente_nome: clienteNome || null,
        densidade: densidade ? String(densidade) : null,
        lote: lote || null,
        volume: vol,
        tara: tar,
        peso_liquido: pesoLiquido,
        peso_bruto: pesoBruto,
        lacres: lacres || null,
        eslinga: eslinga || null,
        gps: gps || null,
        menor_teste: emptyToNull(menorTeste),
        status,
        data_saida: emptyToNull(dataSaida),
        responsavel: responsavel || null,
        fracionado,
      });
    } catch (err) {
      setError(err?.message?.replace(/^\[ChemFlow:[^\]]+\]\s*/, "") || "Não foi possível salvar o tanque.");
    } finally {
      setSaving(false);
    }
  };

  const title = readOnly
    ? "Visualizar Vasilhame"
    : editingVasilhame
    ? "Editar Vasilhame"
    : "Adicionar Tanque";

  /** Em edição, só renderiza campos permitidos; no cadastro/visualização, todos. */
  const showField = (field) => {
    if (readOnly || !isEditing) return true;
    return canEditField(field);
  };

  const showPesosAuto =
    !isEditing || canEditField("densidade") || canEditField("tara");

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
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {(showField("cliente") || showField("produto")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("cliente") && (
                <div className="space-y-1.5">
                  <Label>Cliente *</Label>
                  <SearchableSelect
                    value={clienteNome}
                    onChange={(label, item) => {
                      setClienteNome(label);
                      setClienteId(item?.id || "");
                      setProdutoId("");
                      setProdutoNome("");
                      setProdutoCodigo("");
                      setProdutoDisplay("");
                      setDensidade("");
                      setDensidadeDoCadastro(false);
                    }}
                    options={clientesComProdutos}
                    getOptionLabel={(c) => c.nome}
                    getOptionValue={(c) => c.id}
                    placeholder="Selecione um cliente"
                    disabled={!canEditField("cliente")}
                    inputClassName={INPUT_EDITABLE}
                  />
                </div>
              )}
              {showField("produto") && (
                <div className="space-y-1.5">
                  <Label>Produto *</Label>
                  <SearchableSelect
                    value={produtoDisplay}
                    onChange={(label, item) => {
                      setProdutoDisplay(label);
                      if (item) {
                        setProdutoId(item.id);
                        setProdutoNome(item.produto);
                        setProdutoCodigo(item.codigo || "");
                        const fromCadastro = produtoTemDensidade(item);
                        setDensidadeDoCadastro(fromCadastro);
                        setDensidade(fromCadastro ? item.densidade || "" : "");
                      } else {
                        setProdutoId("");
                        setProdutoNome("");
                        setProdutoCodigo("");
                        setDensidade("");
                        setDensidadeDoCadastro(false);
                      }
                    }}
                    options={filteredProdutos}
                    getOptionLabel={(p) => `${p.codigo || ""} - ${p.produto}`}
                    getOptionValue={(p) => p.id}
                    placeholder={clienteNome ? "Selecione um produto" : "Selecione um cliente primeiro"}
                    disabled={!canEditField("produto") || !clienteNome}
                    inputClassName={INPUT_EDITABLE}
                  />
                </div>
              )}
            </div>
          )}

          {(showField("placa") || showField("barril")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("placa") && (
                <div className="space-y-1.5">
                  <Label>Nº Placa *</Label>
                  <Input
                    value={placa}
                    onChange={(e) => setPlaca(e.target.value)}
                    placeholder="Ex: 25435-2"
                    disabled={!canEditField("placa")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
              {showField("barril") && (
                <div className="space-y-1.5">
                  <Label>Nº Barril</Label>
                  <Input
                    value={barril}
                    onChange={(e) => setBarril(e.target.value)}
                    placeholder="Nº barril"
                    disabled={!canEditField("barril")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <SearchableSelect
                value={tipo}
                onChange={(label) => setTipo(label)}
                options={TIPOS.map((t) => ({ value: t, label: t }))}
                getOptionLabel={(o) => o.label}
                getOptionValue={(o) => o.value}
                placeholder="Selecione..."
                disabled={!canEditField("tipo")}
                inputClassName={INPUT_EDITABLE}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Lote</Label>
              <Input
                value={lote}
                onChange={(e) => setLote(e.target.value)}
                placeholder="Ex: 16090930-25"
                disabled={!canEditField("lote")}
                className={INPUT_EDITABLE}
              />
            </div>
          </div>

          {(showField("volume") || showField("lacres") || showField("fracionado")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("volume") && (
                <div className="space-y-1.5">
                  <Label>Volume (L) *</Label>
                  <NumberInputBr
                    decimals={0}
                    min={0}
                    value={volume}
                    onChange={(v) => setVolume(v === "" ? "" : v)}
                    placeholder="0"
                    disabled={!canEditField("volume")}
                    className={INPUT_EDITABLE}
                  />
                  {showField("fracionado") && (
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        checked={fracionado}
                        onCheckedChange={setFracionado}
                        disabled={!canEditField("fracionado")}
                        id="vasilhame-fracionado"
                      />
                      <Label
                        htmlFor="vasilhame-fracionado"
                        className={`cursor-pointer ${!canEditField("fracionado") ? "pointer-events-none opacity-70" : ""}`}
                      >
                        Fracionado
                      </Label>
                    </div>
                  )}
                </div>
              )}
              {showField("lacres") && (
                <div className="space-y-1.5">
                  <Label>Lacres</Label>
                  <Input
                    value={lacres}
                    onChange={(e) => setLacres(e.target.value)}
                    placeholder="Nº lacres"
                    disabled={!canEditField("lacres")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
            </div>
          )}

          {(showField("tara") || showField("eslinga")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("tara") && (
                <div className="space-y-1.5">
                  <Label>Tara (kg)</Label>
                  <NumberInputBr
                    decimals={0}
                    min={0}
                    value={tara}
                    onChange={(v) => setTara(v === "" ? "" : v)}
                    placeholder="0"
                    disabled={!canEditField("tara")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
              {showField("eslinga") && (
                <div className="space-y-1.5">
                  <Label>Eslinga</Label>
                  <Input
                    value={eslinga}
                    onChange={(e) => setEslinga(e.target.value)}
                    placeholder="Eslinga"
                    disabled={!canEditField("eslinga")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
            </div>
          )}

          {(showField("densidade") || showField("responsavel")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("densidade") && (
                <div className="space-y-1.5">
                  <Label>
                    Densidade {densidadeDoCadastro ? "(Tabelada)" : densEditable ? "*" : ""}
                  </Label>
                  <NumberInputBr
                    decimals={3}
                    value={densidade}
                    onChange={(v) => {
                      setDensidade(v === "" ? "" : v);
                      if (isEditing && isTipoVasilhame) {
                        setDensidadeDoCadastro(false);
                      }
                    }}
                    placeholder={densLockedByCadastro ? "Automático" : "Ex: 1,025"}
                    disabled={!densEditable}
                    className={densEditable ? INPUT_EDITABLE : INPUT_LOCKED}
                  />
                  {densEditable && produtoNome && (
                    <p className="text-xs text-muted-foreground">
                      {isEditing
                        ? "Alterar a densidade recalcula o peso líquido automaticamente."
                        : "Produto sem densidade cadastrada — informe manualmente."}
                    </p>
                  )}
                </div>
              )}
              {showField("responsavel") && (
                <div className="space-y-1.5">
                  <Label>Responsável</Label>
                  <Input
                    value={responsavel}
                    onChange={(e) => setResponsavel(e.target.value)}
                    placeholder="Responsável"
                    disabled={!canEditField("responsavel")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
            </div>
          )}

          {showPesosAuto && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Peso Líquido (kg) - auto</Label>
                <Input value={formatMass(pesoLiquido)} disabled className={INPUT_LOCKED} />
              </div>
              <div className="space-y-1.5">
                <Label>Peso Bruto (kg) - auto</Label>
                <Input value={formatMass(pesoBruto)} disabled className={INPUT_LOCKED} />
              </div>
            </div>
          )}

          {showField("gps") && (
            <div className="space-y-1.5">
              <Label>GPS</Label>
              <Input
                value={gps}
                onChange={(e) => setGps(e.target.value)}
                placeholder="GPS"
                disabled={!canEditField("gps")}
                className={INPUT_EDITABLE}
              />
            </div>
          )}

          {(showField("menor_teste") || showField("data_saida")) && (
            <div className="grid grid-cols-2 gap-4">
              {showField("menor_teste") && (
                <div className="space-y-1.5">
                  <Label>Data Menor Teste</Label>
                  <Input
                    type="date"
                    value={menorTeste}
                    onChange={(e) => setMenorTeste(e.target.value)}
                    disabled={!canEditField("menor_teste")}
                    className={INPUT_EDITABLE}
                  />
                </div>
              )}
              {showField("data_saida") && (
                <div className="space-y-1.5">
                  <Label>Data de Saída</Label>
                  <Input
                    type="date"
                    value={dataSaida}
                    onChange={(e) => setDataSaida(e.target.value)}
                    disabled={!canEditField("data_saida")}
                    className={INPUT_EDITABLE}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ao definir uma data, o status muda para 'Expedido'. Remova a data para reverter para 'No Pátio'.
                  </p>
                </div>
              )}
            </div>
          )}

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={saving}>
                {saving ? "Salvando..." : editingVasilhame ? "Salvar Alterações" : "Adicionar"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
