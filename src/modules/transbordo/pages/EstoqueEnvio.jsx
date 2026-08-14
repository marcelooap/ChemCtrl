import { useState, useEffect, useMemo } from "react";
import { Package, Box as BoxIcon, Cylinder, Search, FileText } from "lucide-react";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
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
  computeTankaLotesDisponiveis,
  buildTankaDetalhe,
} from "@transbordo/lib/tankaVolume";
import {
  mergeTankasUnificadas,
  buildIndTankaDetalhe,
} from "@transbordo/lib/tankaUnificada";
import {
  sumReservadoForProdutoCliente,
} from "@painel/lib/materialReservas";
import {
  ORIGEM_TRANSBORDO,
  buildVasilhameReservaChave,
  isVasilhameReservado,
  sumReservadoVasilhamesConteudo,
} from "@painel/lib/vasilhameReservas";
import { getDominantLote, repairVasilhameComposicao, unifyDuplicateVasilhames, normalizeVasilhameLote } from "@transbordo/lib/vasilhameComposicao";
import { formatMass, formatVolume, roundVolume, parseNumero } from "@transbordo/lib/format";
import { generateEstoqueEnvioPDF } from "@transbordo/lib/pdfEstoque";

const PRODUCT_COLORS = [
  "#90EE90", "#87CEEB", "#DDA0DD", "#F0E68C", "#FFB6C1",
  "#E6E6FA", "#98FB98", "#FABD74", "#B0E0E6", "#DEB887",
  "#BC8F8F", "#AED581", "#4FC3F7", "#FFD54F", "#FF8A65",
  "#BA68C8", "#7986CB", "#4DB6AC", "#F06292", "#81C784",
];

function matchesCliente(item, clienteFilter, clientes = []) {
  if (!clienteFilter || clienteFilter === "Todos os clientes") return true;

  const norm = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const filterNome = String(clienteFilter).trim();
  const filterKey = norm(filterNome);
  const itemNome = String(item?.cliente_nome || "").trim();
  if (itemNome && norm(itemNome) === filterKey) return true;

  const selected = (clientes || []).find((c) => norm(c?.nome) === filterKey);
  if (!selected) return norm(itemNome) === filterKey;

  const selectedId = selected.id != null ? String(selected.id) : "";
  const itemId = item?.cliente_id != null ? String(item.cliente_id) : "";
  if (selectedId && itemId && selectedId === itemId) return true;

  return norm(itemNome) === norm(selected.nome);
}

function normPlacaKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normProdutoKey(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Capacidade em litros. Trata milhar BR ("5.000", "1.500") que o parseNumero
 * interpretaria como decimal (5 / 1.5).
 */
function parseCapacidadeLitros(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s || s === "-") return 0;
  // 5.000 | 1.500 | 12.000 → milhar BR sem casas decimais
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const n = parseFloat(s.replace(/\./g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return parseNumero(s);
}

/** Capacidade real do vasilhame: campo próprio → cadastro pela placa → inferência. */
function resolveVasilhameCapacidade(v, placaStats) {
  const snapPadrao = (n) => {
    if (n == null || n <= 0) return null;
    for (const std of [5000, 1500]) {
      const tol = Math.max(5, std * 0.02);
      if (Math.abs(n - std) <= tol) return std;
    }
    return null;
  };

  const own = parseCapacidadeLitros(v?.capacidade);
  if (own > 0) return snapPadrao(own) || own;

  const placa = normPlacaKey(v?.placa);
  const stats = placa && placaStats ? placaStats.get(placa) : null;
  if (stats?.maxCap > 0) return snapPadrao(stats.maxCap) || stats.maxCap;

  const vol = parseCapacidadeLitros(v?.volume);
  const maxVol = Math.max(vol, stats?.maxVol || 0);
  const snapped = snapPadrao(maxVol);
  if (snapped) return snapped;

  // Frota típica: volume atual/histórico acima de ~1.500 L ⇒ tanque 5.000 L
  // (cobre tanques 5.000 parcialmente cheios sem capacidade cadastrada)
  if (maxVol > 1600) return 5000;

  return null;
}

function matchesCapacidadePadrao(cap, target) {
  if (cap == null) return false;
  const n = parseCapacidadeLitros(cap);
  if (n <= 0) return false;
  const tol = Math.max(5, target * 0.02);
  return Math.abs(n - target) <= tol;
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

function SaldoBadge({ children, tone = "green" }) {
  const tones = {
    blue: "bg-sky-100 text-sky-700",
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-800",
    muted: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-100 text-emerald-700",
  };
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
        tones[tone] || tones.green
      }`}
    >
      {children}
    </span>
  );
}

/** Total no pátio + quantidade reservada (quando > 0). */
function CapacidadeCount({ total = 0, reservado = 0 }) {
  return (
    <div className="leading-tight">
      <div className="tabular-nums">{total}</div>
      {reservado > 0 ? (
        <div className="text-[10px] font-semibold text-amber-700 tabular-nums">
          {reservado} res.
        </div>
      ) : null}
    </div>
  );
}

function StatusReservaBadge({ reservado }) {
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
        reservado
          ? "bg-purple-100 text-purple-800"
          : "bg-green-100 text-green-800"
      }`}
    >
      {reservado ? "Reservado" : "Livre"}
    </span>
  );
}

