import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Package, CheckCircle, AlertCircle } from "lucide-react";
import { formatMass, formatVolume, formatDensidade } from "@transbordo/lib/format";
import { origemPertenceAEntrada } from "@transbordo/lib/entradaCodigo";

const formatDate = (dateStr) => {
  if (!dateStr) return "-";
  const raw = String(dateStr);
  const d = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("pt-BR");
};

function resolveDensidade(lote, produtosById) {
  const produto =
    (lote.produto_id && produtosById.get(lote.produto_id)) ||
    [...produtosById.values()].find(
      (p) =>
        p.codigo === lote.produto_codigo ||
        p.nome === lote.produto_nome
    );

  if (produto?.densidade_tabelada && produto.densidade != null && produto.densidade !== "") {
    return produto.densidade;
  }
  return lote.densidade;
}

function formatDestino(d) {
  if (d.tipo_embalagem === "Tankagem") {
    return d.tanka_codigo || "Tankagem";
  }

  const isVasilhame =
    d.tipo_embalagem === "Vasilhame" || d.placa || d.barril;

  if (isVasilhame && (d.placa || d.barril)) {
    const parts = [];
    if (d.placa) parts.push(`Nº Placa ${d.placa}`);
    if (d.barril) parts.push(`Nº Barril ${d.barril}`);
    return parts.join(" · ");
  }

  if (d.tipo_embalagem === "One Way (IBC)" || d.tipo_embalagem === "Bombona 200 L" || d.tipo_embalagem === "Tambor 200 L") {
    return d.tipo_embalagem;
  }

  return d.tipo_embalagem || d.tanka_codigo || "-";
}

function destinoVolume(d) {
  if (d.tipo_embalagem === "Tankagem") return Number(d.volume) || 0;
  return Number(d.volume_total ?? d.volume) || 0;
}

function destinoMassa(d, densidade) {
  if (d.peso_liquido != null && d.peso_liquido !== "") {
    return Number(d.peso_liquido) || 0;
  }
  return destinoVolume(d) * (Number(densidade) || 0);
}

