import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { parseNumero, formatNum } from "@transbordo/lib/format";
import { createEntradaCompleta } from "@transbordo/lib/createEntradaCompleta";
import { persistClienteSelecionado } from "@painel/lib/saidaClientes";
import { normProdutoKey } from "@transbordo/lib/cadastroProdutosCentral";
import { UNIDADES } from "@transbordo/components/entrada/LoteBlock";

const STEPS = {
  PASTE: "paste",
  PREVIEW: "preview",
  IMPORT: "import",
};

const COLUMN_ALIASES = {
  cod: ["cod", "codigo", "código", "produto_codigo", "cod produto"],
  produto: ["produto", "produto_nome", "nome", "descricao", "descrição"],
  cliente: ["cliente", "cliente_nome", "nome_cliente"],
  tipo: ["tipo", "tipo_recebimento", "tipo recebimento"],
  nota_fiscal: [
    "nota fiscal",
    "nota_fiscal",
    "nf",
    "nfe",
    "nota",
    "notafiscal",
  ],
  lote: ["lote", "batch", "lot"],
  quantidade: ["quantidade", "qtd", "qty", "qtde"],
  unidade: ["umid", "unid", "unidade", "unidade_medida", "um", "und"],
  fabricacao: [
    "fabricacao",
    "fabricação",
    "data_fabricacao",
    "data fabricação",
    "fab",
  ],
  validade: [
    "validade",
    "data_validade",
    "data validade",
    "val",
    "vencimento",
  ],
  peso_liquido: [
    "peso / volume liquido",
    "peso / volume líquido",
    "peso/volume liquido",
    "peso/volume líquido",
    "peso liquido",
    "peso líquido",
    "peso_liquido",
    "volume liquido",
    "volume líquido",
    "peso",
    "volume",
  ],
};

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function detectSeparator(headerLine) {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const semis = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return "\t";
  if (semis >= commas && semis > 0) return ";";
  if (commas > 0) return ",";
  return "\t";
}

function splitLine(line, separator) {
  if (separator === "\t") {
    return line.split("\t").map((c) => c.trim());
  }
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === separator && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function mapHeaders(headers) {
  const mapping = {};
  const used = new Set();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const idx = headers.findIndex((h, i) => {
      if (used.has(i)) return false;
      const nh = normalizeHeader(h);
      return normalizedAliases.includes(nh);
    });
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }

  return mapping;
}

function cellAt(cells, mapping, field) {
  const idx = mapping[field];
  if (idx == null || idx < 0) return "";
  return String(cells[idx] ?? "").trim();
}

function isBlankToken(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return !v || v === "-" || v === "—" || v === "n/a" || v === "na";
}

function parseDateBR(value) {
  if (isBlankToken(value)) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return { error: `Data inválida: ${raw}` };
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return { error: `Data inválida: ${raw}` };
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { value: iso };
}

function normalizeUnidade(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.$/, "");

  if (["kg", "quilo", "quilos", "kilogram", "kilograms"].includes(key)) {
    return "kg";
  }
  if (["l", "lt", "litro", "litros"].includes(key)) return "L";
  if (["lb", "lbs", "libra", "libras"].includes(key)) return "lb";
  if (["gal", "gallon", "gallons", "galao", "galoes"].includes(key)) {
    return "gal";
  }
  if (
    ["unid", "un", "und", "unidade", "unidades", "pc", "pcs", "peca", "pecas"].includes(
      key
    )
  ) {
    return "unid.";
  }

  const found = UNIDADES.find(
    (u) => u.toLowerCase() === raw.toLowerCase() || u.toLowerCase() === `${key}.`
  );
  return found || raw;
}

function normalizeTipo(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!key) return "embalado";
  if (key.startsWith("embal")) return "embalado";
  if (key.startsWith("vasilh")) return "vasilhame";
  if (key.startsWith("gran")) return "granel";
  return null;
}

