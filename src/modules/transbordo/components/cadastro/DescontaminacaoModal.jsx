import { useEffect, useMemo, useState } from "react";
import { FileDown, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Label } from "@shared/components/ui/label";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import { getUserDisplayName } from "@shared/lib/userDisplay";
import { generateDescontaminacoesPDF } from "@transbordo/lib/pdfDescontaminacao";
import {
  currentMonthBounds,
  todayIso,
  enrichDescontaminacao,
  filterDescontaminacoesByPeriod,
  formatDateBr,
  normalizePeriod,
  periodLabel,
  sortDescontaminacoes,
} from "@transbordo/lib/descontaminacao";

function RegistrarDescontaminacaoDialog({ open, onClose, onSave, isotanques }) {
  const [tanka, setTanka] = useState("");
  const [dataDescontaminacao, setDataDescontaminacao] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const tankaOptions = useMemo(() => {
    const unique = [
      ...new Set(
        (isotanques || []).map((it) => it.tanka?.trim()).filter(Boolean)
      ),
    ];
    return unique
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
      .map((t) => ({ id: t, nome: t }));
  }, [isotanques]);

  useEffect(() => {
    if (!open) return;
    setTanka("");
    setDataDescontaminacao(todayIso());
    setError("");
    setSaving(false);
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const tankaNorm = tanka?.trim();
    if (!tankaNorm) {
      setError("Informe o TANKA.");
      return;
    }
    const match = tankaOptions.find(
      (o) => o.nome.toLowerCase() === tankaNorm.toLowerCase()
    );
    if (!match) {
      setError("Tanka não encontrado. Digite ou selecione um tanka cadastrado.");
      return;
    }
    if (!dataDescontaminacao) {
      setError("Informe a data da descontaminação.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        tanka: match.nome,
        data_descontaminacao: dataDescontaminacao,
      });
      setSaving(false);
    } catch (err) {
      setError(err?.message || "Não foi possível registrar a descontaminação.");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="z-[60] max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar Descontaminação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-1.5">
            <Label>TANKA *</Label>
            <SearchableSelect
              options={tankaOptions}
              value={tanka}
              onChange={(label) => setTanka(label || "")}
              placeholder="Digite ou selecione o tanka"
              disabled={saving || tankaOptions.length === 0}
              inputClassName="bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Data da Descontaminação *</Label>
            <DateInputBr
              value={dataDescontaminacao}
              onChange={setDataDescontaminacao}
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || tankaOptions.length === 0}>
              {saving ? "Salvando..." : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DescontaminacaoModal({
  open,
  onClose,
  onSave,
  isotanques,
  descontaminacoes,
}) {
  const { user } = useInternalAuth();
  const month = currentMonthBounds();
  const [de, setDe] = useState(month.start);
  const [ate, setAte] = useState(month.end);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (open) {
      const bounds = currentMonthBounds();
      setDe(bounds.start);
      setAte(bounds.end);
    }
    setFormOpen(false);
  }, [open]);

  const rows = useMemo(() => {
    const enriched = (descontaminacoes || []).map((item) =>
      enrichDescontaminacao(item, isotanques)
    );
    return sortDescontaminacoes(
      filterDescontaminacoesByPeriod(enriched, de, ate)
    );
  }, [descontaminacoes, isotanques, de, ate]);

  const period = normalizePeriod(de, ate);
  const countLabel =
    rows.length === 1
      ? "1 descontaminação no período"
      : `${rows.length} descontaminações no período`;

  const handlePdf = () => {
    generateDescontaminacoesPDF(rows, {
      de: period.from,
      ate: period.to,
      emitidoPor: getUserDisplayName(user),
    });
  };

  const handleSave = async (data) => {
    await onSave(data);
    const saved = String(data.data_descontaminacao || "").slice(0, 10);
    if (saved) {
      setDe((prev) => (prev && saved < prev ? saved : prev));
      setAte((prev) => (prev && saved > prev ? saved : prev));
    }
    setFormOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-[min(96vw,72rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 px-5 pb-3 pt-5 pr-12">
          <DialogTitle>Descontaminações</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Descontaminações do período. O último produto é o que estava em uso
            no tanka antes da limpeza.
          </p>
        </DialogHeader>

        <div className="flex shrink-0 flex-col gap-3 border-y border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Período
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">De</Label>
                <DateInputBr
                  value={de}
                  onChange={setDe}
                  className="w-[11.5rem] [&_input]:bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Até</Label>
                <DateInputBr
                  value={ate}
                  onChange={setAte}
                  className="w-[11.5rem] [&_input]:bg-white"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={handlePdf} className="h-9 gap-2">
              <FileDown className="h-4 w-4" />
              Gerar PDF
            </Button>
            <Button type="button" onClick={() => setFormOpen(true)} className="h-9 gap-2">
              <Plus className="h-4 w-4" />
              Nova Descontaminação
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b-2 border-border bg-muted text-left text-xs uppercase tracking-wide text-foreground/70">
                <th className="px-5 py-3 font-semibold">Data</th>
                <th className="px-5 py-3 font-semibold">Tanka</th>
                <th className="px-5 py-3 font-semibold">Código ITKU</th>
                <th className="px-5 py-3 font-semibold">Cliente</th>
                <th className="px-5 py-3 font-semibold" title="Produto em uso no tanka antes da descontaminação">
                  Último produto
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                    Nenhuma descontaminação no período selecionado.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={row.id || `${row.tanka}-${row.data_descontaminacao}-${i}`}
                    className={`border-b border-border last:border-0 ${
                      i % 2 === 1 ? "bg-muted/40" : "bg-background"
                    }`}
                  >
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">
                      {formatDateBr(row.data_descontaminacao)}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                        {row.tanka}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-primary">
                      {row.codigo_itku}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {row.cliente_nome}
                    </td>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {row.ultimo_produto}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
          <span className="text-muted-foreground">{countLabel}</span>
          <span className="text-muted-foreground">
            Período:{" "}
            <span className="font-medium text-foreground">
              {periodLabel(de, ate)}
            </span>
          </span>
        </div>

        <RegistrarDescontaminacaoDialog
          open={formOpen && open}
          onClose={() => setFormOpen(false)}
          onSave={handleSave}
          isotanques={isotanques}
        />
      </DialogContent>
    </Dialog>
  );
}
