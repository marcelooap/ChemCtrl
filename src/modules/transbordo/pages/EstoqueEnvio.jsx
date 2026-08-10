import { useState, useEffect, useMemo } from "react";
import { Package, Box as BoxIcon, Cylinder, Search, FileText } from "lucide-react";
import { entities } from "@transbordo/services/entities";
import { Input } from "@shared/components/ui/input";
import { Button } from "@shared/components/ui/button";
import { useToast } from "@shared/components/ui/use-toast";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import TankSilo from "@transbordo/components/tankagem/TankSilo";
import TankagemViewDialog from "@transbordo/components/tankagem/TankagemViewDialog";
import {
  computeEstoqueSaldo,
  getEstoqueQuantidade,
  getEstoqueUnidade,
  getEstoqueUnidadeEntrada,
  getEstoqueSaldoEntrada,
  hydrateEstoqueFiscal,
} from "@transbordo/lib/estoqueSaldo";
import { isEstoqueEmbalagemUnitaria } from "@transbordo/lib/transbordoEmbalado";
import {
  computeTankaSaldo,
  computeTankaLotesDisponiveis,
  buildTankaDetalhe,
} from "@transbordo/lib/tankaVolume";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { formatMass, formatVolume, roundVolume } from "@transbordo/lib/format";
import { generateEstoqueEnvioPDF } from "@transbordo/lib/pdfEstoque";

const PRODUCT_COLORS = [
  "#90EE90", "#87CEEB", "#DDA0DD", "#F0E68C", "#FFB6C1",
  "#E6E6FA", "#98FB98", "#FABD74", "#B0E0E6", "#DEB887",
  "#BC8F8F", "#AED581", "#4FC3F7", "#FFD54F", "#FF8A65",
  "#BA68C8", "#7986CB", "#4DB6AC", "#F06292", "#81C784",
];

function matchesCliente(item, clienteFilter) {
  if (!clienteFilter || clienteFilter === "Todos os clientes") return true;
  return (item?.cliente_nome || "") === clienteFilter;
}

function formatSaldo(value, unidade) {
  const u = String(unidade || "kg").toLowerCase();
  if (
    u === "l" ||
    u === "lt" ||
    u === "litro" ||
    u === "litros" ||
    u === "gal"
  ) {
    return formatVolume(value, { empty: "-" });
  }
  return formatMass(value, { empty: "-" });
}