export default function ComunicacaoRecebimentoDialog({
  open,
  onClose,
  entrada,
  entradaId,
  produtos = [],
  transbordos = [],
  estoque = [],
}) {
  const produtosById = useMemo(() => {
    const map = new Map();
    produtos.forEach((p) => map.set(p.id, p));
    return map;
  }, [produtos]);

  const lotes = useMemo(() => {
    if (!entrada) return [];
    if (entrada.lotes?.length > 0) return entrada.lotes;
    return [
      {
        produto_id: entrada.produto_id,
        produto_nome: entrada.produto_nome,
        produto_codigo: entrada.produto_codigo,
        nota_fiscal: entrada.nota_fiscal,
        lote: entrada.lote,
        quantidade: entrada.quantidade,
        unidade_medida: entrada.unidade_medida,
        data_fabricacao: entrada.data_fabricacao,
        data_validade: entrada.data_validade,
        densidade: entrada.densidade,
      },
    ];
  }, [entrada]);

  /** IDs que o transbordo pode gravar em origens.entrada_id:
   *  - id da própria entrada
   *  - ids dos registros de estoque gerados por essa entrada
   */
  const origemIds = useMemo(() => {
    if (!entrada) return new Set();
    const ids = new Set([entrada.id]);
    estoque.forEach((row) => {
      // Estoque gerado por transbordo (IBC/Tambor) não conta como origem da entrada
      if (String(row.grupo_entrada || "").startsWith("TB")) return;
      if (row.entrada_id === entrada.id) ids.add(row.id);
    });
    return ids;
  }, [entrada, estoque]);

  const destinosList = useMemo(() => {
    if (!entrada) return [];
    const codigoRef = String(entradaId || "").trim().toUpperCase();

    // Vínculo por UUID do estoque/entrada — nunca só pelo texto "E00N"
    // (códigos gravados no OP podem estar desalinhados do índice atual).
    const relacionados = transbordos.filter((t) =>
      (t.origens || []).some((o) =>
        origemPertenceAEntrada(o, origemIds, codigoRef)
      )
    );

    return relacionados.flatMap((t) =>
      (t.destinos || []).map((d) => {
        const volume = destinoVolume(d);
        const massa = destinoMassa(d, t.densidade);
        return {
          codigo: t.codigo_transbordo || "—",
          destino: formatDestino(d),
          volume,
          massa,
        };
      })
    );
  }, [entrada, entradaId, transbordos, origemIds]);

  const transbordoTotais = useMemo(
    () =>
      destinosList.reduce(
        (acc, d) => ({
          volume: acc.volume + (d.volume || 0),
          massa: acc.massa + (d.massa || 0),
        }),
        { volume: 0, massa: 0 }
      ),
    [destinosList]
  );

  if (!entrada) return null;

  const hasPesagem =
    !!entrada.granel_pesagem ||
    entrada.origem === "industrializacao" ||
    entrada.granel_peso_bruto != null ||
    entrada.granel_peso_liquido != null;

  const pesoBruto = Number(entrada.granel_peso_bruto);
  const pesoLiquido = Number(entrada.granel_peso_liquido);
  const diferenca =
    Number.isFinite(pesoBruto) && Number.isFinite(pesoLiquido)
      ? pesoBruto - pesoLiquido
      : null;
  const dentroMargem = entrada.granel_margem === "dentro";

  const thClass =
    "px-2.5 py-1 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/50 whitespace-nowrap";
  const tdClass =
    "px-2.5 py-1 text-xs text-foreground/90 border-b border-border whitespace-nowrap";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-2 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-primary">Recebimento {entradaId}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-5 pb-3 space-y-2.5 bg-card overflow-hidden">
          <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                ID de Entrada
              </p>
              <p className="text-sm font-semibold text-foreground">{entradaId || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Data de Entrada
              </p>
              <p className="text-sm font-semibold text-foreground">
                {formatDate(entrada.data || entrada.created_date || entrada.created_at)}
              </p>
            </div>
          </div>

          <CompactSection title="Produtos Recebidos">
            <table className="w-full border border-border rounded overflow-hidden">
              <thead>
                <tr>
                  <th className={thClass}>Cód</th>
                  <th className={thClass}>Produto</th>
                  <th className={thClass}>Nota Fiscal</th>
                  <th className={`${thClass} text-right`}>Quantidade</th>
                  <th className={thClass}>Unidade</th>
                  <th className={thClass}>Lote</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{l.produto_codigo || "-"}</td>
                    <td className={`${tdClass} max-w-[220px] truncate`} title={l.produto_nome || ""}>
                      {l.produto_nome || "-"}
                    </td>
                    <td className={tdClass}>{l.nota_fiscal || entrada.nota_fiscal || "-"}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatMass(l.quantidade, { empty: "-" })}
                    </td>
                    <td className={tdClass}>{l.unidade_medida || "-"}</td>
                    <td className={tdClass}>{l.lote || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CompactSection>

          <CompactSection title="Controle de Qualidade">
            <table className="w-full border border-border rounded overflow-hidden">
              <thead>
                <tr>
                  <th className={thClass}>Lote</th>
                  <th className={thClass}>Fabricação</th>
                  <th className={thClass}>Validade</th>
                  <th className={thClass}>Densidade</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{l.lote || "-"}</td>
                    <td className={tdClass}>{formatDate(l.data_fabricacao)}</td>
                    <td className={tdClass}>{formatDate(l.data_validade)}</td>
                    <td className={`${tdClass} tabular-nums`}>
                      {formatDensidade(resolveDensidade(l, produtosById))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CompactSection>

          {hasPesagem && (
            <CompactSection title="Pesagem">
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Peso Bruto (kg)</th>
                    <th className={thClass}>Peso Líquido (kg)</th>
                    <th className={thClass}>Tara (kg)</th>
                    <th className={thClass}>Margem</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} tabular-nums`}>
                      {formatMass(entrada.granel_peso_bruto, { empty: "-" })}
                    </td>
                    <td className={`${tdClass} tabular-nums`}>
                      {formatMass(entrada.granel_peso_liquido, { empty: "-" })}
                    </td>
                    <td className={`${tdClass} tabular-nums`}>
                      {diferenca == null ? "-" : formatMass(diferenca, { empty: "-" })}
                    </td>
                    <td className={tdClass}>
                      {entrada.granel_margem ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            dentroMargem
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {dentroMargem ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <AlertCircle className="w-3 h-3" />
                          )}
                          {dentroMargem ? "Dentro da margem" : "Fora da margem"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CompactSection>
          )}

          {destinosList.length > 0 && (
            <CompactSection title="Transbordo">
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>OP</th>
                    <th className={thClass}>Destino</th>
                    <th className={`${thClass} text-right`}>Volume (L)</th>
                    <th className={`${thClass} text-right`}>Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosList.map((d, i) => (
                    <tr key={i}>
                      <td className={tdClass}>{d.codigo}</td>
                      <td className={tdClass}>{d.destino}</td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {formatVolume(d.volume, { empty: "-" })}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {formatMass(d.massa, { empty: "-" })}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40">
                    <td
                      colSpan={2}
                      className={`${tdClass} font-semibold border-b-0`}
                    >
                      Total
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold border-b-0`}>
                      {formatVolume(transbordoTotais.volume, { empty: "-" })}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold border-b-0`}>
                      {formatMass(transbordoTotais.massa, { empty: "-" })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CompactSection>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 px-5 py-3 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompactSection({ title, children }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title}
      </h3>
      {children}
    </div>
  );
}
