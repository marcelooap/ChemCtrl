import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { formatVolume, formatMass, formatDensidade, parseDensidade } from "@transbordo/lib/format";

const formatDate = (d) => {
  if (!d) return "-";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

/** Extrai só o nome do produto de rótulos como "TANKA 46 - PRODUTO (1.234 L)". */
function origemProdutoNome(origem, fallbackProduto) {
  const codigo = origem?.entrada_codigo || "";
  if (codigo) {
    const withoutVol = codigo.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const sep = withoutVol.indexOf(" - ");
    if (sep >= 0) {
      const nome = withoutVol.slice(sep + 3).trim();
      if (nome) return nome;
    }
  }
  return fallbackProduto || "-";
}

export default function TransbordoViewDialog({ open, onClose, transbordo }) {
  if (!transbordo) return null;

  const produtoNome = transbordo.produto_nome || "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Transbordo {transbordo.codigo_transbordo || ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Dados Gerais */}
          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">Dados Gerais</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Data" value={formatDate(transbordo.data)} />
              <Info label="Produto" value={`${transbordo.produto_codigo || ""} - ${transbordo.produto_nome || ""}`} />
              <Info label="Cliente" value={transbordo.cliente_nome || "-"} />
              <Info label="Densidade" value={formatDensidade(transbordo.densidade)} />
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Operadores</p>
                <div className="flex flex-wrap gap-1.5">
                  {(transbordo.operadores || []).map((op) => (
                    <span key={op} className="inline-flex px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {op}
                    </span>
                  ))}
                </div>
              </div>
              {transbordo.observacoes && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Observações</p>
                  <p className="text-sm text-foreground">{transbordo.observacoes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Origens */}
          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">Origens</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 font-medium">Lote</th>
                    <th className="px-3 py-2 font-medium">Vol. Retirado (L)</th>
                    <th className="px-3 py-2 font-medium">Massa (kg)</th>
                    <th className="px-3 py-2 font-medium">Saldo Restante (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {(transbordo.origens || []).flatMap((o, i) => {
                    const lotes = (o.lotes_retirados || []).filter(
                      (l) => (l.volume_retirado || 0) > 0
                    );
                    const produtoOrigem = origemProdutoNome(o, produtoNome);
                    if (lotes.length > 1) {
                      return lotes.map((l, li) => (
                        <tr
                          key={`${i}-${li}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-3 py-2 text-foreground">
                            {produtoOrigem}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {l.lote || "-"}
                          </td>
                          <td className="px-3 py-2 text-foreground font-medium">
                            {formatVolume(l.volume_retirado, { empty: "-" })}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatMass(
                              (l.volume_retirado || 0) *
                                (parseFloat(
                                  String(transbordo.densidade || "0").replace(",", ".")
                                ) || 0),
                              { empty: "-" }
                            )}
                          </td>
                          <td className="px-3 py-2 text-green-700 font-medium">
                            {formatVolume(
                              Math.max(
                                0,
                                (l.saldo_disponivel || 0) - (l.volume_retirado || 0)
                              ),
                              { empty: "-" }
                            )}
                          </td>
                        </tr>
                      ));
                    }
                    return [
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-foreground">
                          {produtoOrigem}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {o.lote || "-"}
                        </td>
                        <td className="px-3 py-2 text-foreground font-medium">
                          {formatVolume(o.volume_retirado, { empty: "-" })}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatMass(o.massa_retirada, { empty: "-" })}
                        </td>
                        <td className="px-3 py-2 text-green-700 font-medium">
                          {formatVolume(o.saldo_restante, { empty: "-" })}
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Destinos */}
          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">Destinos</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Nº Placa</th>
                    <th className="px-3 py-2 font-medium">Nº Barril</th>
                    <th className="px-3 py-2 font-medium">Volume (L)</th>
                    <th className="px-3 py-2 font-medium">Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {(transbordo.destinos || []).map((d, i) => {
                    const placa =
                      d.tipo_embalagem === "Tankagem"
                        ? d.tanka_codigo || "-"
                        : d.placa || "-";
                    const barril = d.barril || "-";
                    const volume =
                      d.tipo_embalagem === "Tankagem"
                        ? d.volume
                        : d.volume_total;
                    const dens = parseDensidade(transbordo.densidade);
                    const massa =
                      d.peso_liquido != null
                        ? d.peso_liquido
                        : (volume || 0) * dens;
                    return (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-foreground font-medium">{d.tipo_embalagem || "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{placa}</td>
                        <td className="px-3 py-2 text-muted-foreground">{barril}</td>
                        <td className="px-3 py-2 text-primary font-medium">{formatVolume(volume, { empty: "-" })}</td>
                        <td className="px-3 py-2 text-muted-foreground">{formatMass(massa, { empty: "-" })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totais */}
          <div className="rounded-lg border border-border bg-muted/40 p-4 flex justify-between text-sm">
            <span className="text-muted-foreground">
              Volume Total: <span className="font-bold text-foreground">{formatVolume(transbordo.volume_total, { empty: "-" })} L</span>
            </span>
            <span className="text-muted-foreground">
              Massa Total: <span className="font-bold text-foreground">{formatMass(transbordo.massa_total, { empty: "-" })} kg</span>
            </span>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground font-medium">{value}</p>
    </div>
  );
}
