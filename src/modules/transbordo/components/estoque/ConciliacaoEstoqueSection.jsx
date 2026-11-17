import { useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import { useToast } from "@shared/components/ui/use-toast";
import {
  detectColumnMapping,
  parseProteusRows,
  readProteusSpreadsheet,
  reconcileEstoque,
} from "@transbordo/lib/conciliacaoEstoque";
import { fetchIndustrializacaoStocksForConciliacao } from "@transbordo/lib/conciliacaoEstoqueIndFetch";
import { exportConciliacaoEstoqueExcel } from "@transbordo/lib/exportConciliacaoEstoqueExcel";

const ACCEPT = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

function SummaryCard({ label, value, emphasize = false }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 min-w-[7.5rem]">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          emphasize ? "text-amber-700 dark:text-amber-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ColumnSelect({ id, label, value, onChange, headers, required }) {
  return (
    <div className="space-y-1.5 min-w-[10rem] flex-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </Label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">Selecionar coluna…</option>
        {headers.map((header, index) => (
          <option key={`${index}-${header}`} value={index}>
            {header || `(Coluna ${index + 1})`}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ConciliacaoEstoqueSection({ estoqueItems = [] }) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({
    produto: null,
    lote: null,
    saldo: null,
    unidade: null,
  });
  const [needsManualMapping, setNeedsManualMapping] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resultRows, setResultRows] = useState(null);
  const [summary, setSummary] = useState(null);

  const mappingComplete = useMemo(
    () =>
      mapping.produto != null &&
      mapping.lote != null &&
      mapping.saldo != null,
    [mapping]
  );

  const resetResult = () => {
    setResultRows(null);
    setSummary(null);
  };

  const clearFile = () => {
    setFile(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({ produto: null, lote: null, saldo: null, unidade: null });
    setNeedsManualMapping(false);
    setLoadError("");
    resetResult();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = async (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;

    setProcessing(true);
    setLoadError("");
    resetResult();

    try {
      const parsed = await readProteusSpreadsheet(selected);
      if (parsed.error) {
        clearFile();
        setLoadError(parsed.error);
        toast({
          title: "Conciliação de Estoque",
          description: parsed.error,
          variant: "destructive",
        });
        return;
      }

      if (!parsed.headers.length || !parsed.rows.length) {
        clearFile();
        const msg = "A planilha está vazia ou sem dados.";
        setLoadError(msg);
        toast({
          title: "Conciliação de Estoque",
          description: msg,
          variant: "destructive",
        });
        return;
      }

      const detected = detectColumnMapping(parsed.headers);
      setFile(selected);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping({
        produto: detected.produto,
        lote: detected.lote,
        saldo: detected.saldo,
        unidade: detected.unidade,
      });
      setNeedsManualMapping(detected.missing.length > 0);

      if (detected.missing.length > 0) {
        toast({
          title: "Mapeamento necessário",
          description: `Selecione manualmente: ${detected.missing.join(", ")}. Preferência: Produto, Lote e Saldo Lote.`,
        });
      }
    } catch (err) {
      console.error(err);
      clearFile();
      const msg = "Não foi possível ler o arquivo. Verifique o formato.";
      setLoadError(msg);
      toast({
        title: "Conciliação de Estoque",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleProcess = async () => {
    if (!file || !mappingComplete) {
      toast({
        title: "Conciliação de Estoque",
        description: "Anexe um arquivo e confirme as colunas Produto, Lote e Saldo.",
        variant: "destructive",
      });
      return;
    }

    setProcessing(true);
    setLoadError("");
    try {
      // Yield para pintar o spinner
      await new Promise((r) => setTimeout(r, 0));

      const { rows: proteusRows, invalidBalance, skippedEmpty } =
        parseProteusRows(rawRows, mapping);

      if (!proteusRows.length) {
        const msg =
          invalidBalance > 0
            ? "Nenhuma linha válida encontrada. Verifique códigos, lotes e saldos numéricos."
            : "Nenhuma linha válida encontrada na planilha.";
        setLoadError(msg);
        resetResult();
        toast({
          title: "Conciliação de Estoque",
          description: msg,
          variant: "destructive",
        });
        return;
      }

      let industrializacaoStocks = [];
      try {
        industrializacaoStocks =
          await fetchIndustrializacaoStocksForConciliacao();
      } catch (indErr) {
        console.warn("[Conciliação] Industrialização:", indErr);
        industrializacaoStocks = [];
      }

      const { rows, summary: nextSummary } = reconcileEstoque(
        proteusRows,
        estoqueItems,
        { industrializacaoStocks }
      );

      setResultRows(rows);
      setSummary(nextSummary);

      const extras = [];
      if (invalidBalance > 0) {
        extras.push(`${invalidBalance} linha(s) com saldo inválido ignorada(s)`);
      }
      if (skippedEmpty > 0) {
        extras.push(`${skippedEmpty} linha(s) incompleta(s) ignorada(s)`);
      }

      toast({
        title: "Conciliação concluída",
        description:
          extras.length > 0
            ? `${nextSummary.total} registro(s) processado(s). ${extras.join(". ")}.`
            : `${nextSummary.total} registro(s) processado(s).`,
      });
    } catch (err) {
      console.error(err);
      const msg = "Falha ao processar a conciliação.";
      setLoadError(msg);
      toast({
        title: "Conciliação de Estoque",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!resultRows?.length) return;
    setDownloading(true);
    try {
      await exportConciliacaoEstoqueExcel(resultRows);
      toast({ title: "Download iniciado" });
    } catch (err) {
      console.error(err);
      toast({
        title: "Conciliação de Estoque",
        description: "Não foi possível gerar o Excel de resultado.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="shrink-0 bg-card rounded-xl border border-border shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
            Conciliação de Estoque
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Compare os saldos do Proteus com o estoque atual do ChemCtrl. Somente
            leitura — nenhum dado é alterado.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={processing}
        >
          <Upload className="w-4 h-4" />
          Anexar planilha
        </Button>

        {file ? (
          <div className="flex items-center gap-2 min-w-0 flex-1 text-sm text-foreground">
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
            <button
              type="button"
              onClick={clearFile}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Remover arquivo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            Aceita .xlsx e .csv
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button
            type="button"
            onClick={handleProcess}
            disabled={!file || !mappingComplete || processing}
          >
            {processing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            Processar conciliação
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleDownload}
            disabled={!resultRows?.length || downloading || processing}
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Baixar Excel
          </Button>
        </div>
      </div>

      {(needsManualMapping || (file && headers.length > 0)) && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {needsManualMapping
              ? "Selecione as colunas correspondentes da planilha Proteus:"
              : "Colunas identificadas (ajuste se necessário):"}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <ColumnSelect
              id="conc-col-produto"
              label="Produto / Código"
              value={mapping.produto}
              onChange={(v) => {
                setMapping((m) => ({ ...m, produto: v }));
                resetResult();
              }}
              headers={headers}
              required
            />
            <ColumnSelect
              id="conc-col-lote"
              label="Lote"
              value={mapping.lote}
              onChange={(v) => {
                setMapping((m) => ({ ...m, lote: v }));
                resetResult();
              }}
              headers={headers}
              required
            />
            <ColumnSelect
              id="conc-col-saldo"
              label="Saldo"
              value={mapping.saldo}
              onChange={(v) => {
                setMapping((m) => ({ ...m, saldo: v }));
                resetResult();
              }}
              headers={headers}
              required
            />
          </div>
        </div>
      )}

      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resumo da conciliação
          </p>
          <div className="flex flex-wrap gap-2">
            <SummaryCard
              label="Nos dois sistemas"
              value={summary.matched}
            />
            <SummaryCard
              label="Só ChemCtrl"
              value={summary.onlyChemCtrl}
            />
            <SummaryCard
              label="Só Proteus"
              value={summary.onlyProteus}
            />
            <SummaryCard
              label="Saldos iguais"
              value={summary.equal}
            />
            <SummaryCard
              label="Saldos divergentes"
              value={summary.divergent}
              emphasize={summary.divergent > 0}
            />
            {summary.ambiguous > 0 ? (
              <SummaryCard
                label="Ambíguos (unidade)"
                value={summary.ambiguous}
                emphasize
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