export default function EstoqueEnvio() {
  const { toast } = useToast();
  const [estoque, setEstoque] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [indTanks, setIndTanks] = useState([]);
  const [indContainers, setIndContainers] = useState([]);
  const [indStock, setIndStock] = useState([]);
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
        const [ests, vascs, isot, trans, cliens, saics, reservasList] =
          await Promise.all([
            entities.estoque.list(),
            entities.vasilhames.list(),
            entities.isotanques.list(),
            entities.transbordos.list(),
            entities.clientes.list(),
            entities.saidas.list(),
            entities.materialReservas.list().catch(() => []),
          ]);

        // Corrige volumes inflados (duplicata de OP / unificação) pelo histórico real
        let vasilhamesOk = Array.isArray(vascs) ? vascs : [];
        try {
          const { kept, deletedIds } = await unifyDuplicateVasilhames(
            vasilhamesOk,
            entities
          );
          vasilhamesOk =
            deletedIds.length > 0
              ? kept
              : vasilhamesOk.map((v) => normalizeVasilhameLote(v));

          const repaired = [];
          for (const v of vasilhamesOk) {
            if (
              (v.status || "No Pátio") === "No Pátio" &&
              v.placa &&
              (v.tipo || "") !== "Tankagem" &&
              (v.origem === "transbordo" ||
                v.origem === "manual" ||
                v.fracionado)
            ) {
              repaired.push(
                await repairVasilhameComposicao(v, trans, entities)
              );
            } else {
              repaired.push(normalizeVasilhameLote(v));
            }
          }
          vasilhamesOk = repaired;
        } catch (vasErr) {
          console.warn("[EstoqueEnvio] reparo vasilhames:", vasErr);
        }

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
                vasilhamesOk
              ),
            };
          });

        setEstoque(estoqueWithSaldo);
        setVasilhames(vasilhamesOk);
        setIsotanques(isot);
        setTransbordos(trans);
        setClientes(cliens);
        setReservas(reservasList || []);

        // Industrialização em etapa separada (evita rate-limit / falha silenciosa
        // no Promise.all principal — tankas cadastradas devem aparecer mesmo vazias)
        try {
          const loadIndList = async (fn) => {
            try {
              const rows = await fn();
              return Array.isArray(rows) ? rows : [];
            } catch {
              return [];
            }
          };

          const [tanksInd, containersInd, stockInd] = await Promise.all([
            loadIndList(() => base44.entities.Tank.list("-created_date", 500)),
            loadIndList(() =>
              base44.entities.Container.list("-created_date", 2000)
            ),
            loadIndList(() =>
              base44.entities.RawMaterialStock.list("-created_date", 1000)
            ),
          ]);

          // Fallback sem ordenação se a lista de tankas veio vazia por erro de coluna
          let tanksFinal = tanksInd;
          if (tanksFinal.length === 0) {
            tanksFinal = await loadIndList(() =>
              base44.entities.Tank.list(undefined, 500)
            );
          }

          setIndTanks(tanksFinal);
          setIndContainers(containersInd);
          setIndStock(stockInd);
        } catch (indErr) {
          console.warn("[EstoqueEnvio] Industrialização:", indErr);
          setIndTanks([]);
          setIndContainers([]);
          setIndStock([]);
        }
      } catch {
        setEstoque([]);
        setVasilhames([]);
        setIsotanques([]);
        setTransbordos([]);
        setClientes([]);
        setReservas([]);
        setIndTanks([]);
        setIndContainers([]);
        setIndStock([]);
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
      if (!matchesCliente(e, clienteFilter, clientes)) continue;
      if ((Number(e.saldo_atual) || 0) <= 0) continue;

      const saldo = getEstoqueSaldoEntrada(e);
      if (saldo <= 0) continue;

      const codigo = (e.produto_codigo || "").trim() || "—";
      const produto = (e.produto_nome || "").trim() || "—";
      const unidade = getEstoqueUnidadeEntrada(e) || "kg";
      // Diferencia pelo nome/descrição (mesmo código pode ser Bombona vs IBC)
      const key = [
        codigo,
        normProdutoKey(produto),
        unidade,
        e.cliente_id || normProdutoKey(e.cliente_nome) || "",
      ].join("||");

      if (q) {
        const hay = `${codigo} ${produto} ${e.cliente_nome || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const prev = map.get(key);
      if (prev) {
        prev.saldo += saldo;
        if (!prev.clienteId && e.cliente_id) prev.clienteId = e.cliente_id;
      } else {
        map.set(key, {
          id: key,
          codigo,
          produto,
          unidade,
          saldo,
          cliente_nome: e.cliente_nome || "",
          clienteId: e.cliente_id || null,
        });
      }
    }

    return [...map.values()]
      .map((row) => {
        const reservadoEmbalado = sumReservadoForProdutoCliente(reservas, {
          clienteId: row.clienteId,
          clienteNome: row.cliente_nome,
          produtoCodigo: row.codigo,
          produtoNome: row.produto,
          unidade: row.unidade,
        });
        const reservadoVasilhame = sumReservadoVasilhamesConteudo(
          vasilhames,
          reservas,
          {
            clienteId: row.clienteId,
            clienteNome: row.cliente_nome,
            produtoCodigo: row.codigo,
            produtoNome: row.produto,
            unidade: row.unidade,
          }
        );
        const saldoReservado = Math.round(
          reservadoEmbalado + reservadoVasilhame
        );
        const saldoAtual = Math.round(row.saldo || 0);
        const saldoFinal = Math.max(0, saldoAtual - saldoReservado);
        return {
          ...row,
          saldo: saldoAtual,
          saldoReservado,
          saldoFinal,
        };
      })
      .sort((a, b) => {
        // Agrupa visualmente pelo código; dentro do mesmo código, ordena pelo nome
        const byCod = a.codigo.localeCompare(b.codigo, "pt-BR", {
          numeric: true,
        });
        if (byCod !== 0) return byCod;
        const byNome = a.produto.localeCompare(b.produto, "pt-BR", {
          sensitivity: "base",
        });
        if (byNome !== 0) return byNome;
        return String(a.unidade).localeCompare(String(b.unidade), "pt-BR");
      });
  }, [estoque, clienteFilter, clientes, q, reservas, vasilhames]);

  const filteredVasilhames = useMemo(() => {
    return vasilhames
      .filter((v) => {
        if ((v.tipo || "") === "Tankagem") return false;
        if ((v.status || "No Pátio") !== "No Pátio") return false;
        if (!matchesCliente(v, clienteFilter, clientes)) return false;

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
      })
      .map((v) => {
        const chave = buildVasilhameReservaChave(ORIGEM_TRANSBORDO, v.id);
        const reservado = isVasilhameReservado(reservas, chave);
        return {
          ...v,
          reservaChave: chave,
          reservado,
          statusReserva: reservado ? "Reservado" : "Livre",
        };
      });
  }, [vasilhames, clienteFilter, clientes, q, reservas]);

  /** Resumo por produto × capacidade (e fracionados) sobre o conjunto filtrado. */
  const vasilhamesResumoPorProduto = useMemo(() => {
    // Estatísticas por placa (capacidade cadastrada + maior volume histórico)
    const placaStats = new Map();
    for (const v of vasilhames || []) {
      const placa = normPlacaKey(v?.placa);
      if (!placa) continue;
      const prev = placaStats.get(placa) || { maxCap: 0, maxVol: 0 };
      prev.maxCap = Math.max(
        prev.maxCap,
        parseCapacidadeLitros(v?.capacidade)
      );
      prev.maxVol = Math.max(prev.maxVol, parseCapacidadeLitros(v?.volume));
      placaStats.set(placa, prev);
    }

    const map = new Map();

    for (const v of filteredVasilhames) {
      const codigo = String(v.produto_codigo || "").trim() || "—";
      const produto = String(v.produto_nome || "").trim() || "—";
      const cliente = String(v.cliente_nome || "").trim();
      const key = `${codigo}||${produto.toUpperCase()}||${cliente.toUpperCase()}`;
      const isReservado = v.reservado === true;

      let row = map.get(key);
      if (!row) {
        row = {
          id: key,
          codigo,
          produto,
          cliente_nome: cliente,
          cap5000: 0,
          cap1500: 0,
          outros: 0,
          fracionados: 0,
          total: 0,
          cap5000Reservado: 0,
          cap1500Reservado: 0,
          outrosReservado: 0,
          fracionadosReservado: 0,
          totalReservado: 0,
        };
        map.set(key, row);
      }

      row.total += 1;
      if (isReservado) row.totalReservado += 1;

      if (v.fracionado === true) {
        row.fracionados += 1;
        if (isReservado) row.fracionadosReservado += 1;
        continue;
      }

      const cap = resolveVasilhameCapacidade(v, placaStats);
      if (matchesCapacidadePadrao(cap, 5000)) {
        row.cap5000 += 1;
        if (isReservado) row.cap5000Reservado += 1;
      } else if (matchesCapacidadePadrao(cap, 1500)) {
        row.cap1500 += 1;
        if (isReservado) row.cap1500Reservado += 1;
      } else {
        row.outros += 1;
        if (isReservado) row.outrosReservado += 1;
      }
    }

    return [...map.values()].sort((a, b) => {
      const byCod = a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });
      if (byCod !== 0) return byCod;
      const byNome = a.produto.localeCompare(b.produto, "pt-BR", {
        sensitivity: "base",
      });
      if (byNome !== 0) return byNome;
      return a.cliente_nome.localeCompare(b.cliente_nome, "pt-BR", {
        sensitivity: "base",
      });
    });
  }, [filteredVasilhames, vasilhames]);

  const unifiedTankas = useMemo(
    () =>
      mergeTankasUnificadas({
        isotanques,
        transbordos,
        indTanks,
        indContainers,
        indStock,
      }),
    [isotanques, transbordos, indTanks, indContainers, indStock]
  );

  const filteredTankas = useMemo(() => {
    return unifiedTankas
      .filter((t) => {
        if (!matchesCliente(t, clienteFilter, clientes)) return false;
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
  }, [unifiedTankas, clienteFilter, clientes, q]);

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
    // Detalhe alinhado à fonte do volume exibido (evita divergência visual)
    if (
      tank.volumeSource === "ind_container" ||
      tank.volumeSource === "ind_stock" ||
      tank.volumeSource === "ind_cadastro" ||
      !tank.hasTransbordo
    ) {
      setViewDetalhe(buildIndTankaDetalhe(tank));
    } else if (tank.hasTransbordo && tank.isotanque) {
      setViewDetalhe(
        buildTankaDetalhe({
          isotanque: {
            ...tank.isotanque,
            produto_nome: tank.produto || tank.isotanque.produto_nome,
            cliente_nome: tank.cliente_nome || tank.isotanque.cliente_nome,
            capacidade: tank.capacidade || tank.isotanque.capacidade,
          },
          transbordos,
        })
      );
    } else {
      setViewDetalhe(buildIndTankaDetalhe(tank));
    }
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
        if (tank.hasTransbordo && tank.isotanque && tank.volumeSource === "transbordo") {
          const lotes = computeTankaLotesDisponiveis({
            isotanqueId: tank.isotanque.id,
            tankaCodigo: tank.tankaCodigo,
            transbordos,
          });
          return { ...tank, lotes };
        }
        return {
          ...tank,
          lotes:
            (Number(tank.volumeAtual) || 0) > 0
              ? [
                  {
                    lote: tank.lote || "",
                    quantidade_l: roundVolume(tank.volumeAtual || 0),
                  },
                ]
              : [],
        };
      });

      generateEstoqueEnvioPDF({
        client: hasClientFilter ? clienteFilter : "Todos os clientes",
        products: produtosAgregados,
        containers,
        containersSummary: vasilhamesResumoPorProduto,
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

  const clienteFilterOptions = useMemo(() => {
    const map = new Map();
    for (const c of clientes || []) {
      const nome = String(c?.nome || "").trim();
      if (!nome) continue;
      map.set(nome.toLowerCase(), { id: c.id, nome });
    }
    // Inclui clientes cadastrados só na Industrialização (ex.: Vibra Energia em tankas)
    for (const t of indTanks || []) {
      const nome = String(t?.client || "").trim();
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (!map.has(key)) map.set(key, { id: `ind-client:${key}`, nome });
    }
    for (const t of unifiedTankas || []) {
      const nome = String(t?.cliente_nome || "").trim();
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (!map.has(key)) map.set(key, { id: `tank-client:${key}`, nome });
    }
    return [
      { id: "all", nome: "Todos os clientes" },
      ...[...map.values()].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
      ),
    ];
  }, [clientes, indTanks, unifiedTankas]);

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
    <div className="h-full min-h-0 overflow-y-auto space-y-6">
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
                  <th className="px-4 py-3 font-medium text-right">Saldo Atual</th>
                  <th className="px-4 py-3 font-medium text-right">Reservado</th>
                  <th className="px-4 py-3 font-medium text-right">Saldo Final</th>
                  <th className="px-4 py-3 font-medium text-center">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let groupIndex = 0;
                  return produtosAgregados.map((p, i) => {
                    const prevCodigo =
                      i > 0 ? produtosAgregados[i - 1].codigo : null;
                    const isNewCodigoGroup = p.codigo !== prevCodigo;
                    if (isNewCodigoGroup && i > 0) groupIndex += 1;

                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                          groupIndex % 2 === 1 ? "bg-muted/20" : ""
                        } ${
                          isNewCodigoGroup && i > 0
                            ? "border-t-2 border-t-border"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {isNewCodigoGroup ? (
                            p.codigo
                          ) : (
                            <span
                              className="text-muted-foreground/40"
                              title={p.codigo}
                            >
                              ↳
                            </span>
                          )}
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
                          <SaldoBadge tone="blue">
                            {formatSaldo(p.saldo, p.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge
                            tone={p.saldoReservado > 0 ? "amber" : "muted"}
                          >
                            {formatSaldo(p.saldoReservado, p.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone="emerald">
                            {formatSaldo(p.saldoFinal, p.unidade)}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-primary">
                          {p.unidade}
                        </td>
                      </tr>
                    );
                  });
                })()}
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

        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Resumo por produto / capacidade
          </p>
          <p className="text-[11px] text-muted-foreground mb-2">
            Em cada capacidade: total no pátio e, quando houver, quantidade reservada.
          </p>
          {vasilhamesResumoPorProduto.length === 0 ? (
            <p className="text-sm text-muted-foreground py-1">
              Nenhum vasilhame para resumir no filtro atual.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b border-border bg-muted/40 uppercase">
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Produto</th>
                    {!hasClientFilter && (
                      <th className="px-3 py-2 font-medium">Cliente</th>
                    )}
                    <th className="px-3 py-2 font-medium text-right">5.000 L</th>
                    <th className="px-3 py-2 font-medium text-right">1.500 L</th>
                    <th
                      className="px-3 py-2 font-medium text-right"
                      title="Capacidades diferentes de 5.000 L e 1.500 L"
                    >
                      Outros
                    </th>
                    <th className="px-3 py-2 font-medium text-right">
                      Fracionados
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {vasilhamesResumoPorProduto.map((row, i) => (
                    <tr
                      key={row.id}
                      className={`border-b border-border last:border-0 ${
                        i % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {row.codigo}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {row.produto}
                      </td>
                      {!hasClientFilter && (
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.cliente_nome || "—"}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right">
                        <CapacidadeCount
                          total={row.cap5000}
                          reservado={row.cap5000Reservado}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CapacidadeCount
                          total={row.cap1500}
                          reservado={row.cap1500Reservado}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CapacidadeCount
                          total={row.outros}
                          reservado={row.outrosReservado}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CapacidadeCount
                          total={row.fracionados}
                          reservado={row.fracionadosReservado}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground">
                        <CapacidadeCount
                          total={row.total}
                          reservado={row.totalReservado}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                        {v.fracionado ? (
                          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                            Frac.
                          </span>
                        ) : null}
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
                        <StatusReservaBadge reservado={v.reservado} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tankas — silos unificados (Transbordo + Industrialização) */}
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
                tanka={tank.tanka || tank.tankaCodigo}
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
