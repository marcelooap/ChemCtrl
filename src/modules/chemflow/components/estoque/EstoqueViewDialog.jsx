import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { FileText } from "lucide-react";
import { formatMass, formatVolume, formatCurrency, formatDensidade, roundMass } from "@chemflow/lib/format";
import { generateRelatorioEstoquePDF } from "@chemflow/lib/pdfEstoque";
import {
  listSaidasHistoricoForEstoque,
  listHistoricoTransbordosEncadeados,
  getEstoqueQuantidade,
  getEstoqueNotaFiscal,
  getEstoqueNotaFiscalTroca,
} from "@chemflow/lib/estoqueSaldo";

const formatDate = (d) => {
  if (!d) return "—";
  const raw = String(d);
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("pt-BR");
};

const formatDateTime = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString("pt-BR");
};

function InfoItem({ label, value, highlight }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight || "text-foreground"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-4 pl-2">{children}</div>
    </div>
  );
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-3 text-center text-sm text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}

export default function EstoqueViewDialog({
  open,
  onClose,
  item,
  displayId,
  transbordos = [],
  saidas = [],
  vasilhames = [],
}) {
  if (!item) return null;

  const unidade = item.unidade_medida || "kg";
  const custoTotal =
    (Number(item.saldo_atual) || 0) * (Number(item.preco_unitario) || 0);

  const transbordosUsados = (transbordos || []).filter((t) =>
    (t.origens || []).some((o) => o.entrada_id === item.id)
  );

  const placaBarrilKey = (placa, barril) =>
    `${String(placa || "").trim().toUpperCase()}||${String(barril || "")
      .trim()
      .toUpperCase()}`;

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
        // Preferência pelo mesmo OP, mas aceita qualquer match de placa/barril
        return true;
      }
      return true;
    });

    if (matches.length === 0) return null;

    // Prioriza match pelo código do transbordo; senão o mais recente
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

  const destinosList = transbordosUsados.flatMap((t) => {
    const origem = (t.origens || []).find((o) => o.entrada_id === item.id);
    return (t.destinos || []).map((d, idx) => ({
      key: `${t.id}-${idx}`,
      codigo: t.codigo_transbordo || "—",
      data: t.data,
      destino:
        [d.placa, d.barril].filter(Boolean).join(" / ") ||
        d.tanka_codigo ||
        (d.tipo_embalagem
          ? Number(d.quantidade_embalagens) > 0
            ? `${d.tipo_embalagem} (${d.quantidade_embalagens})`
            : d.tipo_embalagem
          : "—"),
      tipo: d.tipo_embalagem || (d.tanka_codigo ? "Tanka" : "—"),
      volume: d.volume_total || d.volume || 0,
      pesoLiq: d.peso_liquido || 0,
      volumeRetirado: origem?.volume_retirado,
      massaRetirada: origem?.massa_retirada,
      status: resolveVasilhameStatus(d, t.codigo_transbordo),
    }));
  });

  const historicoTransbordos = listHistoricoTransbordosEncadeados(
    item,
    transbordos,
    vasilhames
  ).map((row) => ({
    ...row,
    status: resolveVasilhameStatus(row.rawDestino, row.codigo),
  }));

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

  const saidasHistorico = listSaidasHistoricoForEstoque(
    item,
    saidas,
    vasilhames,
    transbordos
  );

  const estoqueInicial = getEstoqueQuantidade(item);
  // Só saídas enviadas ao fiscal abatem o estoque na base
  const totalSaido = roundMass(
    saidasHistorico
      .filter((s) => s.enviado_ao_fiscal)
      .reduce((sum, s) => sum + (Number(s.quantidade) || 0), 0)
  );
  const saldoCalculado = Math.max(0, roundMass(estoqueInicial - totalSaido));
  const saldoAtualBase = Number(item.saldo_atual) || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Detalhe do Estoque</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 rounded-lg bg-primary/10 p-4">
          <InfoItem
            label="ID ENTRADA"
            value={displayId || item.entrada_codigo || "—"}
            highlight="text-primary text-lg font-bold"
          />
          <InfoItem
            label="CÓDIGO"
            value={item.produto_codigo}
            highlight="text-foreground text-lg font-bold"
          />
          <InfoItem
            label="LOTE"
            value={item.lote}
            highlight="text-foreground text-lg font-bold"
          />
        </div>

        <div className="space-y-6">
          <Section title="DADOS DO PRODUTO">
            <InfoItem label="Produto" value={item.produto_nome} />
            <InfoItem label="Cliente" value={item.cliente_nome} />
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Tipo</p>
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                  item.embalado
                    ? "bg-orange-200 text-orange-800"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {item.embalado ? "Embalado" : "Convencional"}
              </span>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Status WMS</p>
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                  item.status_wms
                    ? "bg-green-100 text-green-700"
                    : "bg-orange-100 text-orange-700"
                }`}
              >
                {item.status_wms ? "OK" : "NOK"}
              </span>
            </div>
            <InfoItem
              label="Origem"
              value={
                item.origem === "industrializacao" ? "ChemCtrl" : "ChemFlow"
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
              value={formatDate(item.data_validade)}
            />
          </Section>

          <Section title="ESTOQUE">
            <InfoItem
              label={`Quantidade (${unidade})`}
              value={formatMass(item.quantidade, { empty: "—" })}
            />
            <InfoItem
              label={`Saldo Atual (${unidade})`}
              value={formatMass(item.saldo_atual, { empty: "—" })}
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
                <p className="text-xs text-muted-foreground">Margem</p>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
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

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              DESTINOS (TRANSBORDO)
            </h3>
            <div className="pl-2">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left font-medium">Transbordo</th>
                    <th className="px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Destino</th>
                    <th className="px-3 py-2 text-left font-medium">Tipo</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Volume (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Peso Líq.</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosList.length === 0 ? (
                    <EmptyRow
                      colSpan={7}
                      message="Nenhum transbordo registrado para este item."
                    />
                  ) : (
                    <>
                      {destinosList.map((d) => (
                        <tr key={d.key} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">
                            {d.codigo}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatDate(d.data)}
                          </td>
                          <td className="px-3 py-2 text-foreground/80">{d.destino}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.tipo}</td>
                          <td className="px-3 py-2">
                            {d.status ? (
                              <span
                                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
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
                          <td className="px-3 py-2 text-right text-foreground/80">
                            {formatVolume(d.volume, { empty: "—" })}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground/80">
                            {formatMass(d.pesoLiq, { empty: "—" })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={5}
                          className="px-3 py-2 font-bold text-foreground"
                        >
                          Total
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-primary">
                          {formatVolume(totalVolumeDestinos, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-green-600">
                          {formatMass(totalMassaDestinos, { empty: "—" })}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              HISTÓRICO DE EMBALAGENS
            </h3>
            <p className="pl-2 text-xs text-muted-foreground">
              Transbordos posteriores — todas as embalagens pelas quais o produto
              passou após o destino inicial.
            </p>
            <div className="pl-2">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left font-medium">Transbordo</th>
                    <th className="px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Origem</th>
                    <th className="px-3 py-2 text-left font-medium">Destino</th>
                    <th className="px-3 py-2 text-left font-medium">Tipo</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Volume (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Peso Líq.</th>
                  </tr>
                </thead>
                <tbody>
                  {historicoTransbordos.length === 0 ? (
                    <EmptyRow
                      colSpan={8}
                      message="Nenhum re-transbordo registrado após o destino inicial."
                    />
                  ) : (
                    <>
                      {historicoTransbordos.map((d) => (
                        <tr key={d.key} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">
                            {d.codigo}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatDate(d.data)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {d.origem}
                          </td>
                          <td className="px-3 py-2 text-foreground/80">{d.destino}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.tipo}</td>
                          <td className="px-3 py-2">
                            {d.status ? (
                              <span
                                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
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
                          <td className="px-3 py-2 text-right text-foreground/80">
                            {formatVolume(d.volume, { empty: "—" })}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground/80">
                            {formatMass(d.pesoLiq, { empty: "—" })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={6}
                          className="px-3 py-2 font-bold text-foreground"
                        >
                          Total
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-primary">
                          {formatVolume(totalVolumeHistorico, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-green-600">
                          {formatMass(totalMassaHistorico, { empty: "—" })}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              HISTÓRICO DE SAÍDAS
            </h3>
            <div className="pl-2">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left font-medium">Saída</th>
                    <th className="px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Vasilhame</th>
                    <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {saidasHistorico.length === 0 ? (
                    <EmptyRow
                      colSpan={6}
                      message="Nenhuma saída registrada para este item."
                    />
                  ) : (
                    <>
                      {saidasHistorico.map((s) => (
                        <tr key={s.key} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">
                            {s.codigo}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatDate(s.data)}
                            {s.enviadoEm && (
                              <span className="block text-[11px] text-muted-foreground">
                                Fiscal: {formatDateTime(s.enviadoEm)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            {s.vasilhame || (s.tipo === "embalado" ? "Embalado" : "—")}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground/80">
                            {formatMass(s.quantidade, { empty: "—" })} {s.unidade}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                s.status === "Enviado ao fiscal"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.responsavel}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={3}
                          className="px-3 py-2 font-bold text-foreground"
                        >
                          Total Expedido
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-primary">
                          {formatMass(totalSaido, { empty: "—" })} {unidade}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </>
                  )}
                </tbody>
              </table>

              {saidasHistorico.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Estoque inicial</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatMass(estoqueInicial, { empty: "—" })} {unidade}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      (−) Total Expedido
                    </p>
                    <p className="text-sm font-semibold text-red-600">
                      {formatMass(totalSaido, { empty: "—" })} {unidade}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      (=) Estoque atual
                    </p>
                    <p className="text-sm font-bold text-primary">
                      {formatMass(saldoCalculado, { empty: "—" })} {unidade}
                      {Math.abs(saldoCalculado - saldoAtualBase) > 0.001 && (
                        <span className="ml-2 text-[11px] font-medium text-amber-700">
                          (base: {formatMass(saldoAtualBase, { empty: "—" })})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}
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
                destinosList,
                historicoTransbordos,
                saidasHistorico,
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