function parsePastedText(text) {
  const cleaned = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!cleaned) {
    return { error: "Cole os dados da planilha para continuar.", rows: [] };
  }

  const lines = cleaned.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return {
      error: "É necessário um cabeçalho e pelo menos uma linha de dados.",
      rows: [],
    };
  }

  const separator = detectSeparator(lines[0]);
  const headers = splitLine(lines[0], separator);
  const mapping = mapHeaders(headers);

  const required = ["cod", "produto", "cliente", "nota_fiscal", "quantidade"];
  const missing = required.filter((f) => mapping[f] == null);
  if (missing.length > 0) {
    return {
      error: `Colunas obrigatórias não encontradas: ${missing.join(", ")}.`,
      rows: [],
    };
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = splitLine(line, separator);
    return {
      lineNumber: index + 2,
      cod: cellAt(cells, mapping, "cod"),
      produto: cellAt(cells, mapping, "produto"),
      cliente: cellAt(cells, mapping, "cliente"),
      tipo: cellAt(cells, mapping, "tipo"),
      nota_fiscal: cellAt(cells, mapping, "nota_fiscal"),
      lote: cellAt(cells, mapping, "lote"),
      quantidade: cellAt(cells, mapping, "quantidade"),
      unidade: cellAt(cells, mapping, "unidade"),
      fabricacao: cellAt(cells, mapping, "fabricacao"),
      validade: cellAt(cells, mapping, "validade"),
      peso_liquido: cellAt(cells, mapping, "peso_liquido"),
    };
  });

  return { error: null, rows, mapping, headers };
}

function resolveProduto(produtos, { codigo, nome, clienteNome }) {
  const codKey = normProdutoKey(codigo);
  const nomeKey = normProdutoKey(nome);
  const clienteKey = normProdutoKey(clienteNome);

  const byCliente = (list) => {
    if (!clienteKey) return list;
    const matched = list.filter(
      (p) => normProdutoKey(p.cliente_nome) === clienteKey
    );
    return matched.length > 0 ? matched : list;
  };

  if (codKey) {
    const byCode = byCliente(
      produtos.filter((p) => normProdutoKey(p.codigo) === codKey)
    );
    if (byCode.length === 1) return byCode[0];
    if (byCode.length > 1 && nomeKey) {
      const byCodeAndName = byCode.filter(
        (p) => normProdutoKey(p.produto) === nomeKey
      );
      if (byCodeAndName[0]) return byCodeAndName[0];
    }
    if (byCode[0]) return byCode[0];
  }

  if (nomeKey) {
    const byName = byCliente(
      produtos.filter((p) => normProdutoKey(p.produto) === nomeKey)
    );
    if (byName[0]) return byName[0];
  }

  return null;
}

function validateAndResolveRow(raw, produtos, clienteCache) {
  const errors = [];
  const clienteNome = String(raw.cliente || "").trim();
  if (!clienteNome) errors.push("Cliente obrigatório");

  const tipo = normalizeTipo(raw.tipo);
  if (!tipo) errors.push(`Tipo inválido: ${raw.tipo || "(vazio)"}`);

  const notaFiscal = String(raw.nota_fiscal || "").trim();
  if (!notaFiscal || isBlankToken(notaFiscal)) {
    errors.push("Nota fiscal obrigatória");
  }

  let lote = String(raw.lote || "").trim();
  if (isBlankToken(lote)) {
    errors.push("Lote obrigatório");
    lote = "";
  } else if (lote.toUpperCase() === "ND") {
    lote = "ND";
  }

  const quantidade = parseNumero(raw.quantidade);
  if (!(quantidade > 0)) errors.push("Quantidade deve ser positiva");

  const unidade = normalizeUnidade(raw.unidade);
  if (!unidade) {
    errors.push("Unidade de medida obrigatória");
  } else if (!UNIDADES.includes(unidade)) {
    errors.push(`Unidade inválida: ${raw.unidade}`);
  }

  const fab = parseDateBR(raw.fabricacao);
  if (fab?.error) errors.push(fab.error);
  const val = parseDateBR(raw.validade);
  if (val?.error) errors.push(val.error);

  const pesoLiquido = parseNumero(raw.peso_liquido);
  let quantidadeEmbalagens = null;

  if (tipo === "embalado") {
    if (!(pesoLiquido > 0)) {
      errors.push("Peso/volume líquido obrigatório para embalado");
    } else {
      quantidadeEmbalagens = quantidade / pesoLiquido;
      if (
        !Number.isFinite(quantidadeEmbalagens) ||
        Math.abs(pesoLiquido * quantidadeEmbalagens - quantidade) > 0.001
      ) {
        errors.push("Peso líquido incompatível com a quantidade");
      }
    }
  }

  const produto = resolveProduto(produtos, {
    codigo: raw.cod,
    nome: raw.produto,
    clienteNome,
  });

  if (!produto) {
    errors.push(
      `Produto não encontrado (código ${raw.cod || "—"} / ${raw.produto || "—"})`
    );
  }

  const clienteCached = clienteNome
    ? clienteCache.get(clienteNome.toLowerCase())
    : null;

  return {
    ...raw,
    tipo,
    lote,
    quantidade,
    unidade,
    peso_liquido: pesoLiquido > 0 ? pesoLiquido : null,
    quantidade_embalagens: quantidadeEmbalagens,
    data_fabricacao: fab?.value || null,
    data_validade: val?.value || null,
    produto_id: produto?.id || "",
    produto_codigo: produto?.codigo || String(raw.cod || "").trim(),
    produto_nome: produto?.produto || String(raw.produto || "").trim(),
    densidade: produto?.densidade || null,
    cliente_id: clienteCached?.id || "",
    cliente_nome: clienteCached?.nome || clienteNome,
    errors,
    valid: errors.length === 0,
    status: "pending",
    importError: null,
  };
}

