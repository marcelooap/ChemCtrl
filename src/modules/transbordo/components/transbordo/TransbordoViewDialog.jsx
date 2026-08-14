import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import {
  formatVolume,
  formatMass,
  formatDensidade,
  parseDensidade,
} from "@transbordo/lib/format";
import {
  normalizeUnidadeEntrada,
  isUnidadeMassaEntrada,
  isUnidadeVolumeEntrada,
  getEstoqueUnidadeEntrada,
  isEstoqueEmbalado,
} from "@transbordo/lib/estoqueSaldo";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";

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

function labelUnidade(unidade) {
  const um = normalizeUnidadeEntrada(unidade);
  if (um === "kg") return "kg";
  if (um === "lb") return "lb";
  if (um === "gal") return "gal";
  return "L";
}

function resolveUnidadeTransbordo(transbordo, produtos = [], entradas = []) {
  const origens = transbordo?.origens || [];

  for (const o of origens) {
    if (o?.unidade_medida) return normalizeUnidadeEntrada(o.unidade_medida);
  }

  for (const o of origens) {
    const entrada = entradas.find((e) => e.id === o.entrada_id);
    if (!entrada) continue;
    const um = getEstoqueUnidadeEntrada(entrada);
    if (um) return normalizeUnidadeEntrada(um);
  }

  const produto =
    produtos.find((p) => p.id === transbordo?.produto_id) ||
    produtos.find(
      (p) =>
        p.codigo &&
        transbordo?.produto_codigo &&
        String(p.codigo) === String(transbordo.produto_codigo)
    );
  if (produto?.unidade_medida) {
    return normalizeUnidadeEntrada(produto.unidade_medida);
  }

  // Embalado sem UOM explícita: se houver indício de massa operacional, assume kg.
  const origemEmbalada = origens.some(
    (o) =>
      o.tipo_origem === "embalado" ||
      o.embalado ||
      (o.entrada_id &&
        isEstoqueEmbalado(entradas.find((e) => e.id === o.entrada_id)))
  );
  if (origemEmbalada) return "kg";

  return "l";
}

function resolveDensidadeDisplay(transbordo, produtos = [], entradas = []) {
  const dens = parseDensidade(transbordo?.densidade);
  if (!dens || dens <= 0) return "-";

  const produto =
    produtos.find((p) => p.id === transbordo?.produto_id) ||
    produtos.find(
      (p) =>
        p.codigo &&
        transbordo?.produto_codigo &&
        String(p.codigo) === String(transbordo.produto_codigo)
    );

  // Densidade tabelada do cadastro do produto
  if (produto?.densidade_tabelada) {
    return formatDensidade(dens);
  }

  // Densidade registrada na entrada (lotes)
  const entradaIds = new Set(
    (transbordo?.origens || []).map((o) => o.entrada_id).filter(Boolean)
  );
  const densEntrada = entradas
    .filter((e) => entradaIds.has(e.id))
    .flatMap((e) => [e.densidade, ...(e.lotes || []).map((l) => l.densidade)])
    .map((v) => parseDensidade(v))
    .find((d) => d > 0);

  if (densEntrada > 0) {
    return formatDensidade(dens);
  }

  return "-";
}

function isDestinoTanquePatio(tipo) {
  return tipo === "Vasilhame" || tipo === "Tankagem";
}

