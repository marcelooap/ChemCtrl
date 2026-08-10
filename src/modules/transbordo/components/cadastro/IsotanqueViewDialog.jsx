import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { formatVolume } from "@transbordo/lib/format";

export default function IsotanqueViewDialog({
  open,
  onClose,
  isotanque,
  allIsotanques,
  descontaminacoes = [],
}) {
  if (!isotanque) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("pt-BR");
  };

  const calcularDias = (inicio, fim) => {
    if (!inicio) return "-";
    const dataIni = new Date(inicio);
    if (isNaN(dataIni)) return "-";
    const dataFim = fim ? new Date(fim) : new Date();
    dataIni.setHours(0, 0, 0, 0);
    dataFim.setHours(0, 0, 0, 0);
    return Math.round((dataFim - dataIni) / (1000 * 60 * 60 * 24));
  };

  const formatCapacidade = (cap) => {
    if (cap == null || cap === "") return "-";
    return `${formatVolume(cap)} L`;
  };

  const locacoes = (allIsotanques || [])
    .filter((it) => it.tanka && it.tanka === isotanque.tanka)
    .map((it) => ({
      id: it.id,
      tipo: "locacao",
      date: it.inicio_locacao,
      produto_nome: it.produto_nome,
      cliente_nome: it.cliente_nome,
    }));

  const desconts = (descontaminacoes || [])
    .filter((d) => d.tanka && d.tanka === isotanque.tanka)
    .map((d) => ({
      id: d.id,
      tipo: "descontaminacao",
      date: d.data_descontaminacao,
    }));

  const historico = [...locacoes, ...desconts].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
  );

  const historicoComTermino = historico.map((item, idx) => {
    if (item.tipo === "descontaminacao") {
      return {
        ...item,
        termino: item.date,
        terminoLabel: "Concluída",
      };
    }
    if (idx === 0) {
      return { ...item, termino: null, terminoLabel: "Em curso" };
    }
    const termino = historico[idx - 1].date;
    return { ...item, termino, terminoLabel: formatDate(termino) };
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Visualizar Isotanque</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Informações do Tanka */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Informações do Tanka
            </h3>
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/40 rounded-lg border border-border">
              <div>
                <p className="text-xs text-muted-foreground">Código ITKU</p>
                <p className="text-sm font-medium text-foreground">
                  {isotanque.codigo_itku}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tanka</p>
                <p className="text-sm font-medium text-foreground">
                  {isotanque.tanka || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Capacidade</p>
                <p className="text-sm font-medium text-foreground">
                  {formatCapacidade(isotanque.capacidade)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Produto em Uso</p>
                <p className="text-sm font-medium text-foreground">
                  {isotanque.produto_nome || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="text-sm font-medium text-foreground">
                  {isotanque.cliente_nome || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Início da Locação</p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(isotanque.inicio_locacao)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dias Locados (Atual)</p>
                <p className="text-sm font-medium text-primary">
                  {calcularDias(isotanque.inicio_locacao)} dias
                </p>
              </div>
            </div>
          </div>

          {/* Histórico de Locação */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Histórico de Locação
            </h3>
            <div className="border border-border rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-foreground/70 border-b-2 border-border bg-muted font-semibold uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-semibold">Produto</th>
                    <th className="px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="px-4 py-2.5 font-semibold">Data Inicial</th>
                    <th className="px-4 py-2.5 font-semibold">Término</th>
                    <th className="px-4 py-2.5 font-semibold">Dias Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historicoComTermino.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-muted-foreground"
                      >
                        Nenhum histórico de locação encontrado.
                      </td>
                    </tr>
                  ) : (
                    historicoComTermino.map((it, i) => {
                      const isDescontam = it.tipo === "descontaminacao";
                      return (
                        <tr
                          key={`${it.tipo}-${it.id}`}
                          className={`border-b border-border last:border-0 ${
                            isDescontam
                              ? "bg-amber-50/80"
                              : i === 0
                              ? "bg-primary/5"
                              : i % 2 === 1
                              ? "bg-muted/30"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 text-foreground">
                            {isDescontam ? (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                                Descontaminação
                              </span>
                            ) : (
                              it.produto_nome || "-"
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {isDescontam ? "—" : it.cliente_nome || "-"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {formatDate(it.date)}
                          </td>
                          <td className="px-4 py-2.5">
                            {isDescontam ? (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                Concluída
                              </span>
                            ) : i === 0 ? (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                Em curso
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {it.terminoLabel}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {isDescontam ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                                {calcularDias(it.date, it.termino)} dias
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