export default function EstoqueEnvio() {
  const { toast } = useToast();
  const [estoque, setEstoque] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [clienteFilter, setClienteFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [viewDetalhe, setViewDetalhe] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [ests, vascs, isot, trans, cliens, saics] = await Promise.all([
          entities.estoque.list(),
          entities.vasilhames.list(),
          entities.isotanques.list(),
          entities.transbordos.list(),
          entities.clientes.list(),
          entities.saidas.list(),
        ]);

        const estoqueWithSaldo = ests
          .filter((e) => !isEstoqueEmbalagemUnitaria(e))
          .map((e) => {
            const hydrated = hydrateEstoqueFiscal(e);
            const quantidade = getEstoqueQuantidade(hydrated);
            const unidade_medida = getEstoqueUnidade(hydrated);
            return {
              ...hydrated,
              quantidade,
              unidade_medida,
              saldo_atual: computeEstoqueSaldo(
                { ...hydrated, quantidade },
                trans,
                saics,
                vascs
              ),
            };
          });

        setEstoque(estoqueWithSaldo);
        setVasilhames(vascs);
        setIsotanques(isot);
        setTransbordos(trans);
        setClientes(cliens);
      } catch {
        setEstoque([]);
        setVasilhames([]);
        setIsotanques([]);
        setTransbordos([]);
        setClientes([]);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const q = search.toLowerCase().trim();
  const hasClientFilter =
    Boolean(clienteFilter) && clienteFilter !== "Todos os clientes";

  const produtosAgregados = useMemo(() => {
    const map = new Map();

    for (const e of estoque) {
      if (!matchesCliente(e, clienteFilter)) continue;
      if ((Number(e.saldo_atual) || 0) <= 0) continue;

      const saldo = getEstoqueSaldoEntrada(e);
      if (saldo <= 0) continue;

      const codigo = (e.produto_codigo || "").trim() || "—";
      const produto = (e.produto_nome || "").trim() || "—";
      const unidade = getEstoqueUnidadeEntrada(e) || "kg";
      const key = `${codigo}||${unidade}||${e.cliente_nome || ""}`;

      if (q) {
        const hay = `${codigo} ${produto} ${e.cliente_nome || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const prev = map.get(key);
      if (prev) {
        prev.saldo += saldo;
      } else {
        map.set(key, {
          id: key,
          codigo,
          produto,
          unidade,
          saldo,
          cliente_nome: e.cliente_nome || "",
        });
      }
    }

    return [...map.values()].sort((a, b) =>
      a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })
    );
  }, [estoque, clienteFilter, q]);

  const filteredVasilhames = useMemo(() => {
    return vasilhames.filter((v) => {
      if ((v.tipo || "") === "Tankagem") return false;
      if ((v.status || "No Pátio") !== "No Pátio") return false;
      if (!matchesCliente(v, clienteFilter)) return false;

      if (!q) return true;
      const hay = [
        v.codigo,
        v.placa,
        v.barril,
        v.produto_codigo,
        v.produto_nome,
        v.cliente_nome,
        v.lote,
        v.tipo,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vasilhames, clienteFilter, q]);

  const filteredTankas = useMemo(() => {
    return isotanques
      .map((iso) => {
        const tankaCodigo = iso.tanka || iso.codigo_itku || "";
        const volume = roundVolume(
          computeTankaSaldo({
            isotanqueId: iso.id,
            tankaCodigo,
            transbordos,
          })
        );

        const fillings = transbordos
          .filter((t) =>
            (t.destinos || []).some(
              (d) =>
                d.tipo_embalagem === "Tankagem" &&
                (d.tanka_id === iso.id || d.tanka_codigo === tankaCodigo)
            )
          )
          .sort(
            (a, b) =>
              new Date(b.created_at || b.created_date || b.data || 0) -
              new Date(a.created_at || a.created_date || a.data || 0)
          );

        return {
          ...iso,
          tankaCodigo,
          volumeAtual: volume,
          produto: iso.produto_nome || fillings[0]?.produto_nome || "",
          cliente_nome:
            iso.cliente_nome || fillings[0]?.cliente_nome || "",
        };
      })
      .filter((t) => {
        if (!matchesCliente(t, clienteFilter)) return false;
        if (!q) return true;
        const hay = [t.tankaCodigo, t.produto, t.cliente_nome]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) =>
        String(a.tankaCodigo).localeCompare(String(b.tankaCodigo), undefined, {
          numeric: true,
        })
      );
  }, [isotanques, transbordos, clienteFilter, q]);

  const productColorMap = useMemo(() => {
    const map = {};
    let colorIndex = 0;
    filteredTankas.forEach((tank) => {
      const prod = tank.produto || "";
      if (prod && !(prod in map)) {
        map[prod] = PRODUCT_COLORS[colorIndex % PRODUCT_COLORS.length];
        colorIndex++;
      }
    });
    return map;
  }, [filteredTankas]);

  const handleViewTanka = (tank) => {
    setViewDetalhe(buildTankaDetalhe({ isotanque: tank, transbordos }));
    setViewOpen(true);
  };

  const handlePDF = () => {
    const hasData =
      produtosAgregados.length > 0 ||
      filteredVasilhames.length > 0 ||
      filteredTankas.length > 0;
    if (!hasData) {
      toast({
        title: "Nenhum dado para exportar",
        description: "Ajuste o filtro de cliente ou a busca.",
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);
    try {
      const containers = filteredVasilhames.map((v) => ({
        ...v,
        lote: getDominantLote(v.composicao) || v.lote || "",
      }));

      const tanks = filteredTankas.map((tank) => {
        const lotes = computeTankaLotesDisponiveis({
          isotanqueId: tank.id,
          tankaCodigo: tank.tankaCodigo,
          transbordos,
        });
        return { ...tank, lotes };
      });

      generateEstoqueEnvioPDF({
        client: hasClientFilter ? clienteFilter : "Todos os clientes",
        products: produtosAgregados,
        containers,
        tanks,
      });
      toast({ title: "PDF gerado com sucesso" });
    } catch {
      toast({
        title: "Erro ao gerar PDF",
        description: "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const clienteFilterOptions = [
    { id: "all", nome: "Todos os clientes" },
    ...clientes,
  ];

  const canExportPdf =
    produtosAgregados.length > 0 ||
    filteredVasilhames.length > 0 ||
    filteredTankas.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estoque Envio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {hasClientFilter
              ? `Estoque consolidado de ${clienteFilter}`
              : "Visão consolidada do estoque por cliente (produtos, vasilhames e tankas)"}
          </p>
        </div>
        <Button
          onClick={handlePDF}
          disabled={generating || !canExportPdf}
          className="flex items-center gap-2 whitespace-nowrap bg-primary hover:bg-primary/90"
        >
          <FileText className="w-4 h-4" />
          {generating ? "Gerando..." : "Gerar PDF"}
        </Button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto, código, placa, tanka..."
            className="pl-10 bg-card"
          />
        </div>
        <div className="w-56">
          <SearchableSelect
            value={clienteFilter}
            onChange={(label) => setClienteFilter(label)}
            options={clienteFilterOptions}
            getOptionLabel={(c) => c.nome}
            getOptionValue={(c) => c.id}
            placeholder="Todos os clientes"
          />
        </div>
      </div>

      {/* Produtos — saldo agregado */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            Estoque de produtos
          </h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {produtosAgregados.length}
          </span>
        </div>
        {produtosAgregados.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum produto com saldo para o filtro selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  {!hasClientFilter && (
                    <th className="px-4 py-3 font-medium">Cliente</th>
                  )}
                  <th className="px-4 py-3 font-medium text-right">Saldo</th>
                  <th className="px-4 py-3 font-medium text-center">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {produtosAgregados.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/20" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {p.codigo}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.produto}
                    </td>
                    {!hasClientFilter && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.cliente_nome || "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                        {formatSaldo(p.saldo, p.unidade)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-primary">
                      {p.unidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vasilhames — IBC, bombona, tambor, etc. */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <BoxIcon className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Vasilhames</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {filteredVasilhames.length}
          </span>
        </div>
        {filteredVasilhames.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum vasilhame no pátio para o filtro selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                  <th className="px-4 py-3 font-medium">Nº Placa</th>
                  <th className="px-4 py-3 font-medium">Nº Barril</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  {!hasClientFilter && (
                    <th className="px-4 py-3 font-medium">Cliente</th>
                  )}
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium text-right">Volume (L)</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredVasilhames.map((v, i) => {
                  const dominant =
                    getDominantLote(v.composicao) || v.lote || "—";
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                        i % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {v.placa || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {v.barril || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {v.tipo || "—"}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {v.produto_nome || "—"}
                      </td>
                      {!hasClientFilter && (
                        <td className="px-4 py-3 text-muted-foreground">
                          {v.cliente_nome || "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground">
                        {dominant}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          {formatVolume(v.volume, { empty: "—" })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          {v.status || "No Pátio"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tankas — silos (mesmo formato da Tankagem) */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border flex-wrap">
          <Cylinder className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Tankas</h3>
          <span className="text-sm text-muted-foreground">
            {filteredTankas.length} tanka(s)
          </span>
          <span className="text-sm font-medium text-foreground/80 ml-auto">
            {formatVolume(
              filteredTankas.reduce((sum, t) => sum + t.volumeAtual, 0)
            )}{" "}
            L
          </span>
        </div>
        {filteredTankas.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma tanka para o filtro selecionado.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {filteredTankas.map((tank) => (
              <TankSilo
                key={tank.id}
                tanka={tank.tanka || tank.codigo_itku}
                capacidade={tank.capacidade || 0}
                volume={tank.volumeAtual}
                produto={tank.produto}
                fillColor={
                  tank.produto ? productColorMap[tank.produto] : null
                }
                onView={() => handleViewTanka(tank)}
              />
            ))}
          </div>
        )}
      </div>

      <TankagemViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewDetalhe(null);
        }}
        detalhe={viewDetalhe}
      />
    </div>
  );
}
