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
  hydrateEstoqueFiscal,
  isUnidadeVolumeEntrada,
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
  ORIGEM_INDUSTRIALIZACAO,
  ORIGEM_TRANSBORDO,
  buildVasilhameReservaChave,
  isVasilhameReservado,
  sumReservadoVasilhamesConteudo,
} from "@painel/lib/vasilhameReservas";
import { containerClientMatches } from "@transbordo/lib/saidaOrigem";
import { getDominantLote, repairVasilhameComposicao, unifyDuplicateVasilhames, normalizeVasilhameLote } from "@transbordo/lib/vasilhameComposicao";
import { relinkSaidasVasilhameIds } from "@transbordo/lib/vasilhameSaidaLink";
import {
  formatMass,
  formatNum,
  formatVolume,
  roundVolume,
  parseNumero,
  parseDensidade,
} from "@transbordo/lib/format";
import { generateEstoqueEnvioPDF } from "@transbordo/lib/pdfEstoque";
import {
  agregadoCoversPhysicalSlot,
  collectEstoqueEnvioFontes,
  estoqueEnvioGrupoKey,
} from "@transbordo/lib/estoqueEnvioProdutos";
import {
  getLatestRecipeForProduct,
  normalizeProductMatchKey,
} from "@industrializacao/lib/recipeRevisions";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";
import {
  collectTankIdentityNames,
  mapIndContainersForEstoqueEnvio,
  resolveQuantidadeFisicaVasilhame,
} from "@transbordo/lib/estoqueEnvioVasilhames";

const PRODUCT_COLORS = [
  "#90EE90", "#87CEEB", "#DDA0DD", "#F0E68C", "#FFB6C1",
  "#E6E6FA", "#98FB98", "#FABD74", "#B0E0E6", "#DEB887",
  "#BC8F8F", "#AED581", "#4FC3F7", "#FFD54F", "#FF8A65",
  "#BA68C8", "#7986CB", "#4DB6AC", "#F06292", "#81C784",
];

