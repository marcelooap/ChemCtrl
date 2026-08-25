import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Package, CheckCircle, AlertCircle, Copy, Check } from "lucide-react";
import { formatMass, formatVolume, formatDensidade } from "@transbordo/lib/format";
import { origemPertenceAEntrada } from "@transbordo/lib/entradaCodigo";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";
import { copyHtmlToClipboard } from "@transbordo/lib/clipboard";
import { getQuantidadeNotaFiscal } from "@transbordo/lib/conversao";
import {
  buildReceivingCommunicationHtml,
  formatReceivingLoteRow,
  formatReceivingDestinoRow,
} from "@transbordo/lib/buildReceivingCommunicationHtml";
import OrgaoRegulamentadorBadge, {
  OrgaoControladoBanner,
} from "@transbordo/components/cadastro/OrgaoRegulamentadorBadge";

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
  const produto = resolveProdutoCadastro(lote, produtosById);

  if (produto?.densidade_tabelada && produto.densidade != null && produto.densidade !== "") {
    return produto.densidade;
  }
  return lote.densidade;
}

function resolveProdutoCadastro(lote, produtosById) {
  if (!lote) return null;
  if (lote.produto_id && produtosById.has(lote.produto_id)) {
    return produtosById.get(lote.produto_id);
  }
  const codigo = String(lote.produto_codigo || "").trim();
  const nome = String(lote.produto_nome || "").trim();
  return (
    [...produtosById.values()].find((p) => {
      if (codigo && String(p.codigo || "").trim() === codigo) return true;
      if (nome && String(p.produto || "").trim() === nome) return true;
      return false;
    }) || null
  );
}

function resolveControleProduto(lote, produtosById) {
  const produto = resolveProdutoCadastro(lote, produtosById);
  const controlado = Boolean(produto?.controlado);
  const orgao = controlado ? produto?.orgao_regulamentador || null : null;
  return { controlado: controlado && Boolean(orgao), orgao };
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

  if (isDestinoEstoqueEmbalado(d.tipo_embalagem)) {
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
  const [copied, setCopied] = useState(false);

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
        quantidade_declarada: entrada.quantidade_declarada,
        unidade_medida: entrada.unidade_medida,
        data_fabricacao: entrada.data_fabricacao,
        data_validade: entrada.data_validade,
        densidade: entrada.densidade,
      },
    ];
  }, [entrada]);

  const lotesControle = useMemo(
    () => lotes.map((l) => resolveControleProduto(l, produtosById)),
    [lotes, produtosById]
  );

  const controleResumo = useMemo(() => {
    const algumControlado = lotesControle.some((c) => c.controlado);
    const todosControlados =
      lotesControle.length > 0 && lotesControle.every((c) => c.controlado);
    const orgaos = [
      ...new Set(lotesControle.filter((c) => c.controlado).map((c) => c.orgao)),
    ];
    const orgaoUnico = todosControlados && orgaos.length === 1 ? orgaos[0] : null;
    return {
      algumControlado,
      todosControlados,
      orgaoUnico,
      mostrarPorProduto: algumControlado && !orgaoUnico,
    };
  }, [lotesControle]);

  const origemIds = useMemo(() => {
    if (!entrada) return new Set();
    const ids = new Set([entrada.id]);
    estoque.forEach((row) => {
      if (String(row.grupo_entrada || "").startsWith("TB")) return;
      if (row.entrada_id === entrada.id) ids.add(row.id);
    });
    return ids;
  }, [entrada, estoque]);

  const destinosList = useMemo(() => {
    if (!entrada) return [];
    const codigoRef = String(entradaId || "").trim().toUpperCase();

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
  const foraMargem = entrada.granel_margem === "fora";
  const lotesCount = lotes.length;

  const thClass =
    "px-2.5 py-1 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/50 whitespace-nowrap";
  const tdClass =
    "px-2.5 py-1 text-xs text-foreground/90 border-b border-border whitespace-nowrap";

  const handleCopy = async () => {
    try {
      const lotesPayload = lotes.map((l, i) =>
        formatReceivingLoteRow(l, {
          notaFiscal: entrada.nota_fiscal,
          densidade: resolveDensidade(l, produtosById),
          formatDate,
          entrada,
          lotesCount,
          controlado: lotesControle[i]?.controlado,
          orgao_regulamentador: lotesControle[i]?.orgao,
        })
      );

      const { html, text } = buildReceivingCommunicationHtml({
        entradaId,
        dataEntrada: formatDate(
          entrada.data || entrada.created_date || entrada.created_at
        ),
        lotes: lotesPayload,
        orgaoUnico: controleResumo.orgaoUnico,
        mostrarOrgaoPorProduto: controleResumo.mostrarPorProduto,
        hasPesagem,
        pesoBruto: formatMass(entrada.granel_peso_bruto, { empty: "-" }),
        pesoLiquido: formatMass(entrada.granel_peso_liquido, { empty: "-" }),
        pesoLiquidoDestaque: foraMargem,
        tara: diferenca == null ? "-" : formatMass(diferenca, { empty: "-" }),
        margemLabel: entrada.granel_margem
          ? dentroMargem
            ? "Dentro da margem"
            : "Fora da margem"
          : null,
        dentroMargem,
        destinos: destinosList.map(formatReceivingDestinoRow),
        totais: {
          volumeFmt: formatVolume(transbordoTotais.volume, { empty: "-" }),
          massaFmt: formatMass(transbordoTotais.massa, { empty: "-" }),
        },
      });

      const ok = await copyHtmlToClipboard(html, text);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("[Transbordo] Falha ao copiar recebimento:", err);
    }
  };

  const handleOpenChange = (v) => {
    if (!v) {
      setCopied(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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

          {controleResumo.orgaoUnico ? (
            <OrgaoControladoBanner orgao={controleResumo.orgaoUnico} />
          ) : null}

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
                  {controleResumo.mostrarPorProduto ? (
                    <th className={thClass}>Órgão</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lotes.map((l, i) => {
                  const controle = lotesControle[i] || {};
                  return (
                    <tr
                      key={i}
                      className={
                        controle.controlado && controleResumo.mostrarPorProduto
                          ? "bg-amber-50/60"
                          : undefined
                      }
                    >
                      <td className={tdClass}>{l.produto_codigo || "-"}</td>
                      <td className={`${tdClass} max-w-[220px] truncate`} title={l.produto_nome || ""}>
                        {l.produto_nome || "-"}
                      </td>
                      <td className={tdClass}>{l.nota_fiscal || entrada.nota_fiscal || "-"}</td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {formatMass(
                          getQuantidadeNotaFiscal(l, entrada, { lotesCount }),
                          { empty: "-" }
                        )}
                      </td>
                      <td className={tdClass}>{l.unidade_medida || "-"}</td>
                      <td className={tdClass}>{l.lote || "-"}</td>
                      {controleResumo.mostrarPorProduto ? (
                        <td className={tdClass}>
                          <OrgaoRegulamentadorBadge
                            controlado={controle.controlado}
                            orgao={controle.orgao}
                            compact
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
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
                    <td
                      className={`${tdClass} tabular-nums ${
                        foraMargem
                          ? "font-bold text-red-800 bg-red-50"
                          : ""
                      }`}
                    >
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

        <DialogFooter className="flex-shrink-0 px-5 py-3 border-t border-border gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-2"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-600" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar
              </>
            )}
          </Button>
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
