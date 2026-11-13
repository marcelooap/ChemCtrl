import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { FileText } from "lucide-react";
import { formatMass, formatVolume, formatCurrency, formatDensidade, formatQuantidade } from "@transbordo/lib/format";
import { generateRelatorioEstoquePDF } from "@transbordo/lib/pdfEstoque";
import {
  listSaidasHistoricoForEstoque,
  listHistoricoTransbordosEncadeados,
  listDestinosFifoForEstoque,
  quantidadesDestinoParaExibicao,
  getEstoqueQuantidade,
  getEstoqueNotaFiscal,
  getEstoqueNotaFiscalTroca,
  computeEstoqueSaldo,
} from "@transbordo/lib/estoqueSaldo";
import {
  resolveTipoRecebimentoEstoque,
  getTipoRecebimentoLabel,
  getTipoRecebimentoBadgeClass,
} from "@transbordo/lib/tipoRecebimento";
import { formatEstoqueCodigo } from "@transbordo/lib/estoqueCodigo";

const formatDate = (d) => {
  if (!d) return "—";
  const raw = String(d);
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("pt-BR");
};

function InfoItem({ label, value, highlight }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
      <p className={`text-sm font-medium leading-snug ${highlight || "text-foreground"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2 pl-2">{children}</div>
    </div>
  );
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-2.5 py-2 text-center text-sm text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}

const placaBarrilKey = (placa, barril) =>
  `${String(placa || "").trim().toUpperCase()}||${String(barril || "")
    .trim()
    .toUpperCase()}`;

function isDestinoTanka(row) {
  const tipo = String(row?.tipo || row?.rawDestino?.tipo_embalagem || "")
    .trim()
    .toLowerCase();
  if (tipo === "tanka" || tipo === "tankagem") return true;
  const d = row?.rawDestino;
  if (d?.tanka_codigo && !d?.placa && !d?.barril) return true;
  return false;
}

function formatSaidaLabel(saida) {
  if (!saida?.codigo) return "—";
  const data = formatDate(saida.data);
  return data && data !== "—" ? `${saida.codigo} - ${data}` : saida.codigo;
}

/**
 * Vincula a saída do vasilhame/embalado ao destino do OP.
 * Destinos em tanka não possuem saída fiscal nesta visão.
 */
function resolveSaidaParaDestino(row, saidasHistorico = []) {
  if (!row || isDestinoTanka(row)) {
    return { saida: null, label: "—", quantidade: null, unidade: "" };
  }

  const dest = row.rawDestino || {};
  const destKey = placaBarrilKey(dest.placa || dest.tanka_codigo, dest.barril);
  const tipo = String(row.tipo || "").trim().toLowerCase();

  if (destKey !== "||") {
    const byPlaca = saidasHistorico.find(
      (s) =>
        s.tipo === "convencional" &&
        placaBarrilKey(s.placa, s.barril) === destKey
    );
    if (byPlaca) {
      return {
        saida: byPlaca,
        label: formatSaidaLabel(byPlaca),
        quantidade: byPlaca.quantidade,
        unidade: byPlaca.unidade || "",
      };
    }
  }

  if (dest.vasilhame_existente_id) {
    const byId = saidasHistorico.find(
      (s) =>
        s.tipo === "convencional" &&
        s.vasilhame_id &&
        String(s.vasilhame_id) === String(dest.vasilhame_existente_id)
    );
    if (byId) {
      return {
        saida: byId,
        label: formatSaidaLabel(byId),
        quantidade: byId.quantidade,
        unidade: byId.unidade || "",
      };
    }
  }

  // Embalados / tipos de embalagem (não vasilhame/tanka)
  if (tipo !== "vasilhame" && tipo !== "tanka" && tipo !== "tankagem") {
    const embalado = saidasHistorico.find((s) => s.tipo === "embalado");
    if (embalado) {
      return {
        saida: embalado,
        label: formatSaidaLabel(embalado),
        quantidade: embalado.quantidade,
        unidade: embalado.unidade || "",
      };
    }
  }

  return { saida: null, label: "—", quantidade: null, unidade: "" };
}

function enrichComSaida(rows, saidasHistorico) {
  return (rows || []).map((row) => {
    const info = resolveSaidaParaDestino(row, saidasHistorico);
    return {
      ...row,
      saidaLabel: info.label,
      saidaQuantidade: info.quantidade,
      saidaUnidade: info.unidade,
    };
  });
}

export default function EstoqueViewDialog({
  open,
  onClose,
  item,
  displayId,
  estoqueCodigo,
  transbordos = [],
  saidas = [],
  vasilhames = [],
}) {
  if (!item) return null;

  const unidade = item.unidade_medida || "kg";
  const idEstoque =
    estoqueCodigo || formatEstoqueCodigo(item.codigo_estoque);
  const custoTotal =
    (Number(item.saldo_atual) || 0) * (Number(item.preco_unitario) || 0);

  const resolveVasilhameStatus = (destino, transbordoCodigo) => {
    const key = placaBarrilKey(
      destino.placa || destino.tanka_codigo,
      destino.barril
    );
    if (key === "||") return null;

    const matches = (vasilhames || []).filter((v) => {
      const vKey = placaBarrilKey(v.placa, v.barril);
      if (vKey !== key) return false;
      if (transbordoCodigo && (v.numero_op || v.codigo)) {
        return true;
      }
      return true;
    });

    if (matches.length === 0) return null;

    const byOp = matches.find(
      (v) =>
        transbordoCodigo &&
        (v.numero_op === transbordoCodigo ||
          v.codigo === transbordoCodigo ||
          (v.composicao || []).some((c) => c.transbordo_codigo === transbordoCodigo))
    );
    const chosen = byOp || matches[0];
    return chosen.status || "No Pátio";
  };

  const apresentarDestino = (row) => {
    const ex = quantidadesDestinoParaExibicao(item, row);
    return {
      ...row,
      volume: ex.volumeL > 0 ? ex.volumeL : null,
      pesoLiq: ex.pesoKg,
    };
  };

  const saidasHistorico = listSaidasHistoricoForEstoque(
    item,
    saidas,
    vasilhames,
    transbordos
  );

  const destinosList = enrichComSaida(
    listDestinosFifoForEstoque(item, transbordos).map((row) => ({
      ...apresentarDestino(row),
      status: resolveVasilhameStatus(row.rawDestino, row.codigo),
    })),
    saidasHistorico
  );

  const historicoTransbordos = enrichComSaida(
    listHistoricoTransbordosEncadeados(item, transbordos, vasilhames).map(
      (row) => ({
        ...apresentarDestino(row),
        status: resolveVasilhameStatus(row.rawDestino, row.codigo),
      })
    ),
    saidasHistorico
  );

  const totalVolumeDestinos = destinosList.reduce(
    (sum, d) => sum + (Number(d.volume) || 0),
    0
  );
  const totalMassaDestinos = destinosList.reduce(
    (sum, d) => sum + (Number(d.pesoLiq) || 0),
    0
  );
  const totalVolumeHistorico = historicoTransbordos.reduce(
    (sum, d) => sum + (Number(d.volume) || 0),
    0
  );
  const totalMassaHistorico = historicoTransbordos.reduce(
    (sum, d) => sum + (Number(d.pesoLiq) || 0),
    0
  );

  const estoqueInicial = getEstoqueQuantidade(item);
  const saldoCalculado = computeEstoqueSaldo(
    item,
    transbordos,
    saidas,
    vasilhames
  );

  const DESTINOS_COLS = 9;
  const HISTORICO_COLS = 10;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader className="pb-0">
          <DialogTitle>Detalhe do Estoque</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-primary/10 px-3 py-2.5">
          <InfoItem
            label="ID"
            value={idEstoque}
            highlight="text-primary text-base font-bold"
          />
          <InfoItem
            label="ENTRADA"
            value={displayId || item.entrada_codigo || "—"}
            highlight="text-foreground text-base font-bold"
          />
          <InfoItem
            label="CÓDIGO"
            value={item.produto_codigo}
            highlight="text-foreground text-base font-bold"
          />
          <InfoItem
            label="LOTE"
            value={item.lote}
            highlight="text-foreground text-base font-bold"
          />
        </div>

        <div className="space-y-4">
          <Section title="DADOS DO PRODUTO">
            <InfoItem label="Produto" value={item.produto_nome} />
            <InfoItem label="Cliente" value={item.cliente_nome} />
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground leading-none">Tipo</p>
              {(() => {
                const tipo = resolveTipoRecebimentoEstoque(item);
                return (
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getTipoRecebimentoBadgeClass(
                      tipo
                    )}`}
                  >
                    {getTipoRecebimentoLabel(tipo)}
                  </span>
                );
              })()}
            </div>
            <InfoItem
              label="Origem"
              value={
                item.origem === "industrializacao" || item.origem === "MATERIA_PRIMA"
                  ? "Matéria-prima"
                  : "Armazenagem"
              }
            />
            <InfoItem
              label="Recebimento"
              value={formatDate(item.created_at || item.created_date)}
            />
          </Section>

          <Section title="RECEBIMENTO / FISCAL">
            <InfoItem label="Nota Fiscal" value={getEstoqueNotaFiscal(item) || "—"} />
            <InfoItem
              label="Troca Fiscal"
              value={getEstoqueNotaFiscalTroca(item) || "—"}
              highlight={
                getEstoqueNotaFiscalTroca(item)
                  ? "text-amber-700 font-semibold"
                  : undefined
              }
            />
            <InfoItem
              label="Densidade"
              value={formatDensidade(item.densidade)}
            />
            <InfoItem
              label="Fabricação"
              value={formatDate(item.data_fabricacao)}
            />
            <InfoItem
              label="Validade"
              value={
                item.validade_indeterminada
                  ? "Indeterminado"
                  : formatDate(item.data_validade)
              }
            />
          </Section>

          <Section title="ESTOQUE">
            <InfoItem
              label={`Quantidade (${unidade})`}
              value={formatQuantidade(estoqueInicial, { empty: "—" })}
            />
            <InfoItem
              label={`Saldo Atual (${unidade})`}
              value={formatQuantidade(saldoCalculado, { empty: "—" })}
              highlight="text-primary font-bold"
            />
            <InfoItem label="Unidade" value={unidade} />
            <InfoItem
              label="Preço Unitário"
              value={formatCurrency(item.preco_unitario)}
            />
            <InfoItem
              label="Custo Total"
              value={formatCurrency(custoTotal)}
              highlight="text-green-600 font-bold"
            />
            {item.embalado && (
              <>
                <InfoItem
                  label="Peso Líquido"
                  value={formatMass(item.peso_liquido, { empty: "—" })}
                />
                <InfoItem
                  label="Qtd. Embalagens"
                  value={
                    item.quantidade_embalagens != null
                      ? String(item.quantidade_embalagens)
                      : "—"
                  }
                />
                <InfoItem
                  label="Local Armazenagem"
                  value={item.local_armazenagem || "—"}
                />
                <InfoItem
                  label="Qtd Paletes"
                  value={
                    item.qtd_paletes != null && item.qtd_paletes !== ""
                      ? String(item.qtd_paletes)
                      : "—"
                  }
                />
              </>
            )}
          </Section>

          {item.granel_pesagem && (
            <Section title="PESAGEM GRANEL">
              <InfoItem label="Ticket" value={item.granel_ticket} />
              <InfoItem
                label="Peso Bruto (kg)"
                value={formatMass(item.granel_peso_bruto, { empty: "—" })}
              />
              <InfoItem
                label="Peso Líquido (kg)"
                value={formatMass(item.granel_peso_liquido, { empty: "—" })}
              />
              <div className="space-y-0.5">
                <p className="text-[11px] text-muted-foreground leading-none">Margem</p>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    item.granel_margem === "dentro"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {item.granel_margem === "dentro"
                    ? "Dentro"
                    : item.granel_margem === "fora"
                      ? "Fora"
                      : "—"}
                </span>
              </div>
            </Section>
          )}

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              DESTINOS (TRANSBORDO)
            </h3>
            <p className="pl-2 text-xs text-muted-foreground">
              Embalagens que receberam este lote pela alocação FIFO do OP
              (volume da fração deste estoque).
            </p>
            <div className="pl-2 overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 text-[11px] text-muted-foreground uppercase">
                    <th className="px-2.5 py-1.5 text-left font-medium">Transbordo</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Data</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Destino</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Tipo</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Saída</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Volume (L)</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Qtd. Saída</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Peso Líq.</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosList.length === 0 ? (
                    <EmptyRow
                      colSpan={DESTINOS_COLS}
                      message="Nenhum transbordo registrado para este item."
                    />
                  ) : (
                    <>
                      {destinosList.map((d) => (
                        <tr key={d.key} className="border-t border-border">
                          <td className="px-2.5 py-1.5 font-medium text-foreground">
                            {d.codigo}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">
                            {formatDate(d.data)}
                          </td>
                          <td className="px-2.5 py-1.5 text-foreground/80">{d.destino}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">{d.tipo}</td>
                          <td className="px-2.5 py-1.5">
                            {d.status ? (
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                  d.status === "Expedido"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-green-100 text-green-700"
                                }`}
                              >
                                {d.status}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-foreground/80 whitespace-nowrap">
                            {d.saidaLabel}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80">
                            {formatVolume(d.volume, { empty: "—" })}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80 whitespace-nowrap">
                            {d.saidaQuantidade != null && Number(d.saidaQuantidade) > 0
                              ? `${formatQuantidade(d.saidaQuantidade, { empty: "—" })} ${d.saidaUnidade || ""}`.trim()
                              : "—"}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80">
                            {formatMass(d.pesoLiq, { empty: "—" })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={6}
                          className="px-2.5 py-1.5 font-bold text-foreground"
                        >
                          Total
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-bold text-primary">
                          {formatVolume(totalVolumeDestinos, { empty: "—" })}
                        </td>
                        <td className="px-2.5 py-1.5" />
                        <td className="px-2.5 py-1.5 text-right font-bold text-green-600">
                          {formatMass(totalMassaDestinos, { empty: "—" })}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              HISTÓRICO DE EMBALAGENS
            </h3>
            <p className="pl-2 text-xs text-muted-foreground">
              Transbordos posteriores — todas as embalagens pelas quais o produto
              passou após o destino inicial.
            </p>
            <div className="pl-2 overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 text-[11px] text-muted-foreground uppercase">
                    <th className="px-2.5 py-1.5 text-left font-medium">Transbordo</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Data</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Origem</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Destino</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Tipo</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Saída</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Volume (L)</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Qtd. Saída</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Peso Líq.</th>
                  </tr>
                </thead>
                <tbody>
                  {historicoTransbordos.length === 0 ? (
                    <EmptyRow
                      colSpan={HISTORICO_COLS}
                      message="Nenhum re-transbordo registrado após o destino inicial."
                    />
                  ) : (
                    <>
                      {historicoTransbordos.map((d) => (
                        <tr key={d.key} className="border-t border-border">
                          <td className="px-2.5 py-1.5 font-medium text-foreground">
                            {d.codigo}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">
                            {formatDate(d.data)}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">
                            {d.origem}
                          </td>
                          <td className="px-2.5 py-1.5 text-foreground/80">{d.destino}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">{d.tipo}</td>
                          <td className="px-2.5 py-1.5">
                            {d.status ? (
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                  d.status === "Expedido"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-green-100 text-green-700"
                                }`}
                              >
                                {d.status}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-foreground/80 whitespace-nowrap">
                            {d.saidaLabel}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80">
                            {formatVolume(d.volume, { empty: "—" })}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80 whitespace-nowrap">
                            {d.saidaQuantidade != null && Number(d.saidaQuantidade) > 0
                              ? `${formatQuantidade(d.saidaQuantidade, { empty: "—" })} ${d.saidaUnidade || ""}`.trim()
                              : "—"}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-foreground/80">
                            {formatMass(d.pesoLiq, { empty: "—" })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={7}
                          className="px-2.5 py-1.5 font-bold text-foreground"
                        >
                          Total
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-bold text-primary">
                          {formatVolume(totalVolumeHistorico, { empty: "—" })}
                        </td>
                        <td className="px-2.5 py-1.5" />
                        <td className="px-2.5 py-1.5 text-right font-bold text-green-600">
                          {formatMass(totalMassaHistorico, { empty: "—" })}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="default"
            className="gap-2"
            onClick={() =>
              generateRelatorioEstoquePDF({
                item,
                displayId,
                estoqueCodigo: idEstoque,
                destinosList,
                historicoTransbordos,
              })
            }
          >
            <FileText className="w-4 h-4" />
            Relatório
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
