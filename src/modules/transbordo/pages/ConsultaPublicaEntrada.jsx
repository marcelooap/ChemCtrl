import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { fetchPublicEntradaInfo } from "@transbordo/api/publicApi";
import { getQuantidadeNotaFiscal } from "@transbordo/lib/conversao";
import { formatDensidade, formatMass, formatQuantidade, formatVolume, parseNumero } from "@transbordo/lib/format";
import { formatEtiquetaEmbalagemPlaca } from "@transbordo/lib/etiquetaConfig";
import { getTipoRecebimentoLabel, resolveTipoRecebimento } from "@transbordo/lib/tipoRecebimento";
import { AlertCircle, Loader2, Package, ShieldCheck } from "lucide-react";

function useForceLightMode() {
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    html.classList.remove("dark");
    html.classList.add("light");
    html.style.colorScheme = "light";
    return () => {
      html.classList.remove("light");
      html.style.colorScheme = "";
      if (hadDark) html.classList.add("dark");
    };
  }, []);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function filled(value) {
  if (value == null) return false;
  const text = String(value).trim();
  return text !== "" && text !== "—" && text !== "-";
}

function formatDate(value) {
  if (!filled(value)) return "";
  const raw = String(value);
  const date = raw.includes("T") ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("pt-BR");
}

function origemLabel(origem) {
  return origem === "industrializacao" ? "Industrialização" : "Armazenagem";
}

function embalagemTexto(lote) {
  const tipo = resolveTipoRecebimento(lote);
  if (tipo === "granel") return "Granel";
  if (tipo === "vasilhame") {
    return formatEtiquetaEmbalagemPlaca(lote?.placa, lote?.barril) || "Vasilhame";
  }
  const named = String(lote?.tipo_embalagem || "").trim();
  if (named && !/^embalado$/i.test(named)) return named;
  return "Embalado";
}

function Field({ label, value }) {
  if (!filled(value)) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 break-words">{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function quantidadeTexto(lote, info, lotesCount) {
  const quantidade = getQuantidadeNotaFiscal(lote, {
    granel_margem: info?.pesagem?.margem,
    granel_peso_minimo: info?.pesagem?.peso_minimo,
    granel_erro_admissivel: info?.pesagem?.erro_admissivel,
    quantidade: info?.quantidade,
    unidade_medida: lote?.unidade_medida || info?.unidade,
  }, { lotesCount });
  return formatQuantidade(quantidade, { empty: "" });
}

function quantidadeRecebidaTexto(lote) {
  const declarada = getQuantidadeNotaFiscal(lote, {}, { lotesCount: 99 });
  const operacional = parseNumero(lote?.quantidade);
  if (!operacional) return "";
  if (declarada != null && Math.abs(Number(declarada) - operacional) <= 0.5) return "";
  return formatQuantidade(operacional, { empty: "" });
}

function ConsultaPublicaEntradaPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useForceLightMode();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPublicEntradaInfo(token);
        if (cancelled) return;
        if (data?.codigo || data?.cliente || asArray(data?.lotes).length > 0) {
          setInfo(data);
          return;
        }
        setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100" style={{ colorScheme: "light" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#1e56a0" }} />
          <p className="text-sm text-gray-500">Carregando recebimento…</p>
        </div>
      </div>
    );
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4" style={{ colorScheme: "light" }}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">Recebimento não encontrado</h1>
          <p className="text-sm text-gray-500">
            Este código QR não corresponde a um recebimento válido.
            <br />Verifique a etiqueta e tente novamente.
          </p>
        </div>
      </div>
    );
  }

  const lotes = asArray(info.lotes);
  const transbordos = asArray(info.transbordos);
  const pesagem = info.pesagem && typeof info.pesagem === "object" ? info.pesagem : null;
  const titulo = lotes.length === 1
    ? (lotes[0].produto_nome || "Recebimento")
    : "Recebimento";

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-4 px-4 sm:py-8" style={{ colorScheme: "light" }}>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: "#1e56a0" }}>
            <span className="text-white text-lg font-bold">ChemCtrl</span>
            <span className="text-white text-xs font-medium opacity-90">Consulta pública</span>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4" style={{ color: "#00875a" }} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recebimento verificado</p>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{titulo}</h1>
            {info.codigo ? <p className="text-sm text-gray-500 mt-0.5">{info.codigo}</p> : null}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-6 pb-5">
            <Field label="Data" value={formatDate(info.data)} />
            <Field label="Cliente" value={info.cliente} />
            <Field label="Nota fiscal" value={info.nota_fiscal} />
            <Field label="Fornecedor" value={info.fornecedor} />
            <Field label="Origem" value={info.origem ? origemLabel(info.origem) : ""} />
          </div>
        </div>

        <Section title="Lotes">
          {lotes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum lote informado.</p>
          ) : (
            <div className="space-y-4">
              {lotes.map((lote, index) => {
                const nota = filled(lote.nota_fiscal) && lote.nota_fiscal !== info.nota_fiscal
                  ? lote.nota_fiscal
                  : "";
                return (
                  <article key={`${lote.lote || "lote"}-${index}`} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start gap-2 mb-3">
                      <Package className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 break-words">{lote.produto_nome || "Produto"}</p>
                        {filled(lote.produto_codigo) ? (
                          <p className="text-xs text-gray-500">Código {lote.produto_codigo}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <Field label="Lote" value={lote.lote} />
                      <Field label="Nota fiscal" value={nota || (!info.nota_fiscal ? lote.nota_fiscal : "")} />
                      <Field label="Quantidade" value={quantidadeTexto(lote, info, lotes.length)} />
                      <Field label="Unidade" value={lote.unidade_medida || info.unidade} />
                      <Field label="Quantidade recebida" value={quantidadeRecebidaTexto(lote)} />
                      <Field label="Fabricação" value={formatDate(lote.data_fabricacao)} />
                      <Field label="Validade" value={formatDate(lote.data_validade)} />
                      <Field label="Densidade" value={filled(lote.densidade) ? formatDensidade(lote.densidade, { empty: "" }) : ""} />
                      <Field label="Tipo" value={getTipoRecebimentoLabel(resolveTipoRecebimento(lote))} />
                      <Field label="Embalagem" value={embalagemTexto(lote)} />
                      <Field label="Volume" value={filled(lote.volume) ? `${formatVolume(lote.volume, { empty: "" })} L` : ""} />
                      <Field label="Peso líquido" value={filled(lote.peso_liquido) ? `${formatMass(lote.peso_liquido, { empty: "" })} kg` : ""} />
                      <Field label="Peso bruto" value={filled(lote.peso_bruto) ? `${formatMass(lote.peso_bruto, { empty: "" })} kg` : ""} />
                      <Field label="Tara" value={filled(lote.tara) ? `${formatMass(lote.tara, { empty: "" })} kg` : ""} />
                      <Field label="Embalagens" value={filled(lote.quantidade_embalagens) ? formatQuantidade(lote.quantidade_embalagens, { empty: "" }) : ""} />
                      <Field label="Lacres" value={lote.lacres} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        {pesagem ? (
          <Section title="Pesagem">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Ticket" value={pesagem.ticket} />
              <Field label="Peso bruto" value={filled(pesagem.peso_bruto) ? `${formatMass(pesagem.peso_bruto, { empty: "" })} kg` : ""} />
              <Field label="Peso líquido" value={filled(pesagem.peso_liquido) ? `${formatMass(pesagem.peso_liquido, { empty: "" })} kg` : ""} />
              <Field label="Validação bruto" value={filled(pesagem.validacao_bruto) ? `${formatMass(pesagem.validacao_bruto, { empty: "" })} kg` : ""} />
              <Field label="Validação líquido" value={filled(pesagem.validacao_liquido) ? `${formatMass(pesagem.validacao_liquido, { empty: "" })} kg` : ""} />
              <Field
                label="Margem"
                value={pesagem.margem === "dentro" ? "Dentro" : pesagem.margem === "fora" ? "Fora" : ""}
              />
              <Field label="Peso mínimo" value={filled(pesagem.peso_minimo) ? `${formatMass(pesagem.peso_minimo, { empty: "" })} kg` : ""} />
              <Field label="Peso máximo" value={filled(pesagem.peso_maximo) ? `${formatMass(pesagem.peso_maximo, { empty: "" })} kg` : ""} />
              <Field label="Erro admissível" value={filled(pesagem.erro_admissivel) ? `${formatMass(pesagem.erro_admissivel, { empty: "" })} kg` : ""} />
            </div>
          </Section>
        ) : null}

        {transbordos.length > 0 ? (
          <Section title="Transbordo">
            <div className="space-y-4">
              {transbordos.map((op, index) => {
                const destinos = asArray(op.destinos);
                return (
                  <article key={`${op.codigo || "op"}-${index}`} className="rounded-xl border border-gray-200 p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <Field label="OP" value={op.codigo} />
                      <Field label="Data" value={formatDate(op.data)} />
                      <Field label="Volume" value={filled(op.volume_total) ? `${formatVolume(op.volume_total, { empty: "" })} L` : ""} />
                      <Field label="Massa" value={filled(op.massa_total) ? `${formatMass(op.massa_total, { empty: "" })} kg` : ""} />
                    </div>
                    {destinos.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                          <thead>
                            <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                              <th className="px-3 py-2 font-medium">Destino</th>
                              <th className="px-3 py-2 font-medium">Volume</th>
                              <th className="px-3 py-2 font-medium">Peso líquido</th>
                              <th className="px-3 py-2 font-medium">Lacres</th>
                            </tr>
                          </thead>
                          <tbody>
                            {destinos.map((destino, destinoIndex) => {
                              const nome = [destino.tipo, formatEtiquetaEmbalagemPlaca(destino.placa, destino.barril) || destino.tanka]
                                .filter(filled)
                                .join(" · ") || "—";
                              return (
                                <tr key={destinoIndex} className="border-t border-gray-100">
                                  <td className="px-3 py-2 text-gray-800">{nome}</td>
                                  <td className="px-3 py-2 text-gray-800">
                                    {filled(destino.volume) ? `${formatVolume(destino.volume, { empty: "—" })} L` : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-gray-800">
                                    {filled(destino.peso_liquido) ? `${formatMass(destino.peso_liquido, { empty: "—" })} kg` : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-gray-800">{filled(destino.lacres) ? destino.lacres : "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </Section>
        ) : null}

        <p className="text-center text-xs text-gray-400 leading-relaxed pb-4">
          Consulta pública do recebimento. Não requer login.
        </p>
      </div>
    </div>
  );
}

export default function ConsultaPublicaEntrada() {
  return (
    <ThemeProvider forcedTheme="light" enableSystem={false}>
      <ConsultaPublicaEntradaPage />
    </ThemeProvider>
  );
}