function matchesCliente(item, clienteFilter, clientes = []) {
  if (!clienteFilter || clienteFilter === "Todos os clientes") return true;

  const itemNome = String(item?.cliente_nome || item?.client || "").trim();
  if (itemNome && containerClientMatches(itemNome, clienteFilter)) return true;

  const itemId = item?.cliente_id != null ? String(item.cliente_id) : "";
  if (!itemId) return false;

  return (clientes || []).some((cliente) => {
    if (cliente?.id == null || String(cliente.id) !== itemId) return false;
    return containerClientMatches(cliente?.nome, clienteFilter);
  });
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

/** Quantidade do vasilhame na UOM do produto (kg → peso/composição, não capacidade em L). */
/**
 * Quantidade do vasilhame na UOM de entrada do produto.
 * Massa: prefere peso_liquido / composição em kg; só converte L×densidade
 * quando não há massa gravada (nunca trata litros como kg sem densidade).
 */
function quantidadeVasilhameNaUnidade(v, unidade, densKgPorL = 0) {
  if (isUnidadeVolumeEntrada(unidade)) {
    return Number(v.volume) || 0;
  }
  const peso = Number(v.peso_liquido) || 0;
  if (peso > 0) return peso;
  const comp = Array.isArray(v.composicao) ? v.composicao : [];
  const sumKg = comp.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0);
  if (sumKg > 0) return sumKg;
  const sumL = comp.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0);
  const volL = sumL > 0 ? sumL : Number(v.volume) || 0;
  if (volL > 0 && densKgPorL > 0) return volL * densKgPorL;
  return 0;
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
  const [entradas, setEntradas] = useState([]);
  const [indTanks, setIndTanks] = useState([]);
  const [indContainers, setIndContainers] = useState([]);
  const [indProductions, setIndProductions] = useState([]);
  const [indRecipes, setIndRecipes] = useState([]);
  const [indTransfers, setIndTransfers] = useState([]);
  const [indStock, setIndStock] = useState([]);
  const [indStockReady, setIndStockReady] = useState(false);
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
        const [ests, vascs, isot, trans, cliens, saics, reservasList, ents] =
          await Promise.all([
            entities.estoque.list(),
            entities.vasilhames.list(),
            listTankas(),
            entities.transbordos.list(),
            entities.clientes.list(),
            entities.saidas.list(),
            entities.materialReservas.list().catch(() => []),
            entities.entradas.list(),
          ]);

        // Corrige volumes inflados (duplicata de OP / unificação) pelo histórico real
        let vasilhamesOk = Array.isArray(vascs) ? vascs : [];
        try {
          const { kept, deletedIds, replacements } = await unifyDuplicateVasilhames(
            vasilhamesOk,
            entities
          );
          if (replacements?.length) {
            await relinkSaidasVasilhameIds(replacements);
          }
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
        setEntradas(Array.isArray(ents) ? ents : []);

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

          const [containersInd, productionsInd, recipesInd, transfersInd] =
            await Promise.all([
              loadIndList(() =>
                base44.entities.Container.list("-created_date", 2000)
              ),
              loadIndList(() =>
                base44.entities.Production.list("-created_date", 2000)
              ),
              loadIndList(() =>
                base44.entities.Recipe.list("-updated_date", 2000)
              ),
              loadIndList(() =>
                base44.entities.Transfer.list("-created_date", 2000)
              ),
            ]);

          // Saldo de MP vem de current_stock. Falha aqui não pode zerar a lista
          // e esconder o espelho: sem a carga, o consolidado segue o transbordo.
          let stockInd = [];
          let stockReady = false;
          try {
            const pageSize = 1000;
            const seen = new Set();
            for (let offset = 0; offset < 20000; offset += pageSize) {
              const rows = await base44.entities.RawMaterialStock.list(
                "-created_date",
                pageSize,
                { offset }
              );
              const batch = Array.isArray(rows) ? rows : [];
              let added = 0;
              for (const row of batch) {
                const id = row?.id != null ? String(row.id) : "";
                if (id && seen.has(id)) continue;
                if (id) seen.add(id);
                stockInd.push(row);
                added += 1;
              }
              if (batch.length < pageSize || added === 0) break;
            }
            stockReady = true;
          } catch (stockErr) {
            console.warn("[EstoqueEnvio] matéria-prima:", stockErr);
            stockInd = [];
            stockReady = false;
          }

          // Cadastro de tankas vem do mestre (listTankas); não carregar ind_cadastro_tanka
          setIndTanks([]);
          setIndContainers(containersInd);
          setIndProductions(productionsInd);
          setIndRecipes(recipesInd);
          setIndTransfers(transfersInd);
          setIndStock(stockInd);
          setIndStockReady(stockReady);
        } catch (indErr) {
          console.warn("[EstoqueEnvio] Industrialização:", indErr);
          setIndTanks([]);
          setIndContainers([]);
          setIndProductions([]);
          setIndRecipes([]);
          setIndTransfers([]);
          setIndStock([]);
          setIndStockReady(false);
        }
      } catch {
        setEstoque([]);
        setVasilhames([]);
        setIsotanques([]);
        setTransbordos([]);
        setClientes([]);
        setReservas([]);
        setEntradas([]);
        setIndTanks([]);
        setIndContainers([]);
        setIndProductions([]);
        setIndRecipes([]);
        setIndTransfers([]);
        setIndStock([]);
        setIndStockReady(false);
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
    const fontes = collectEstoqueEnvioFontes({
      estoque,
      entradas,
      indStock,
      clientes,
      indStockReady,
    });

    for (const e of fontes) {
      if (!matchesCliente(e, clienteFilter, clientes)) continue;

      const saldo = Number(e.saldo) || 0;
      if (saldo <= 0) continue;

      const codigo = e.codigo || "—";
      const produto = e.produto || "—";
      const unidade = e.unidade || "kg";
      const key = estoqueEnvioGrupoKey({
        codigo,
        produto,
        cliente_id: e.cliente_id,
        cliente_nome: e.cliente_nome,
      });

      if (q) {
        const hay = `${codigo} ${produto} ${e.cliente_nome || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const prev = map.get(key);
      if (prev) {
        prev.saldo += saldo;
        if (e.embalado) prev.saldoEmbalado = (prev.saldoEmbalado || 0) + saldo;
        if (!prev.clienteId && e.cliente_id) prev.clienteId = e.cliente_id;
        // Mantém kg quando o grupo misturar UOM (após filtro de espelhos, raro)
        if (
          !isUnidadeVolumeEntrada(prev.unidade) &&
          isUnidadeVolumeEntrada(unidade)
        ) {
          /* prev já em massa */
        } else if (
          isUnidadeVolumeEntrada(prev.unidade) &&
          !isUnidadeVolumeEntrada(unidade)
        ) {
          prev.unidade = unidade;
        }
      } else {
        map.set(key, {
          id: key,
          codigo,
          produto,
          unidade,
          saldo,
          saldoEmbalado: e.embalado ? saldo : 0,
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
        // Saldos preservam até 3 casas (ex.: BACTIREP 50 QT com saldo fracionado).
        const saldoAtual = roundVolume(row.saldo || 0);
        const saldoFinal = Math.max(0, roundVolume(saldoAtual - saldoReservado));
        return {
          ...row,
          saldo: saldoAtual,
          saldoReservado,
          saldoFinal,
          saldoEmbalado: roundVolume(row.saldoEmbalado || 0),
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
  }, [
    estoque,
    entradas,
    indStock,
    indStockReady,
    clienteFilter,
    clientes,
    q,
    reservas,
    vasilhames,
  ]);

  const indVasilhames = useMemo(
    () =>
      mapIndContainersForEstoqueEnvio({
        containers: indContainers,
        productions: indProductions,
        recipes: indRecipes,
        transfers: indTransfers,
        tankNames: collectTankIdentityNames({ tankas: isotanques }),
      }),
    [indContainers, indProductions, indRecipes, indTransfers, isotanques]
  );

  const vasilhamesConsolidados = useMemo(
    () => [...(vasilhames || []), ...indVasilhames],
    [vasilhames, indVasilhames]
  );

  const filteredVasilhames = useMemo(() => {
    return vasilhamesConsolidados
      .filter((v) => {
        const fromInd = v.origem === ORIGEM_INDUSTRIALIZACAO;
        // Tankagem do Transbordo fica no silo. A da Industrialização só entra
        // aqui quando não é o enchimento de uma tanka já cadastrada.
        if (!fromInd && (v.tipo || "") === "Tankagem") return false;
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
        const origem =
          v.origem === ORIGEM_INDUSTRIALIZACAO
            ? ORIGEM_INDUSTRIALIZACAO
            : ORIGEM_TRANSBORDO;
        const chave = buildVasilhameReservaChave(origem, v.id);
        const reservado = isVasilhameReservado(reservas, chave);
        return {
          ...v,
          origem,
          reservaChave: chave,
          reservado,
          statusReserva: reservado ? "Reservado" : "Livre",
        };
      });
  }, [vasilhamesConsolidados, clienteFilter, clientes, q, reservas]);

  /** Resumo por produto × capacidade (e fracionados) sobre o conjunto filtrado. */
  const vasilhamesResumoPorProduto = useMemo(() => {
    // Estatísticas por placa (capacidade cadastrada + maior volume histórico)
    const placaStats = new Map();
    for (const v of vasilhamesConsolidados || []) {
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
  }, [filteredVasilhames, vasilhamesConsolidados]);

  const unifiedTankas = useMemo(
    () =>
      mergeTankasUnificadas({
        tankas: isotanques,
        transbordos,
        indContainers,
        indStock,
      }),
    [isotanques, transbordos, indContainers, indStock]
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

  /**
   * Enriquece produtosAgregados com o saldo em vasilhames (Tanque) e tankas (TANKA).
   *
   * Tankas guardam volume em Litros. Para UOM de massa (kg…): L × densidade = kg.
   * Densidade: tanka → estoque → indStock (MP). Sem densidade válida, não converte
   * litros como se fossem kg (evita Tanka 43.241 L aparecer como 43.241 kg).
   *
   * Embalado: só o que entrou como embalado no pátio (saldoEmbalado das fontes).
   * Diferença entre saldo atual e (tanque+tanka) NÃO vai para Embalado.
   */
  const produtosComBreakdown = useMemo(() => {
    const densidadeByCode = new Map();
    const densidadeByNome = new Map();

    const rememberDens = (cod, nome, raw) => {
      const den = parseDensidade(raw);
      if (!(Number.isFinite(den) && den > 0)) return;
      if (cod && !densidadeByCode.has(cod)) densidadeByCode.set(cod, den);
      if (nome && !densidadeByNome.has(nome)) densidadeByNome.set(nome, den);
    };

    for (const e of estoque) {
      rememberDens(
        normProdutoKey(e.produto_codigo || ""),
        normProdutoKey(e.produto_nome || ""),
        e.densidade
      );
    }
    for (const mp of indStock || []) {
      rememberDens(
        normProdutoKey(mp.mp_code || ""),
        normProdutoKey(mp.mp_name || ""),
        mp.density
      );
    }
    for (const recipe of indRecipes || []) {
      rememberDens(
        normProdutoKey(recipe.code || ""),
        normProdutoKey(recipe.product_name || ""),
        recipe.density
      );
    }

    /** Densidade do produto (kg/L). 0 = desconhecida (não inventar 1,0). */
    function getDensidade(codigoKey, nomeKey) {
      if (codigoKey) {
        const d = densidadeByCode.get(codigoKey);
        if (d > 0) return d;
      }
      if (nomeKey) {
        const d = densidadeByNome.get(nomeKey);
        if (d > 0) return d;
      }
      const matchKey = normalizeProductMatchKey(nomeKey);
      if (matchKey) {
        for (const [nome, dens] of densidadeByNome) {
          if (normalizeProductMatchKey(nome) === matchKey && dens > 0) {
            return dens;
          }
        }
      }
      return 0;
    }

    const physicalUnidadeByKey = new Map();

    const rememberPhysicalUnidade = (prodKey, clienteKey, unidade) => {
      if (!prodKey || !clienteKey || !unidade) return;
      const k = `${prodKey}||${clienteKey}`;
      const prev = physicalUnidadeByKey.get(k);
      if (!prev) {
        physicalUnidadeByKey.set(k, unidade);
        return;
      }
      if (prev !== "L") return;
      if (unidade !== "L") physicalUnidadeByKey.set(k, unidade);
    };

    const lookupPhysicalMap = (map, codigoKey, produtoNome, clienteKey) => {
      const prodKey = normalizeProductMatchKey(produtoNome || "");
      if (codigoKey) {
        const byCode = map.get(`${codigoKey}||${clienteKey}`);
        if (byCode > 0) return byCode;
      }
      if (prodKey) {
        const direct = map.get(`${prodKey}||${clienteKey}`);
        if (direct > 0) return direct;
        for (const [k, val] of map) {
          if (!k.endsWith(`||${clienteKey}`) || !(val > 0)) continue;
          const pk = k.slice(0, -(`||${clienteKey}`).length);
          if (pk === prodKey || pk === codigoKey) return val;
        }
      }
      return 0;
    };

    /**
     * Converte litros para a UOM de entrada.
     * Massa sem densidade → 0 (não tratar L como kg).
     */
    function litrosParaUnidadeEntrada(litros, unidade, densKgPorL) {
      if (!(litros > 0)) return 0;
      if (isUnidadeVolumeEntrada(unidade)) return litros;
      if (!(densKgPorL > 0)) return 0;
      return litros * densKgPorL;
    }

    const resolveUnidadeProduto = (codigoKeyV, nomeKeyV, clienteKeyV, baseRows) => {
      const hit = (baseRows || produtosAgregados).find((p) => {
        if (normProdutoKey(p.cliente_nome || "") !== clienteKeyV) return false;
        if (
          codigoKeyV &&
          normProdutoKey(p.codigo === "—" ? "" : p.codigo) === codigoKeyV
        ) {
          return true;
        }
        return nomeKeyV && normProdutoKey(p.produto) === nomeKeyV;
      });
      return hit?.unidade || "kg";
    };

    const rememberOrphanSlot = (slot, orphanByKey) => {
      if (agregadoCoversPhysicalSlot(produtosAgregados, slot)) return;
      const codigo = String(slot.codigo || "").trim();
      const produto = String(slot.produto || "").trim();
      const clienteNome = String(slot.cliente_nome || "").trim();
      if (!produto || !clienteNome) return;

      const cliente =
        (clientes || []).find(
          (c) =>
            String(c?.nome || "")
              .trim()
              .toLowerCase() === clienteNome.toLowerCase()
        ) || null;

      const key = estoqueEnvioGrupoKey({
        codigo: codigo || "—",
        produto,
        cliente_id: cliente?.id || null,
        cliente_nome: clienteNome,
      });

      const prev = orphanByKey.get(key);
      if (!prev || (!prev.codigo && codigo)) {
        orphanByKey.set(key, {
          codigo,
          produto,
          cliente_nome: clienteNome,
          cliente_id: cliente?.id || null,
        });
      }
    };

    // ── Acumuladores já na UOM de entrada por produto+cliente ──────────────
    const orphanByKey = new Map();
    const vasilhameByCode = new Map();
    const vasilhameByNome = new Map();
    for (const v of filteredVasilhames) {
      const codigoKey = normProdutoKey(v.produto_codigo || "");
      const prodKey = normalizeProductMatchKey(v.produto_nome || "");
      const clienteKey = normProdutoKey(v.cliente_nome || "");
      const unidadeV = resolveUnidadeProduto(codigoKey, normProdutoKey(v.produto_nome || ""), clienteKey);
      const dens = getDensidade(codigoKey, normProdutoKey(v.produto_nome || "")) || parseDensidade(v.densidade);
      const { quantidade: vol, unidade: unidadeFisica } = resolveQuantidadeFisicaVasilhame(
        v,
        unidadeV,
        dens
      );
      if (vol <= 0) continue;
      rememberOrphanSlot(
        {
          codigo: v.produto_codigo,
          produto: v.produto_nome,
          cliente_nome: v.cliente_nome,
        },
        orphanByKey
      );
      rememberPhysicalUnidade(prodKey, clienteKey, unidadeFisica);
      if (codigoKey) {
        const k = `${codigoKey}||${clienteKey}`;
        vasilhameByCode.set(k, (vasilhameByCode.get(k) || 0) + vol);
      }
      if (prodKey) {
        const k = `${prodKey}||${clienteKey}`;
        vasilhameByNome.set(k, (vasilhameByNome.get(k) || 0) + vol);
      }
    }

    // Converte cada tanka (L → UOM) com a densidade da própria tanka quando houver.
    const tankaByNome = new Map();
    for (const t of filteredTankas) {
      const volL = Number(t.volumeAtual) || 0;
      if (volL <= 0) continue;
      const nomeKey = normProdutoKey(t.produto || "");
      const clienteKey = normProdutoKey(t.cliente_nome || "");
      if (!nomeKey) continue;
      const recipe = getLatestRecipeForProduct(indRecipes, t.produto);
      rememberOrphanSlot(
        {
          codigo: recipe?.code || "",
          produto: t.produto,
          cliente_nome: t.cliente_nome,
        },
        orphanByKey
      );
      const unidadeT = resolveUnidadeProduto("", nomeKey, clienteKey);
      const densTanka = parseDensidade(t.densidade);
      const dens =
        densTanka > 0 ? densTanka : getDensidade("", nomeKey);
      let qtd = litrosParaUnidadeEntrada(volL, unidadeT, dens);
      let unidadeFisica = unidadeT;
      if (qtd <= 0 && volL > 0) {
        if (isUnidadeVolumeEntrada(unidadeT)) {
          qtd = volL;
        } else if (dens > 0) {
          qtd = volL * dens;
        } else {
          qtd = volL;
          unidadeFisica = "L";
        }
      }
      if (qtd <= 0) continue;
      const prodKey = normalizeProductMatchKey(t.produto || "");
      rememberPhysicalUnidade(prodKey, clienteKey, unidadeFisica);
      const k = `${prodKey || nomeKey}||${clienteKey}`;
      tankaByNome.set(k, (tankaByNome.get(k) || 0) + qtd);
    }

    const orphanAgregados = [...orphanByKey.values()]
      .map((slot) => {
        const codigo = String(slot.codigo || "").trim() || "—";
        const produto = String(slot.produto || "").trim() || "—";
        const clienteNome = slot.cliente_nome || "";
        const clienteId = slot.cliente_id || null;
        const key = estoqueEnvioGrupoKey({
          codigo,
          produto,
          cliente_id: clienteId,
          cliente_nome: clienteNome,
        });
        const codigoKey = normProdutoKey(codigo === "—" ? "" : codigo);
        const nomeKey = normProdutoKey(produto);
        const prodKey = normalizeProductMatchKey(produto);
        const clienteKey = normProdutoKey(clienteNome);
        const unidadeFisica = physicalUnidadeByKey.get(`${prodKey}||${clienteKey}`);
        const unidade =
          unidadeFisica ||
          resolveUnidadeProduto(codigoKey, nomeKey, clienteKey);

        const reservadoEmbalado = sumReservadoForProdutoCliente(reservas, {
          clienteId,
          clienteNome,
          produtoCodigo: codigo,
          produtoNome: produto,
          unidade,
        });
        const reservadoVasilhame = sumReservadoVasilhamesConteudo(
          vasilhames,
          reservas,
          {
            clienteId,
            clienteNome,
            produtoCodigo: codigo,
            produtoNome: produto,
            unidade,
          }
        );
        const saldoReservado = Math.round(
          reservadoEmbalado + reservadoVasilhame
        );

        return {
          id: key,
          codigo,
          produto,
          unidade,
          saldo: 0,
          saldoEmbalado: 0,
          cliente_nome: clienteNome,
          clienteId,
          saldoReservado,
          saldoFinal: 0,
          orphanPhysical: true,
        };
      })
      .filter((row) => {
        if (q) {
          const hay = `${row.codigo} ${row.produto} ${row.cliente_nome || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const allAgregados = [...produtosAgregados, ...orphanAgregados];

    const rows = allAgregados.map((p) => {
      const clienteKey = normProdutoKey(p.cliente_nome || "");
      const codigoKey = normProdutoKey(p.codigo === "—" ? "" : p.codigo);
      const nomeKey = normProdutoKey(p.produto || "");

      const prodKey = normalizeProductMatchKey(p.produto || "");
      const vasilhameQtd =
        lookupPhysicalMap(vasilhameByCode, codigoKey, p.produto, clienteKey) ||
        lookupPhysicalMap(vasilhameByNome, "", p.produto, clienteKey);
      const tankaQtd = lookupPhysicalMap(tankaByNome, "", p.produto, clienteKey);
      const unidadeFisica = physicalUnidadeByKey.get(`${prodKey}||${clienteKey}`);
      const unidadeRow = unidadeFisica || p.unidade;

      let saldoTanque = roundVolume(vasilhameQtd);
      let saldoTanka = roundVolume(tankaQtd);

      const isOrphan = p.orphanPhysical === true;
      let saldoAtual = isOrphan
        ? roundVolume(saldoTanque + saldoTanka)
        : p.saldo;

      // Tanque + tanka não podem exceder o saldo de livro (divergência de dados).
      const totalFisico = saldoTanque + saldoTanka;
      if (
        !isOrphan &&
        totalFisico > saldoAtual + 0.001 &&
        totalFisico > 0
      ) {
        const scale = saldoAtual / totalFisico;
        saldoTanque = roundVolume(saldoTanque * scale);
        saldoTanka = roundVolume(saldoTanka * scale);
      }

      // Embalado = porção do saldo de entrada embalada que NÃO foi transferida
      // para tanque/tanka. Se o produto inteiro migrou para vasilhame, zera.
      const saldoEmbaladoBruto = roundVolume(p.saldoEmbalado || 0);
      const saldoEmbalado = roundVolume(
        Math.max(0, saldoEmbaladoBruto - saldoTanque - saldoTanka)
      );

      const saldoReservado = p.saldoReservado || 0;
      const saldoFinal = isOrphan
        ? Math.max(0, roundVolume(saldoAtual - saldoReservado))
        : p.saldoFinal;

      return {
        ...p,
        unidade: unidadeRow,
        saldo: saldoAtual,
        saldoTanque,
        saldoTanka,
        saldoEmbalado,
        saldoFinal,
      };
    });

    return rows
      .filter((p) => (Number(p.saldo) || 0) > 0)
      .sort((a, b) => {
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
  }, [
    produtosAgregados,
    filteredVasilhames,
    filteredTankas,
    estoque,
    indStock,
    indRecipes,
    clientes,
    reservas,
    vasilhames,
    q,
  ]);

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
      produtosComBreakdown.length > 0 ||
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
        const fillColor = tank.produto ? productColorMap[tank.produto] || null : null;
        if (tank.hasTransbordo && tank.isotanque && tank.volumeSource === "transbordo") {
          const lotes = computeTankaLotesDisponiveis({
            isotanqueId: tank.isotanque.id,
            tankaCodigo: tank.tankaCodigo,
            transbordos,
          });
          return { ...tank, lotes, fillColor };
        }
        return {
          ...tank,
          fillColor,
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
        products: produtosComBreakdown,
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
    for (const t of isotanques || []) {
      const nome = String(t?.cliente_nome || t?.client || "").trim();
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (!map.has(key)) map.set(key, { id: `tank-client:${key}`, nome });
    }
    for (const source of [...(indContainers || []), ...(indStock || [])]) {
      const nome = String(source?.client || "").trim();
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
  }, [clientes, isotanques, indContainers, indStock, unifiedTankas]);

  const canExportPdf =
    produtosComBreakdown.length > 0 ||
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
            {produtosComBreakdown.length}
          </span>
        </div>
        {produtosComBreakdown.length === 0 ? (
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
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Embalado</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Tanque</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">TANKA</th>
                  <th className="px-4 py-3 font-medium text-right">Saldo Atual</th>
                  <th className="px-4 py-3 font-medium text-right">Reservado</th>
                  <th className="px-4 py-3 font-medium text-right">Saldo Final</th>
                  <th className="px-4 py-3 font-medium text-center">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let groupIndex = 0;
                  return produtosComBreakdown.map((p, i) => {
                    const prevCodigo =
                      i > 0 ? produtosComBreakdown[i - 1].codigo : null;
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
                        {/* Embalado: saldo dos itens recebidos como embalado */}
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone={p.saldoEmbalado > 0 ? "blue" : "muted"}>
                            {p.saldoEmbalado > 0
                              ? formatSaldo(p.saldoEmbalado, p.unidade)
                              : "—"}
                          </SaldoBadge>
                        </td>
                        {/* Tanque: quantidade em vasilhames no pátio, na unidade de entrada do produto */}
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone={p.saldoTanque > 0 ? "blue" : "muted"}>
                            {p.saldoTanque > 0
                              ? formatSaldo(p.saldoTanque, p.unidade)
                              : "—"}
                          </SaldoBadge>
                        </td>
                        {/* TANKA: quantidade armazenada nas tankas, na unidade de entrada do produto */}
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone={p.saldoTanka > 0 ? "blue" : "muted"}>
                            {p.saldoTanka > 0
                              ? formatSaldo(p.saldoTanka, p.unidade)
                              : "—"}
                          </SaldoBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <SaldoBadge tone="blue">
                            {formatNum(p.saldo, 3, { empty: "-" })}
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
                            {formatNum(p.saldoFinal, 3, { empty: "-" })}
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
                      key={v.reservaChave || v.id}
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
                observacao={tank.observacao}
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