function buildEntradaPayload(row) {
  const isEmbalado = row.tipo === "embalado";
  const lote = {
    produto_id: row.produto_id || null,
    produto_nome: row.produto_nome,
    produto_codigo: row.produto_codigo,
    nota_fiscal: row.nota_fiscal,
    lote: row.lote,
    densidade: isEmbalado ? null : row.densidade,
    quantidade: row.quantidade,
    unidade_medida: row.unidade,
    data_fabricacao: row.data_fabricacao,
    data_validade: row.data_validade,
    preco_unitario: 0,
    tipo_recebimento: row.tipo,
    embalado: isEmbalado,
    peso_liquido: isEmbalado ? row.peso_liquido : null,
    quantidade_embalagens: isEmbalado ? row.quantidade_embalagens : null,
  };

  return {
    data: todayISO(),
    cliente_id: row.cliente_id,
    cliente_nome: row.cliente_nome,
    produto_id: lote.produto_id,
    produto_nome: lote.produto_nome,
    produto_codigo: lote.produto_codigo,
    nota_fiscal: lote.nota_fiscal,
    lote: lote.lote,
    densidade: lote.densidade,
    data_fabricacao: lote.data_fabricacao,
    data_validade: lote.data_validade,
    saldo_inicial: row.quantidade,
    quantidade: row.quantidade,
    unidade_medida: isEmbalado ? row.unidade : "kg",
    preco_unitario: 0,
    custo_total: 0,
    saldo_final: row.quantidade,
    saldo_atual: row.quantidade,
    embalado: isEmbalado,
    peso_liquido: lote.peso_liquido,
    quantidade_embalagens: lote.quantidade_embalagens,
    status_wms: false,
    granel_pesagem: false,
    granel_ticket: null,
    granel_peso_bruto: null,
    granel_validacao_bruto: null,
    granel_peso_liquido: null,
    granel_validacao_liquido: null,
    granel_erro_admissivel: null,
    granel_peso_minimo: null,
    granel_peso_maximo: null,
    granel_margem: null,
    grupo_entrada: `GRP-IMP-${Date.now()}-${row.lineNumber}`,
    origem: "convencional",
    lotes: [lote],
  };
}

