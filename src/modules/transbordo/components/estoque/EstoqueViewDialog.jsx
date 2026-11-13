import {
  AlertCircle,
  CheckCircle,
  FileText,
  History,
  Package,
  Scale,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import {
  formatMass,
  formatVolume,
  formatCurrency,
  formatDensidade,
  formatQuantidade,
} from "@transbordo/lib/format";
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

function SectionCard({ icon: Icon, title, children, action = null, description = null }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
            {description ? (
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? (
          <div className="flex items-center gap-1.5 shrink-0">{action}</div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function InfoField({ label, value, mono = false, highlight = null }) {
  const display =
    value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm break-words ${
          highlight ||
          (mono
            ? "font-semibold tabular-nums text-foreground"
            : "font-medium text-foreground")
        }`}
      >
        {display}
      </div>
    </div>
  );
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-3 text-center text-sm text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}

const thClass =
  "px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground uppercase bg-muted/40";
const thRightClass = `${thClass} text-right`;
const tdClass = "px-2.5 py-1.5 text-sm text-foreground/80 border-t border-border";
const tdRightClass = `${tdClass} text-right tabular-nums`;

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

function StatusPill({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const expedido = status === "Expedido";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        expedido
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-emerald-50 text-emerald-700 border-emerald-200"
      }`}
    >
      {status}
    </span>
  );
}

function MargemBadge({ margem }) {
  if (!margem || (margem !== "dentro" && margem !== "fora")) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const dentro = margem === "dentro";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        dentro
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      {dentro ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      {dentro ? "Dentro da margem" : "Fora da margem"}
    </span>
  );
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
  const tipoRecebimento = resolveTipoRecebimentoEstoque(item);
  const notaTroca = getEstoqueNotaFiscalTroca(item);
  const origemLabel =
    item.origem === "industrializacao" || item.origem === "MATERIA_PRIMA"
      ? "Matéria-prima"
      : "Armazenagem";

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
          (v.composicao || []).some(
            (c) => c.transbordo_codigo === transbordoCodigo
          ))
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

  const isEmbalado = tipoRecebimento === "embalado";
  const hasTransbordoMovimento =
    destinosList.length > 0 || historicoTransbordos.length > 0;
  /** Embalado sem OP: mostra saídas diretas em vez de destinos/histórico de transbordo. */
  const showSaidasEmbalado = isEmbalado && !hasTransbordoMovimento;
  const saidasEmbaladoList = showSaidasEmbalado
    ? saidasHistorico.filter((s) => String(s.tipo || "").toLowerCase() === "embalado")
    : [];
  const totalQtdSaidasEmbalado = saidasEmbaladoList.reduce(
    (sum, s) => sum + (Number(s.quantidade) || 0),
    0
  );

  const DESTINOS_COLS = 9;
  const HISTORICO_COLS = 10;
  const SAIDAS_COLS = 7;

  const handleRelatorio = () =>
    generateRelatorioEstoquePDF({
      item,
      displayId,
      estoqueCodigo: idEstoque,
      destinosList,
      historicoTransbordos,
    });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left space-y-1">
          <DialogTitle className="flex items-center gap-3 flex-wrap text-base">
            <span>Detalhe do Estoque</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getTipoRecebimentoBadgeClass(
                tipoRecebimento
              )}`}
            >
              {getTipoRecebimentoLabel(tipoRecebimento)}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-700 border-slate-200">
              {origemLabel}
            </span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {[item.produto_codigo, item.produto_nome].filter(Boolean).join(" — ") ||
              "—"}
            {item.cliente_nome ? ` · ${item.cliente_nome}` : ""}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <SectionCard icon={Package} title="Identificação">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <InfoField label="ID" value={idEstoque} mono highlight="text-primary text-base font-bold tabular-nums" />
              <InfoField
                label="Entrada"
                value={displayId || item.entrada_codigo || "—"}
                mono
              />
              <InfoField label="Código" value={item.produto_codigo} mono />
              <InfoField label="Lote" value={item.lote} mono />
            </div>
          </SectionCard>

          <SectionCard icon={Package} title="Dados do produto">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <InfoField label="Produto" value={item.produto_nome} />
              <InfoField label="Cliente" value={item.cliente_nome} />
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tipo
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getTipoRecebimentoBadgeClass(
                    tipoRecebimento
                  )}`}
                >
                  {getTipoRecebimentoLabel(tipoRecebimento)}
                </span>
              </div>
              <InfoField label="Origem" value={origemLabel} />
              <InfoField
                label="Recebimento"
                value={formatDate(item.created_at || item.created_date)}
              />
            </div>
          </SectionCard>

          <SectionCard icon={FileText} title="Recebimento / Fiscal">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <InfoField
                label="Nota Fiscal"
                value={getEstoqueNotaFiscal(item) || "—"}
              />
              <InfoField
                label="Troca Fiscal"
                value={notaTroca || "—"}
                highlight={
                  notaTroca
                    ? "text-sm font-semibold text-amber-700"
                    : undefined
                }
              />
              <InfoField
                label="Densidade"
                value={formatDensidade(item.densidade)}
                mono
              />
              <InfoField
                label="Fabricação"
                value={formatDate(item.data_fabricacao)}
              />
              <InfoField
                label="Validade"
                value={
                  item.validade_indeterminada
                    ? "Indeterminado"
                    : formatDate(item.data_validade)
                }
              />
            </div>
          </SectionCard>

          <SectionCard icon={Warehouse} title="Estoque">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <InfoField
                label={`Quantidade (${unidade})`}
                value={formatQuantidade(estoqueInicial, { empty: "—" })}
                mono
              />
              <InfoField
                label={`Saldo atual (${unidade})`}
                value={formatQuantidade(saldoCalculado, { empty: "—" })}
                highlight="text-sm font-bold tabular-nums text-primary"
              />
              <InfoField label="Unidade" value={unidade} />
              <InfoField
                label="Preço unitário"
                value={formatCurrency(item.preco_unitario)}
                mono
              />
              <InfoField
                label="Custo total"
                value={formatCurrency(custoTotal)}
                highlight="text-sm font-bold tabular-nums text-emerald-600"
              />
              {item.embalado ? (
                <>
                  <InfoField
                    label="Peso líquido"
                    value={formatMass(item.peso_liquido, { empty: "—" })}
                    mono
                  />
                  <InfoField
                    label="Qtd. embalagens"
                    value={
                      item.quantidade_embalagens != null
                        ? String(item.quantidade_embalagens)
                        : "—"
                    }
                    mono
                  />
                  <InfoField
                    label="Local armazenagem"
                    value={item.local_armazenagem || "—"}
                  />
                  <InfoField
                    label="Qtd. paletes"
                    value={
                      item.qtd_paletes != null && item.qtd_paletes !== ""
                        ? String(item.qtd_paletes)
                        : "—"
                    }
                    mono
                  />
                </>
              ) : null}
            </div>
          </SectionCard>

          {item.granel_pesagem ? (
            <SectionCard icon={Scale} title="Pesagem granel">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <InfoField label="Ticket" value={item.granel_ticket} />
                <InfoField
                  label="Peso bruto (kg)"
                  value={formatMass(item.granel_peso_bruto, { empty: "—" })}
                  mono
                />
                <InfoField
                  label="Peso líquido (kg)"
                  value={formatMass(item.granel_peso_liquido, { empty: "—" })}
                  mono
                />
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Margem
                  </div>
                  <MargemBadge margem={item.granel_margem} />
                </div>
              </div>
            </SectionCard>
          ) : null}

          {showSaidasEmbalado ? (
            <SectionCard
              icon={Truck}
              title="Dados de saída"
              description="Saídas deste lote embalado (sem movimento de transbordo)."
              action={
                saidasEmbaladoList.length > 0 ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                    {saidasEmbaladoList.length}
                  </span>
                ) : null
              }
            >
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                  <thead>
                    <tr>
                      <th className={thClass}>Saída</th>
                      <th className={thClass}>Data</th>
                      <th className={thClass}>Lote</th>
                      <th className={thClass}>Tipo</th>
                      <th className={thRightClass}>Quantidade</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saidasEmbaladoList.length === 0 ? (
                      <EmptyRow
                        colSpan={SAIDAS_COLS}
                        message="Nenhuma saída registrada para este item embalado."
                      />
                    ) : (
                      <>
                        {saidasEmbaladoList.map((s) => (
                          <tr key={s.key}>
                            <td className={`${tdClass} font-medium text-foreground`}>
                              {s.codigo}
                            </td>
                            <td
                              className={`${tdClass} text-muted-foreground whitespace-nowrap`}
                            >
                              {formatDate(s.data)}
                            </td>
                            <td className={`${tdClass} text-foreground/80`}>
                              {s.lote || "—"}
                            </td>
                            <td className={tdClass}>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-orange-200 text-orange-800 border-orange-300/60">
                                Embalado
                              </span>
                            </td>
                            <td className={`${tdRightClass} font-medium text-foreground`}>
                              {`${formatQuantidade(s.quantidade, {
                                empty: "—",
                              })} ${s.unidade || ""}`.trim()}
                            </td>
                            <td className={tdClass}>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                                  s.status === "Validado"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-800 border-amber-200"
                                }`}
                              >
                                {s.status}
                              </span>
                            </td>
                            <td className={`${tdClass} text-muted-foreground`}>
                              {s.responsavel || "—"}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border bg-muted/40">
                          <td
                            colSpan={4}
                            className="px-2.5 py-1.5 font-bold text-foreground"
                          >
                            Total
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold text-primary tabular-nums">
                            {`${formatQuantidade(totalQtdSaidasEmbalado, {
                              empty: "—",
                            })} ${unidade}`.trim()}
                          </td>
                          <td colSpan={2} className="px-2.5 py-1.5" />
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : (
            <>
              <SectionCard
                icon={Warehouse}
                title="Destinos (transbordo)"
                description="Embalagens que receberam este lote pela alocação FIFO do OP (volume da fração deste estoque)."
                action={
                  destinosList.length > 0 ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                      {destinosList.length}
                    </span>
                  ) : null
                }
              >
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr>
                        <th className={thClass}>Transbordo</th>
                        <th className={thClass}>Data</th>
                        <th className={thClass}>Destino</th>
                        <th className={thClass}>Tipo</th>
                        <th className={thClass}>Status</th>
                        <th className={thClass}>Saída</th>
                        <th className={thRightClass}>Volume (L)</th>
                        <th className={thRightClass}>Qtd. Saída</th>
                        <th className={thRightClass}>Peso Líq.</th>
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
                            <tr key={d.key}>
                              <td className={`${tdClass} font-medium text-foreground`}>
                                {d.codigo}
                              </td>
                              <td
                                className={`${tdClass} text-muted-foreground whitespace-nowrap`}
                              >
                                {formatDate(d.data)}
                              </td>
                              <td className={tdClass}>{d.destino}</td>
                              <td className={`${tdClass} text-muted-foreground`}>
                                {d.tipo}
                              </td>
                              <td className={tdClass}>
                                <StatusPill status={d.status} />
                              </td>
                              <td className={`${tdClass} whitespace-nowrap`}>
                                {d.saidaLabel}
                              </td>
                              <td className={tdRightClass}>
                                {formatVolume(d.volume, { empty: "—" })}
                              </td>
                              <td className={`${tdRightClass} whitespace-nowrap`}>
                                {d.saidaQuantidade != null &&
                                Number(d.saidaQuantidade) > 0
                                  ? `${formatQuantidade(d.saidaQuantidade, {
                                      empty: "—",
                                    })} ${d.saidaUnidade || ""}`.trim()
                                  : "—"}
                              </td>
                              <td className={tdRightClass}>
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
                            <td className="px-2.5 py-1.5 text-right font-bold text-primary tabular-nums">
                              {formatVolume(totalVolumeDestinos, { empty: "—" })}
                            </td>
                            <td className="px-2.5 py-1.5" />
                            <td className="px-2.5 py-1.5 text-right font-bold text-emerald-600 tabular-nums">
                              {formatMass(totalMassaDestinos, { empty: "—" })}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard
                icon={History}
                title="Histórico de embalagens"
                description="Transbordos posteriores — todas as embalagens pelas quais o produto passou após o destino inicial."
                action={
                  historicoTransbordos.length > 0 ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                      {historicoTransbordos.length}
                    </span>
                  ) : null
                }
              >
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr>
                        <th className={thClass}>Transbordo</th>
                        <th className={thClass}>Data</th>
                        <th className={thClass}>Origem</th>
                        <th className={thClass}>Destino</th>
                        <th className={thClass}>Tipo</th>
                        <th className={thClass}>Status</th>
                        <th className={thClass}>Saída</th>
                        <th className={thRightClass}>Volume (L)</th>
                        <th className={thRightClass}>Qtd. Saída</th>
                        <th className={thRightClass}>Peso Líq.</th>
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
                            <tr key={d.key}>
                              <td className={`${tdClass} font-medium text-foreground`}>
                                {d.codigo}
                              </td>
                              <td
                                className={`${tdClass} text-muted-foreground whitespace-nowrap`}
                              >
                                {formatDate(d.data)}
                              </td>
                              <td className={`${tdClass} text-muted-foreground`}>
                                {d.origem}
                              </td>
                              <td className={tdClass}>{d.destino}</td>
                              <td className={`${tdClass} text-muted-foreground`}>
                                {d.tipo}
                              </td>
                              <td className={tdClass}>
                                <StatusPill status={d.status} />
                              </td>
                              <td className={`${tdClass} whitespace-nowrap`}>
                                {d.saidaLabel}
                              </td>
                              <td className={tdRightClass}>
                                {formatVolume(d.volume, { empty: "—" })}
                              </td>
                              <td className={`${tdRightClass} whitespace-nowrap`}>
                                {d.saidaQuantidade != null &&
                                Number(d.saidaQuantidade) > 0
                                  ? `${formatQuantidade(d.saidaQuantidade, {
                                      empty: "—",
                                    })} ${d.saidaUnidade || ""}`.trim()
                                  : "—"}
                              </td>
                              <td className={tdRightClass}>
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
                            <td className="px-2.5 py-1.5 text-right font-bold text-primary tabular-nums">
                              {formatVolume(totalVolumeHistorico, {
                                empty: "—",
                              })}
                            </td>
                            <td className="px-2.5 py-1.5" />
                            <td className="px-2.5 py-1.5 text-right font-bold text-emerald-600 tabular-nums">
                              {formatMass(totalMassaHistorico, { empty: "—" })}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-border px-5 py-3 bg-muted/20">
          <Button
            type="button"
            variant="default"
            className="gap-2"
            onClick={handleRelatorio}
          >
            <FileText className="w-4 h-4" />
            Relatório
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