export default function TransbordoViewDialog({
  open,
  onClose,
  transbordo,
  produtos = [],
  entradas = [],
}) {
  if (!transbordo) return null;

  const produtoNome = transbordo.produto_nome || "";
  const unidade = resolveUnidadeTransbordo(transbordo, produtos, entradas);
  const unidadeLabel = labelUnidade(unidade);
  const isMassa = isUnidadeMassaEntrada(unidade);
  const isVolume = isUnidadeVolumeEntrada(unidade);
  const densDisplay = resolveDensidadeDisplay(transbordo, produtos, entradas);

  const destinos = transbordo.destinos || [];
  const showPlacaBarril = destinos.some((d) =>
    isDestinoTanquePatio(d.tipo_embalagem)
  );
  const showQtdEmbalagens = destinos.some((d) =>
    isDestinoEstoqueEmbalado(d.tipo_embalagem)
  );

  const formatQtyOperacional = (valor) =>
    isMassa
      ? formatMass(valor, { empty: "-" })
      : formatVolume(valor, { empty: "-" });

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
            <h3 className="text-sm font-semibold text-primary mb-2">
              Dados Gerais
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Data" value={formatDate(transbordo.data)} />
              <Info
                label="Produto"
                value={`${transbordo.produto_codigo || ""} - ${transbordo.produto_nome || ""}`}
              />
              <Info label="Cliente" value={transbordo.cliente_nome || "-"} />
              <Info label="Densidade" value={densDisplay} />
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Operadores</p>
                <div className="flex flex-wrap gap-1.5">
                  {(transbordo.operadores || []).map((op) => (
                    <span
                      key={op}
                      className="inline-flex px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                    >
                      {op}
                    </span>
                  ))}
                </div>
              </div>
              {transbordo.observacoes && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    Observações
                  </p>
                  <p className="text-sm text-foreground">
                    {transbordo.observacoes}
                  </p>
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
                  <tr className="text-center text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    <th className="px-3 py-2 font-medium align-middle">Produto</th>
                    <th className="px-3 py-2 font-medium align-middle">Lote</th>
                    <th className="px-3 py-2 font-medium align-middle">Vol. Retirado (L)</th>
                    <th className="px-3 py-2 font-medium align-middle">Massa (kg)</th>
                    <th className="px-3 py-2 font-medium align-middle">
                      Saldo Restante ({unidadeLabel})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(transbordo.origens || []).flatMap((o, i) => {
                    const lotes = (o.lotes_retirados || []).filter(
                      (l) => (l.volume_retirado || 0) > 0
                    );
                    const produtoOrigem = origemProdutoNome(o, produtoNome);
                    const umOrigem = normalizeUnidadeEntrada(
                      o.unidade_medida || unidade
                    );
                    const origemEmMassa = isUnidadeMassaEntrada(umOrigem);
                    const dens = parseDensidade(transbordo.densidade);

                    if (lotes.length > 1) {
                      return lotes.map((l, li) => {
                        const vol = l.volume_retirado || 0;
                        const massa = origemEmMassa
                          ? vol
                          : dens > 0
                            ? vol * dens
                            : o.massa_retirada;
                        const saldo = Math.max(
                          0,
                          (l.saldo_disponivel || 0) - vol
                        );
                        return (
                          <tr
                            key={`${i}-${li}`}
                            className="border-b border-border last:border-0"
                          >
                            <td className="px-3 py-2 text-center align-middle text-foreground">
                              {produtoOrigem}
                            </td>
                            <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                              {l.lote || "-"}
                            </td>
                            <td className="px-3 py-2 text-center align-middle text-foreground font-medium">
                              {origemEmMassa
                                ? "-"
                                : formatVolume(vol, { empty: "-" })}
                            </td>
                            <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                              {formatMass(massa, { empty: "-" })}
                            </td>
                            <td className="px-3 py-2 text-center align-middle text-green-700 font-medium">
                              {origemEmMassa
                                ? formatMass(saldo, { empty: "-" })
                                : formatVolume(saldo, { empty: "-" })}
                            </td>
                          </tr>
                        );
                      });
                    }

                    const vol = o.volume_retirado || 0;
                    const massa = origemEmMassa
                      ? o.massa_retirada ?? vol
                      : o.massa_retirada;
                    const saldo = o.saldo_restante;

                    return [
                      <tr
                        key={i}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2 text-center align-middle text-foreground">
                          {produtoOrigem}
                        </td>
                        <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                          {o.lote || "-"}
                        </td>
                        <td className="px-3 py-2 text-center align-middle text-foreground font-medium">
                          {origemEmMassa
                            ? "-"
                            : formatVolume(vol, { empty: "-" })}
                        </td>
                        <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                          {formatMass(massa, { empty: "-" })}
                        </td>
                        <td className="px-3 py-2 text-center align-middle text-green-700 font-medium">
                          {origemEmMassa
                            ? formatMass(saldo, { empty: "-" })
                            : formatVolume(saldo, { empty: "-" })}
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
            <h3 className="text-sm font-semibold text-primary mb-2">
              Destinos
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-center text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    <th className="px-3 py-2 font-medium align-middle">Tipo</th>
                    {showPlacaBarril && (
                      <>
                        <th className="px-3 py-2 font-medium align-middle">Nº Placa</th>
                        <th className="px-3 py-2 font-medium align-middle">Nº Barril</th>
                      </>
                    )}
                    {showQtdEmbalagens && (
                      <th className="px-3 py-2 font-medium align-middle">Qtd. Embalagens</th>
                    )}
                    <th className="px-3 py-2 font-medium align-middle">Volume (L)</th>
                    <th className="px-3 py-2 font-medium align-middle">Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {destinos.map((d, i) => {
                    const tipo = d.tipo_embalagem || "";
                    const tanque = isDestinoTanquePatio(tipo);
                    const embalado = isDestinoEstoqueEmbalado(tipo);
                    const placa =
                      tipo === "Tankagem"
                        ? d.tanka_codigo || "-"
                        : d.placa || "-";
                    const barril = d.barril || "-";
                    const qtdEmb =
                      d.quantidade_embalagens != null &&
                      d.quantidade_embalagens !== ""
                        ? Math.round(Number(d.quantidade_embalagens) || 0)
                        : null;
                    const volume =
                      tipo === "Tankagem" ? d.volume : d.volume_total;
                    const dens = parseDensidade(transbordo.densidade);
                    const massa = isMassa
                      ? d.peso_liquido ?? volume
                      : d.peso_liquido != null
                        ? d.peso_liquido
                        : dens > 0
                          ? (volume || 0) * dens
                          : null;

                    return (
                      <tr
                        key={i}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2 text-center align-middle text-foreground font-medium">
                          {tipo || "-"}
                        </td>
                        {showPlacaBarril && (
                          <>
                            <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                              {tanque ? placa : "-"}
                            </td>
                            <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                              {tanque && tipo === "Vasilhame" ? barril : "-"}
                            </td>
                          </>
                        )}
                        {showQtdEmbalagens && (
                          <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                            {embalado
                              ? qtdEmb != null
                                ? String(qtdEmb)
                                : "-"
                              : "-"}
                          </td>
                        )}
                        <td className="px-3 py-2 text-center align-middle text-primary font-medium">
                          {isVolume
                            ? formatVolume(volume, { empty: "-" })
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-center align-middle text-muted-foreground">
                          {formatMass(massa, { empty: "-" })}
                        </td>
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
              Volume Total:{" "}
              <span className="font-bold text-foreground">
                {isVolume
                  ? `${formatVolume(transbordo.volume_total, { empty: "-" })} L`
                  : "-"}
              </span>
            </span>
            <span className="text-muted-foreground">
              {isMassa ? "Quantidade Total:" : "Massa Total:"}{" "}
              <span className="font-bold text-foreground">
                {isMassa
                  ? `${formatQtyOperacional(
                      transbordo.massa_total ?? transbordo.volume_total
                    )} ${unidadeLabel}`
                  : `${formatMass(transbordo.massa_total, { empty: "-" })} kg`}
              </span>
            </span>
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

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground font-medium">{value}</p>
    </div>
  );
}