export default function EntradaImportModal({
  open,
  onClose,
  produtos = [],
  onImported,
}) {
  const [step, setStep] = useState(STEPS.PASTE);
  const [pasteText, setPasteText] = useState("");
  const [parseError, setParseError] = useState("");
  const [rows, setRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [finished, setFinished] = useState(false);

  const reset = useCallback(() => {
    setStep(STEPS.PASTE);
    setPasteText("");
    setParseError("");
    setRows([]);
    setImporting(false);
    setCurrentIndex(-1);
    setFinished(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const invalidCount = rows.length - validRows.length;
  const successCount = rows.filter((r) => r.status === "success").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  const handleAnalyze = async () => {
    setParseError("");
    const parsed = parsePastedText(pasteText);
    if (parsed.error) {
      setParseError(parsed.error);
      return;
    }

    const clienteCache = new Map();
    const uniqueClientes = [
      ...new Set(
        parsed.rows
          .map((r) => String(r.cliente || "").trim())
          .filter(Boolean)
      ),
    ];

    try {
      await Promise.all(
        uniqueClientes.map(async (nome) => {
          const persisted = await persistClienteSelecionado(null, nome);
          clienteCache.set(nome.toLowerCase(), {
            id: persisted?.id || "",
            nome: persisted?.nome || nome,
          });
        })
      );
    } catch (err) {
      setParseError(
        err?.message || "Não foi possível resolver os clientes da planilha."
      );
      return;
    }

    const resolved = parsed.rows.map((raw) =>
      validateAndResolveRow(raw, produtos, clienteCache)
    );
    setRows(resolved);
    setStep(STEPS.PREVIEW);
  };

  const handleImport = async ({ onlyValid = true } = {}) => {
    const targets = onlyValid ? validRows : rows.filter((r) => r.valid);
    if (targets.length === 0) return;

    setStep(STEPS.IMPORT);
    setImporting(true);
    setFinished(false);
    setCurrentIndex(0);

    const targetKeys = new Set(targets.map((r) => r.lineNumber));
    setRows((prev) =>
      prev.map((r) =>
        targetKeys.has(r.lineNumber)
          ? { ...r, status: "pending", importError: null }
          : r
      )
    );

    let ok = 0;
    let fail = 0;

    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      setCurrentIndex(i);

      try {
        const cliente = await persistClienteSelecionado(
          target.cliente_id,
          target.cliente_nome
        );
        if (!cliente?.id) {
          throw new Error("Cliente inválido.");
        }

        const payload = buildEntradaPayload({
          ...target,
          cliente_id: cliente.id,
          cliente_nome: cliente.nome || target.cliente_nome,
        });

        await createEntradaCompleta({ data: payload, produtos });

        ok += 1;
        setRows((prev) =>
          prev.map((r) =>
            r.lineNumber === target.lineNumber
              ? { ...r, status: "success", importError: null }
              : r
          )
        );
      } catch (err) {
        fail += 1;
        setRows((prev) =>
          prev.map((r) =>
            r.lineNumber === target.lineNumber
              ? {
                  ...r,
                  status: "error",
                  importError: err?.message || "Falha ao salvar entrada",
                }
              : r
          )
        );
      }
    }

    setImporting(false);
    setFinished(true);
    setCurrentIndex(targets.length);

    if (ok > 0 && typeof onImported === "function") {
      try {
        await onImported({ success: ok, failed: fail });
      } catch {
        /* reload errors are non-blocking */
      }
    }
  };

  const handleClose = () => {
    if (importing) return;
    onClose?.();
  };

  const title =
    step === STEPS.PASTE
      ? "Importar Entradas"
      : step === STEPS.PREVIEW
        ? "Revisar Importação"
        : "Importando Entradas";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {step === STEPS.PASTE && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Cole a planilha com cabeçalho (Excel/Sheets). Colunas esperadas:{" "}
                <span className="font-medium text-foreground">
                  cod, produto, cliente, tipo, nota fiscal, lote, quantidade,
                  umid, fabricação, validade, Peso / volume Líquido
                </span>
                . Cada linha vira uma entrada independente.
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entrada-import-paste">Dados da planilha</Label>
                <textarea
                  id="entrada-import-paste"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Cole aqui as linhas copiadas da planilha..."
                  className="w-full min-h-[280px] rounded-md border border-input bg-white px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          )}

          {step === STEPS.PREVIEW && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  Total:{" "}
                  <span className="font-medium text-foreground">
                    {rows.length}
                  </span>
                </span>
                <span className="text-green-700">
                  Válidas:{" "}
                  <span className="font-medium">{validRows.length}</span>
                </span>
                {invalidCount > 0 && (
                  <span className="text-red-700">
                    Com erro: <span className="font-medium">{invalidCount}</span>
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-left text-muted-foreground uppercase sticky top-0">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Produto</th>
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 font-medium">NF</th>
                        <th className="px-3 py-2 font-medium">Lote</th>
                        <th className="px-3 py-2 font-medium">Qtd</th>
                        <th className="px-3 py-2 font-medium">Un.</th>
                        <th className="px-3 py-2 font-medium">Fab.</th>
                        <th className="px-3 py-2 font-medium">Val.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.lineNumber}
                          className={`border-t border-border align-top ${
                            row.valid ? "bg-white" : "bg-red-50/60"
                          }`}
                        >
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.lineNumber}
                          </td>
                          <td className="px-3 py-2">
                            {row.valid ? (
                              <span className="inline-flex items-center gap-1 text-green-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                OK
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-start gap-1 text-red-700"
                                title={row.errors.join("; ")}
                              >
                                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span className="leading-snug">
                                  {row.errors[0]}
                                  {row.errors.length > 1
                                    ? ` (+${row.errors.length - 1})`
                                    : ""}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">
                              {row.produto_codigo || row.cod || "—"}
                            </div>
                            <div className="text-muted-foreground truncate max-w-[180px]">
                              {row.produto_nome || row.produto || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            {row.cliente_nome || "—"}
                          </td>
                          <td className="px-3 py-2">{row.tipo || "—"}</td>
                          <td className="px-3 py-2">{row.nota_fiscal || "—"}</td>
                          <td className="px-3 py-2">{row.lote || "—"}</td>
                          <td className="px-3 py-2 font-medium">
                            {row.quantidade > 0
                              ? formatNum(row.quantidade, 3)
                              : "—"}
                          </td>
                          <td className="px-3 py-2">{row.unidade || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.data_fabricacao
                              ? row.data_fabricacao
                                  .split("-")
                                  .reverse()
                                  .join("/")
                              : "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.data_validade
                              ? row.data_validade
                                  .split("-")
                                  .reverse()
                                  .join("/")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === STEPS.IMPORT && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Progresso
                    {importing && currentIndex >= 0
                      ? `: ${Math.min(currentIndex + 1, validRows.length)} / ${validRows.length}`
                      : finished
                        ? `: ${validRows.length} / ${validRows.length}`
                        : ""}
                  </span>
                  {importing && (
                    <span className="inline-flex items-center gap-2 text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importando...
                    </span>
                  )}
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: `${
                        validRows.length
                          ? ((successCount + errorCount) / validRows.length) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-green-700">
                    Sucesso: <span className="font-semibold">{successCount}</span>
                  </span>
                  <span className="text-red-700">
                    Erro: <span className="font-semibold">{errorCount}</span>
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-left text-muted-foreground uppercase sticky top-0">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Produto</th>
                        <th className="px-3 py-2 font-medium">NF / Lote</th>
                        <th className="px-3 py-2 font-medium">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((r) => r.valid)
                        .map((row, idx) => {
                          const isCurrent =
                            importing && idx === currentIndex;
                          return (
                            <tr
                              key={row.lineNumber}
                              className={`border-t border-border ${
                                isCurrent
                                  ? "bg-primary/5"
                                  : row.status === "success"
                                    ? "bg-green-50/50"
                                    : row.status === "error"
                                      ? "bg-red-50/60"
                                      : ""
                              }`}
                            >
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.lineNumber}
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium">
                                  {row.produto_codigo}
                                </div>
                                <div className="text-muted-foreground truncate max-w-[220px]">
                                  {row.produto_nome}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {row.nota_fiscal} · {row.lote}
                              </td>
                              <td className="px-3 py-2">
                                {row.status === "success" && (
                                  <span className="inline-flex items-center gap-1 text-green-700">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Criada
                                  </span>
                                )}
                                {row.status === "error" && (
                                  <span
                                    className="inline-flex items-start gap-1 text-red-700"
                                    title={row.importError || ""}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    {row.importError || "Erro"}
                                  </span>
                                )}
                                {row.status === "pending" && (
                                  <span className="text-muted-foreground">
                                    {isCurrent ? "Processando..." : "Aguardando"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {finished && (
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                  Importação concluída:{" "}
                  <span className="font-semibold text-green-700">
                    {successCount} criadas com sucesso
                  </span>
                  {errorCount > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold text-red-700">
                        {errorCount} com erro
                      </span>
                    </>
                  )}
                  .
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          {step === STEPS.PASTE && (
            <>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleAnalyze}>
                Analisar planilha
              </Button>
            </>
          )}

          {step === STEPS.PREVIEW && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(STEPS.PASTE)}
              >
                Voltar
              </Button>
              <Button
                type="button"
                disabled={validRows.length === 0}
                onClick={() => handleImport({ onlyValid: true })}
                title={
                  validRows.length === 0
                    ? "Nenhuma linha válida para importar"
                    : undefined
                }
              >
                {invalidCount === 0
                  ? `Importar ${validRows.length} entradas`
                  : `Importar apenas válidas (${validRows.length})`}
              </Button>
            </>
          )}

          {step === STEPS.IMPORT && (
            <>
              <div />
              <Button
                type="button"
                disabled={importing}
                onClick={handleClose}
              >
                {finished ? "Concluir" : "Fechar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
