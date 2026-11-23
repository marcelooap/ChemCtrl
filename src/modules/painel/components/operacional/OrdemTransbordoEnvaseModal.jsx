import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DestinoCard from "@transbordo/components/transbordo/DestinoCard";
import {
  alignDestinosMassaToQuantidade,
  formatMass,
  formatNum,
  formatVolume,
  litrosFromMassaKg,
  parseDensidade,
  qtdEmbalagensFromVolume,
  roundMass,
  roundVolume,
} from "@transbordo/lib/format";
import { loteToLitros, loteToKg } from "@transbordo/lib/conversao";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";
import { normalizeUnidadeEntrada } from "@transbordo/lib/estoqueSaldo";
import { computeTankaSaldo } from "@transbordo/lib/tankaVolume";
import { matchesProdutoOperacional } from "@transbordo/lib/produtoMatch";
import {
  listOperadoresAtivosNomes,
  mergeOperadoresDropdown,
} from "@transbordo/lib/operadoresCadastro";
import { calculateFIFOAllocation } from "@transbordo/lib/fifo";
import {
  getDominantLote,
  isOrigemEmbaladoMassa,
} from "@transbordo/lib/vasilhameComposicao";

const INPUT_EDITABLE = "bg-white";
/** Espelha validacaoTransbordo — trocado pelo id real do estoque na efetivação. */
const PENDING_GRANEL_PREFIX = "__PENDING_GRANEL__";

function createClientUid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `uid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeUnit(unidade) {
  const u = String(unidade || "")
    .trim()
    .toLowerCase();
  if (["l", "lt", "litro", "litros"].includes(u)) return "L";
  if (["kg", "kgs"].includes(u)) return "kg";
  if (["lb", "lbs", "libra", "libras"].includes(u)) return "lb";
  if (["gal", "gallon", "gallons", "galão", "galoes", "galões"].includes(u)) {
    return "gal";
  }
  return unidade || "";
}

/** litros do formulário → kg/lb persistido no estoque embalado (paridade TransbordoModal). */
function embaladoLitrosToMassa(qtyL, unidade, dens) {
  const vol = Number(qtyL) || 0;
  if (!(vol > 0) || !(dens > 0)) return 0;
  const kg = roundMass(vol * dens);
  const um = normalizeUnidadeEntrada(unidade);
  return um === "lb" ? roundMass(kg / 0.453592) : kg;
}

/** kg/lb persistido → litros do formulário (paridade TransbordoModal). */
function embaladoMassaToLitros(qty, unidade, dens) {
  const raw = Number(qty) || 0;
  if (!(raw > 0) || !(dens > 0)) return 0;
  const um = normalizeUnidadeEntrada(unidade);
  const kg = um === "lb" ? roundMass(raw * 0.453592) : roundMass(raw);
  return roundVolume(litrosFromMassaKg(kg, dens));
}

/**
 * Payload salvo em kg/lb entra no formulário em L.
 * Evita exibir 6.125 kg como 6.125 L e regravar massa × densidade de novo.
 */
function hydrateEmbaladoFormVolumes(origens = [], destinos = [], dens) {
  if (!(dens > 0)) {
    return { origens, destinos };
  }

  const nextOrigens = (origens || []).map((o) => {
    if (!isOrigemEmbaladoMassa(o)) return o;
    const um = o.unidade_medida || "kg";
    const toL = (q) => embaladoMassaToLitros(q, um, dens);
    const volL = toL(o.volume_retirado);
    const massaKg =
      Number(o.massa_retirada) > 0
        ? roundMass(o.massa_retirada)
        : normalizeUnidadeEntrada(um) === "lb"
          ? roundMass((Number(o.volume_retirado) || 0) * 0.453592)
          : roundMass(o.volume_retirado || 0);
    return {
      ...o,
      volume_retirado: volL,
      massa_retirada: massaKg > 0 ? massaKg : roundMass(volL * dens),
      saldo_disponivel: toL(o.saldo_disponivel),
      saldo_restante: toL(o.saldo_restante),
      lotes_retirados: (o.lotes_retirados || []).map((l) => ({
        ...l,
        volume_retirado: toL(l.volume_retirado),
        saldo_disponivel: toL(l.saldo_disponivel),
      })),
      lotes_disponiveis: (o.lotes_disponiveis || []).map((l) => ({
        ...l,
        quantidade_l: toL(l.quantidade_l),
      })),
    };
  });

  const origemByUid = new Map(
    nextOrigens.filter((o) => o._uid).map((o) => [o._uid, o])
  );
  const nextDestinos = (destinos || []).map((d) => {
    const origem =
      origemByUid.get(d.origem_uid) ||
      nextOrigens.find(isOrigemEmbaladoMassa) ||
      null;
    if (!origem || !isOrigemEmbaladoMassa(origem)) return d;
    const um = origem.unidade_medida || "kg";
    const toL = (q) => embaladoMassaToLitros(q, um, dens);
    const volume_total = toL(d.volume_total || d.volume || 0);
    const volume_por_embalagem = toL(d.volume_por_embalagem || 0);
    const peso =
      d.peso_liquido != null && d.peso_liquido !== ""
        ? roundMass(d.peso_liquido)
        : roundMass(volume_total * dens);
    return {
      ...d,
      volume: volume_total,
      volume_total,
      volume_por_embalagem,
      peso_liquido: peso,
      peso_bruto: roundMass((d.tara || 0) + peso),
      quantidade_embalagens: isDestinoEstoqueEmbalado(d.tipo_embalagem)
        ? qtdEmbalagensFromVolume(volume_total, volume_por_embalagem) ||
          Number(d.quantidade_embalagens) ||
          0
        : d.quantidade_embalagens,
    };
  });

  return { origens: nextOrigens, destinos: nextDestinos };
}

function isDestinoPreenchido(destino) {
  const tipo = destino.tipo_embalagem || "";
  if (!tipo) return false;
  if (isDestinoEstoqueEmbalado(tipo)) {
    return (
      roundVolume(destino.volume_total || destino.volume || 0) > 0 &&
      roundVolume(destino.volume_por_embalagem || 0) > 0 &&
      Number(destino.quantidade_embalagens) > 0
    );
  }
  if (tipo === "Tankagem") {
    return (
      Boolean(destino.tanka_id || destino.tanka_codigo) &&
      roundVolume(destino.volume_total || destino.volume || 0) > 0
    );
  }
  return roundVolume(destino.volume_total || destino.volume || 0) > 0;
}

function emptyDestino(origemUid) {
  return {
    tipo_embalagem: "",
    volume_total: 0,
    volume: 0,
    origem_uid: origemUid,
  };
}

/**
 * Modal operacional simplificado: produto / lote / quantidade + envases + conferência.
 * Usado na Ordem de Transbordo para todas as origens (granel, tanka, vasilhame, embalado).
 */
export default function OrdemTransbordoEnvaseModal({
  open,
  onClose,
  onSave,
  onQuantidadeChange,
  onLoteChange,
  onTankaOrigemQuantidadeChange,
  onOrigemLoteChange,
  /** (index) => opções { id, lote, display_label, ... } do estoque. */
  getOrigemLoteOptions = null,
  onAddOrigem,
  onRemoveOrigem,
  /** Validação: permite editar/adicionar/remover lotes de origem. */
  lotesEditable = false,
  productLabel = "",
  produtoId = "",
  produtoNome = "",
  produtoCodigo = "",
  /** Observação da operação (Nova ordem) — gravada em t_transbordos.observacoes. */
  observacoes = "",
  lote = "",
  quantidade = 0,
  unidade = "kg",
  densidade = 0,
  dataOp = "",
  clienteId = "",
  clienteNome = "",
  /** tipo_origem persistido: entrada | tanka | vasilhame | embalado */
  origemTipoOperacional = "entrada",
  /** Origens tanka na ordem de registro (FIFO no envase). */
  tankaOrigens = [],
  /** Origens vasilhame (tanques No Pátio) na ordem de registro (FIFO no envase). */
  vasilhameOrigens = [],
  /**
   * Origem embalada selecionada na Nova ordem (compat. 1 lote).
   * UI opera em L; persistência usa unidade_medida do estoque (kg/lb).
   */
  embaladoOrigem = null,
  /** Múltiplos lotes embalados na ordem de registro (FIFO no envase). */
  embaladoOrigens = [],
  quantidadeEditable = true,
  granelPayload = null,
  /** Payload já salvo (edição na Validação) — hidrata destinos/operadores. */
  initialPayload = null,
  /** Conteúdo extra no header (ex.: botão editar recebimento). */
  headerActions = null,
  isotanques = [],
  vasilhames = [],
  transbordos = [],
  fixedOperador = null,
  externalError = "",
  /** Rótulo do botão primário (ex.: "Salvar" na edição pela Validação). */
  submitLabel = null,
}) {
  const { t } = useTranslation();
  const [destinos, setDestinos] = useState([]);
  const [origemUid, setOrigemUid] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operadoresAtivos, setOperadoresAtivos] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [operadoresOpen, setOperadoresOpen] = useState(false);
  const [densidadeEdit, setDensidadeEdit] = useState(densidade);
  const operadoresRef = useRef(null);

  const dens = parseDensidade(densidadeEdit);
  const unitNorm = normalizeUnit(unidade);
  const qtyRaw = Number(quantidade) || 0;
  const tipoOrigem = origemTipoOperacional || "entrada";

  // Pesagem fora da margem: massa operacional = peso líquido informado (exato),
  // sem reconstituir via L × densidade (evita 19.000 → 23.990 L → 19.000,08 kg).
  const massaPesagemForaMargemKg =
    granelPayload?.granel_margem === "fora"
      ? Number(granelPayload.granel_peso_liquido) || 0
      : 0;

  const qtyConverted = useMemo(() => {
    if (!(dens > 0) || !(qtyRaw > 0)) return null;
    if (unitNorm === "kg") {
      return {
        value: litrosFromMassaKg(qtyRaw, dens),
        unit: "L",
        labelKey: "painel.operacional.ordemTransbordo.envaseModal.convertedToL",
      };
    }
    if (unitNorm === "L") {
      return {
        value:
          massaPesagemForaMargemKg > 0
            ? roundMass(massaPesagemForaMargemKg)
            : roundMass(qtyRaw * dens),
        unit: "kg",
        labelKey: "painel.operacional.ordemTransbordo.envaseModal.convertedToKg",
      };
    }
    if (unitNorm === "lb") {
      const kg = loteToKg({
        quantidade: qtyRaw,
        unidade_medida: "lb",
        densidade: dens,
      });
      return {
        value: litrosFromMassaKg(kg, dens),
        unit: "L",
        labelKey: "painel.operacional.ordemTransbordo.envaseModal.convertedToL",
      };
    }
    if (unitNorm === "gal") {
      const litros = loteToLitros({
        quantidade: qtyRaw,
        unidade_medida: "gal",
        densidade: dens,
      });
      return {
        value:
          massaPesagemForaMargemKg > 0
            ? roundMass(massaPesagemForaMargemKg)
            : roundMass(litros * dens),
        unit: "kg",
        labelKey: "painel.operacional.ordemTransbordo.envaseModal.convertedToKg",
      };
    }
    return null;
  }, [dens, qtyRaw, unitNorm, massaPesagemForaMargemKg]);

  /** Origens com tanka+lote (exibição/edição), inclusive qty zerada. */
  const tankaOrigensExibidas = useMemo(
    () =>
      (tankaOrigens || [])
        .map((o, index) => ({ ...o, _index: index }))
        .filter(
          (o) =>
            lotesEditable ||
            (String(o?.tankaId || "").trim() && String(o?.lote || "").trim())
        ),
    [tankaOrigens, lotesEditable]
  );

  const tankaOrigensValidas = useMemo(
    () =>
      tankaOrigensExibidas.filter((o) => Number(o?.quantidade) > 0),
    [tankaOrigensExibidas]
  );

  /** Origens vasilhame (tanque No Pátio) — exibição/edição. */
  const vasilhameOrigensExibidas = useMemo(
    () =>
      (vasilhameOrigens || [])
        .map((o, index) => ({ ...o, _index: index }))
        .filter((o) => lotesEditable || String(o?.vasilhameId || "").trim()),
    [vasilhameOrigens, lotesEditable]
  );

  const vasilhameOrigensValidas = useMemo(
    () =>
      vasilhameOrigensExibidas.filter((o) => Number(o?.quantidade) > 0),
    [vasilhameOrigensExibidas]
  );

  /** Origens embaladas (IBC/Bombona/Tambor) — ordem de registro = FIFO. */
  const embaladoOrigensExibidas = useMemo(() => {
    const fromList = (embaladoOrigens || [])
      .map((o, index) => ({ ...o, _index: index }))
      .filter((o) =>
        lotesEditable ? true : Boolean(String(o?.entrada_id || "").trim())
      );
    if (fromList.length > 0) return fromList;
    if (embaladoOrigem?.entrada_id || (lotesEditable && embaladoOrigem)) {
      return [{ ...embaladoOrigem, _index: 0 }];
    }
    return [];
  }, [embaladoOrigens, embaladoOrigem, lotesEditable]);

  const embaladoOrigensValidas = useMemo(
    () =>
      embaladoOrigensExibidas.filter((o) => Number(o?.quantidade) > 0),
    [embaladoOrigensExibidas]
  );

  const multiOrigensExibidas =
    tipoOrigem === "tanka"
      ? tankaOrigensExibidas
      : tipoOrigem === "vasilhame"
        ? vasilhameOrigensExibidas
        : tipoOrigem === "embalado"
          ? embaladoOrigensExibidas
          : [];

  /** Volume operacional (L) — total das origens multi ou quantidade do formulário. */
  const volumeRegistradoL = useMemo(() => {
    if (tipoOrigem === "tanka" && tankaOrigensExibidas.length > 0) {
      return roundVolume(
        tankaOrigensExibidas.reduce(
          (s, o) => s + (Number(o.quantidade) || 0),
          0
        )
      );
    }
    if (tipoOrigem === "vasilhame" && vasilhameOrigensExibidas.length > 0) {
      return roundVolume(
        vasilhameOrigensExibidas.reduce(
          (s, o) => s + (Number(o.quantidade) || 0),
          0
        )
      );
    }
    if (tipoOrigem === "embalado" && embaladoOrigensExibidas.length > 0) {
      return roundVolume(
        embaladoOrigensExibidas.reduce(
          (s, o) => s + (Number(o.quantidade) || 0),
          0
        )
      );
    }
    return roundVolume(
      loteToLitros({
        quantidade: qtyRaw,
        unidade_medida: unidade,
        densidade: dens,
      })
    );
  }, [
    tipoOrigem,
    tankaOrigensExibidas,
    vasilhameOrigensExibidas,
    embaladoOrigensExibidas,
    dens,
    qtyRaw,
    unidade,
  ]);

  const volumeEnvasadoL = useMemo(
    () =>
      roundVolume(
        destinos.reduce(
          (sum, d) => sum + (Number(d.volume_total || d.volume) || 0),
          0
        )
      ),
    [destinos]
  );

  const volumesMatch =
    volumeRegistradoL > 0 &&
    Math.abs(volumeRegistradoL - volumeEnvasadoL) === 0;
  const volumeExceeded =
    volumeRegistradoL > 0 && volumeEnvasadoL > volumeRegistradoL;
  const volumeRestanteL = roundVolume(
    Math.max(0, volumeRegistradoL - volumeEnvasadoL)
  );

  /** Destino tankagem: só tankas cadastrados com o produto da ordem. */
  const produtoCtxTankaDestino = useMemo(
    () => ({
      produtoId,
      produtoNome,
      produtoCodigo,
    }),
    [produtoId, produtoNome, produtoCodigo]
  );

  const filteredIsotanques = useMemo(
    () =>
      (isotanques || [])
        .filter((i) => matchesProdutoOperacional(i, produtoCtxTankaDestino))
        .map((i) => {
          const tankaCodigo = i.nome || i.tanka || i.codigo_itku || "";
          const saldo = computeTankaSaldo({
            isotanqueId: i.id,
            tankaCodigo,
            transbordos,
          });
          const cap = roundVolume(i.capacidade || 26000);
          const volumeDisponivel = Math.max(0, cap - saldo);
          return {
            ...i,
            capacidade: cap,
            saldo_atual: saldo,
            volume_disponivel: volumeDisponivel,
            display_label: `${tankaCodigo} · ${formatVolume(volumeDisponivel)} L disp.`,
          };
        }),
    [isotanques, transbordos, produtoCtxTankaDestino]
  );

  /** Soma dos volumes destinando ao mesmo tanka não pode exceder o espaço vago. */
  const tankaExcedido = useMemo(
    () =>
      destinos.some((d) => {
        if (d.tipo_embalagem !== "Tankagem" || !d.tanka_id) return false;
        const tanka =
          filteredIsotanques.find((i) => i.id === d.tanka_id) ||
          (isotanques || []).find((i) => i.id === d.tanka_id);
        if (!tanka) return false;
        const cap = roundVolume(tanka.capacidade || 26000);
        const saldo =
          tanka.saldo_atual != null
            ? roundVolume(tanka.saldo_atual)
            : computeTankaSaldo({
                isotanqueId: tanka.id,
                tankaCodigo:
                  tanka.nome || tanka.tanka || tanka.codigo_itku || "",
                transbordos,
              });
        const disp = Math.max(0, cap - saldo);
        const totalDestinoTanka = destinos
          .filter(
            (other) =>
              other.tipo_embalagem === "Tankagem" &&
              (other.tanka_id === d.tanka_id ||
                (d.tanka_codigo && other.tanka_codigo === d.tanka_codigo))
          )
          .reduce(
            (sum, other) =>
              sum + roundVolume(other.volume_total || other.volume || 0),
            0
          );
        return roundVolume(totalDestinoTanka) > disp;
      }),
    [destinos, filteredIsotanques, isotanques, transbordos]
  );

  useEffect(() => {
    if (!open) return;
    const densHydrate = parseDensidade(
      densidade ||
        initialPayload?.densidade ||
        granelPayload?.densidade ||
        ""
    );
    let savedOrigens = Array.isArray(initialPayload?.origens)
      ? initialPayload.origens
      : [];
    let savedDestinos = Array.isArray(initialPayload?.destinos)
      ? initialPayload.destinos
      : [];
    if (
      densHydrate > 0 &&
      savedOrigens.some(isOrigemEmbaladoMassa)
    ) {
      const hydrated = hydrateEmbaladoFormVolumes(
        savedOrigens,
        savedDestinos,
        densHydrate
      );
      savedOrigens = hydrated.origens;
      savedDestinos = hydrated.destinos;
    }
    const uid =
      savedOrigens[0]?._uid ||
      savedDestinos[0]?.origem_uid ||
      createClientUid();
    setOrigemUid(uid);
    if (savedDestinos.length > 0) {
      setDestinos(
        savedDestinos.map((d) => ({
          ...d,
          origem_uid: d.origem_uid || uid,
        }))
      );
      // Sempre inicia minimizado — expande só ao clicar.
      const nextCollapsed = {};
      savedDestinos.forEach((_, i) => {
        nextCollapsed[i] = true;
      });
      setCollapsed(nextCollapsed);
    } else {
      setDestinos([emptyDestino(uid)]);
      setCollapsed({ 0: true });
    }
    const ops = Array.isArray(initialPayload?.operadores)
      ? initialPayload.operadores.filter(Boolean)
      : [];
    setOperadores(ops);
    setDensidadeEdit(
      densidade ||
        initialPayload?.densidade ||
        granelPayload?.densidade ||
        ""
    );
    setError("");
    setSaving(false);
    setOperadoresOpen(false);
    // initialPayload / densidade Identity muda a cada render — hidrata só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    listOperadoresAtivosNomes({ setor: "Transbordo" })
      .then((ativos) => {
        if (!cancelled) setOperadoresAtivos(ativos || []);
      })
      .catch(() => {
        if (!cancelled) setOperadoresAtivos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!operadoresOpen) return undefined;
    const handleClickOutside = (e) => {
      if (operadoresRef.current && !operadoresRef.current.contains(e.target)) {
        setOperadoresOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [operadoresOpen]);

  const operadoresOpcoes = useMemo(
    () => mergeOperadoresDropdown(operadoresAtivos, operadores),
    [operadoresAtivos, operadores]
  );

  const toggleOperador = (nome) => {
    setOperadores((prev) =>
      prev.includes(nome) ? prev.filter((o) => o !== nome) : [...prev, nome]
    );
  };

  const allDestinosOk =
    destinos.length > 0 && destinos.every((d) => isDestinoPreenchido(d));

  const canSave =
    dens > 0 &&
    volumeRegistradoL > 0 &&
    allDestinosOk &&
    volumesMatch &&
    !volumeExceeded &&
    !tankaExcedido &&
    operadores.length > 0 &&
    !saving;

  const addDestino = () => {
    setCollapsed((prev) => {
      const next = {};
      destinos.forEach((_, i) => {
        next[i] = true;
      });
      next[destinos.length] = true;
      return next;
    });
    setDestinos((prev) => [...prev, emptyDestino(origemUid)]);
  };

  const updateDestino = (idx, data) => {
    setDestinos((prev) =>
      prev.map((d, i) =>
        i === idx
          ? { ...data, origem_uid: data.origem_uid || d.origem_uid || origemUid }
          : d
      )
    );
  };

  const removeDestino = (idx) => {
    setDestinos((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    setCollapsed((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < idx) next[i] = prev[i];
        else if (i > idx) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const buildPayload = () => {
    const loteOrigem =
      lote ||
      granelPayload?.lote ||
      granelPayload?.lotes?.[0]?.lote ||
      "";
    const densStr = String(densidadeEdit || dens || "");
    const origemLabel =
      tipoOrigem === "entrada"
        ? granelPayload?.nota_fiscal
          ? `GRANEL (NF ${granelPayload.nota_fiscal})`
          : "GRANEL"
        : String(tipoOrigem || "ORIGEM").toUpperCase();

    let origensNorm;
    if (tipoOrigem === "tanka" && tankaOrigensValidas.length > 0) {
      // Ordem de registro das origens = ordem FIFO no envase.
      origensNorm = tankaOrigensValidas.map((item) => {
        const uid = createClientUid();
        const vol = roundVolume(item.quantidade);
        const codigo = String(item.tankaCodigo || "").trim();
        return {
          _uid: uid,
          tipo_origem: "tanka",
          entrada_id: item.tankaId || null,
          entrada_codigo: `${codigo || "TANKA"} — Lote ${item.lote || "—"}`,
          lote: item.lote || "",
          unidade_medida: "L",
          volume_retirado: vol,
          massa_retirada: dens > 0 ? roundMass(vol * dens) : 0,
          saldo_restante: 0,
          saldo_disponivel: vol,
          embalado: false,
          tanka_id: item.tankaId || null,
          tanka_codigo: codigo || null,
        };
      });
    } else if (tipoOrigem === "vasilhame" && vasilhameOrigensValidas.length > 0) {
      origensNorm = vasilhameOrigensValidas.map((item) => {
        const uid = createClientUid();
        const vol = roundVolume(item.quantidade);
        const codigo = String(item.codigo || "").trim();
        // Redistribui FIFO pela qtd atual (disponíveis ou, no fallback, saldos dos retirados).
        const lotesDisp =
          (item.lotes_disponiveis || []).length > 0
            ? item.lotes_disponiveis
            : (item.lotes_retirados || []).map((l) => ({
                lote: l.lote || "",
                quantidade_l: roundVolume(
                  l.saldo_disponivel || l.volume_retirado || 0
                ),
              }));
        let lotesRet = [];
        if (lotesDisp.length > 0) {
          let remaining = vol;
          for (const l of lotesDisp) {
            if (!(remaining > 0)) break;
            const disp = roundVolume(l.quantidade_l || 0);
            if (!(disp > 0)) continue;
            const take = roundVolume(Math.min(remaining, disp));
            if (take > 0) {
              lotesRet.push({
                lote: l.lote || "",
                volume_retirado: take,
                saldo_disponivel: disp,
              });
              remaining = roundVolume(remaining - take);
            }
          }
        } else {
          lotesRet = (item.lotes_retirados || []).filter(
            (l) => roundVolume(l.volume_retirado || 0) > 0
          );
        }
        const firstLote =
          lotesRet[0]?.lote ||
          String(item.lote || "")
            .split(/\s*\/\s*/)[0]
            ?.trim() ||
          "";
        const keepLotes = lotesRet.length > 0 && lotesDisp.length > 1;
        return {
          _uid: uid,
          tipo_origem: "vasilhame",
          entrada_id: item.vasilhameId || null,
          entrada_codigo: `${codigo || "VASILHAME"} — Lote ${item.lote || firstLote || "—"}`,
          lote: firstLote || item.lote || "",
          unidade_medida: "L",
          volume_retirado: vol,
          massa_retirada: dens > 0 ? roundMass(vol * dens) : 0,
          saldo_restante: 0,
          saldo_disponivel: vol,
          embalado: false,
          ...(keepLotes
            ? {
                lotes_retirados: lotesRet.map((l) => ({
                  lote: l.lote || "",
                  volume_retirado: roundVolume(l.volume_retirado || 0),
                  saldo_disponivel: roundVolume(l.saldo_disponivel || 0),
                })),
                lotes_disponiveis: lotesDisp.map((l) => ({
                  lote: l.lote || "",
                  quantidade_l: roundVolume(l.quantidade_l || 0),
                })),
              }
            : lotesRet.length > 0
              ? {
                  lotes_retirados: lotesRet.map((l) => ({
                    lote: l.lote || "",
                    volume_retirado: roundVolume(l.volume_retirado || 0),
                    saldo_disponivel: roundVolume(l.saldo_disponivel || 0),
                  })),
                }
              : {}),
        };
      });
    } else if (tipoOrigem === "embalado" && embaladoOrigensValidas.length > 0) {
      // Ordem de registro das origens = ordem FIFO no envase (paridade tanka).
      origensNorm = embaladoOrigensValidas.map((item) => {
        const uid = createClientUid();
        const vol = roundVolume(item.quantidade);
        const um = item.unidade_medida || "kg";
        const loteEfetivo = String(item.lote || "").trim();
        return {
          _uid: uid,
          tipo_origem: "embalado",
          entrada_id: item.entrada_id || null,
          entrada_codigo: `EMBALADO — Lote ${loteEfetivo || "—"}`,
          lote: loteEfetivo,
          // FIFO opera em L; conversão massa ocorre depois.
          unidade_medida: um,
          volume_retirado: vol,
          massa_retirada: dens > 0 ? roundMass(vol * dens) : 0,
          saldo_restante: 0,
          saldo_disponivel: vol,
          embalado: true,
        };
      });
    } else {
      const prevOrigem = (initialPayload?.origens || [])[0] || {};
      const isEmbalado =
        tipoOrigem === "embalado" ||
        Boolean(prevOrigem.embalado) ||
        Boolean(embaladoOrigem);
      const umEstoque =
        embaladoOrigem?.unidade_medida ||
        prevOrigem.unidade_medida ||
        (isEmbalado ? "kg" : "L");
      const prevEntradaId =
        embaladoOrigem?.entrada_id ||
        prevOrigem.entrada_id ||
        (tipoOrigem === "entrada"
          ? granelPayload?.id ||
            granelPayload?.savedEstoques?.[0]?.id ||
            `${PENDING_GRANEL_PREFIX}::0`
          : null);
      const loteEfetivo =
        loteOrigem ||
        embaladoOrigem?.lote ||
        prevOrigem.lote ||
        "";
      // FIFO sempre em L; conversão massa ocorre depois (paridade TransbordoModal).
      origensNorm = [
        {
          _uid: origemUid,
          tipo_origem: tipoOrigem,
          entrada_id: prevEntradaId,
          entrada_codigo:
            prevOrigem.entrada_codigo ||
            `${origemLabel} — Lote ${loteEfetivo || "—"}`,
          lote: loteEfetivo,
          unidade_medida: umEstoque,
          volume_retirado: volumeRegistradoL,
          massa_retirada:
            massaPesagemForaMargemKg > 0
              ? roundMass(massaPesagemForaMargemKg)
              : dens > 0
                ? roundMass(volumeRegistradoL * dens)
                : 0,
          saldo_restante: 0,
          saldo_disponivel: volumeRegistradoL,
          embalado: isEmbalado,
          ...(Array.isArray(prevOrigem.lotes_retirados) &&
          prevOrigem.lotes_retirados.length > 0
            ? { lotes_retirados: prevOrigem.lotes_retirados }
            : {}),
        },
      ];
    }

    const firstOrigemUid = origensNorm[0]?._uid || origemUid;

    let destinosNorm = destinos.map((d) => {
      const volumeFormL = roundVolume(d.volume_total || d.volume || 0);
      const volumePorFormL = roundVolume(d.volume_por_embalagem || 0);
      const quantidade_embalagens = isDestinoEstoqueEmbalado(d.tipo_embalagem)
        ? qtdEmbalagensFromVolume(volumeFormL, volumePorFormL) ||
          Number(d.quantidade_embalagens) ||
          0
        : roundVolume(d.quantidade_embalagens || 0);
      const massaDestino =
        dens > 0
          ? roundMass(volumeFormL * dens)
          : roundMass(d.peso_liquido || 0);
      return {
        ...d,
        // Modal simplificado: FIFO realoca entre origens; ancora no 1º uid.
        origem_uid: firstOrigemUid,
        volume: volumeFormL,
        volume_total: volumeFormL,
        volume_por_embalagem: volumePorFormL,
        quantidade_embalagens,
        tara: roundMass(d.tara || 0),
        peso_liquido: roundMass(massaDestino),
        peso_bruto: roundMass((d.tara || 0) + massaDestino),
      };
    });

    // FIFO: 1º destino consome 1ª origem/lote, depois a seguinte, etc.
    const { destinoCompositions } = calculateFIFOAllocation(
      origensNorm,
      destinosNorm,
      dens
    );
    destinosNorm = destinosNorm.map((d, i) => {
      const composicao = destinoCompositions[i] || [];
      return {
        ...d,
        composicao,
        lote: getDominantLote(composicao) || d.lote || "",
      };
    });

    // Embalado em massa: formulário em L → persiste volume na UOM do estoque (kg/lb).
    const origem0 = origensNorm[0];
    const origemEmbaladoMassa = origensNorm.some(isOrigemEmbaladoMassa);
    if (origemEmbaladoMassa && dens > 0) {
      const umDestino = origem0?.unidade_medida || "kg";
      const toPersistDestino = (qtyL) =>
        embaladoLitrosToMassa(qtyL, umDestino, dens);
      origensNorm = origensNorm.map((o) => {
        if (!isOrigemEmbaladoMassa(o)) return o;
        const um = o.unidade_medida || "kg";
        const toPersist = (qtyL) => embaladoLitrosToMassa(qtyL, um, dens);
        const volL = roundVolume(o.volume_retirado || 0);
        const volumePersistido = toPersist(volL);
        const massaKg =
          normalizeUnidadeEntrada(um) === "lb"
            ? roundMass(volumePersistido * 0.453592)
            : roundMass(volumePersistido);
        return {
          ...o,
          volume_retirado: volumePersistido,
          massa_retirada: massaKg,
          saldo_disponivel: toPersist(o.saldo_disponivel),
          saldo_restante: toPersist(
            Math.max(0, roundVolume(o.saldo_disponivel) - volL)
          ),
          unidade_medida: um,
          embalado: true,
        };
      });
      destinosNorm = destinosNorm.map((d) => {
        const volumeFormL = roundVolume(d.volume_total || d.volume || 0);
        const volumePorFormL = roundVolume(d.volume_por_embalagem || 0);
        const volume_total = toPersistDestino(volumeFormL);
        const volume_por_embalagem = toPersistDestino(volumePorFormL);
        const massaDestino =
          normalizeUnidadeEntrada(umDestino) === "lb"
            ? roundMass(volume_total * 0.453592)
            : roundMass(volume_total);
        return {
          ...d,
          volume: volume_total,
          volume_total,
          volume_por_embalagem,
          quantidade_embalagens: isDestinoEstoqueEmbalado(d.tipo_embalagem)
            ? qtdEmbalagensFromVolume(volumeFormL, volumePorFormL) ||
              Number(d.quantidade_embalagens) ||
              0
            : roundVolume(d.quantidade_embalagens || 0),
          peso_liquido: massaDestino,
          peso_bruto: roundMass((d.tara || 0) + massaDestino),
        };
      });
    }

    const volumeTotalPersistido = origemEmbaladoMassa && dens > 0
      ? roundVolume(
          origensNorm.reduce((s, o) => s + (Number(o.volume_retirado) || 0), 0)
        )
      : volumeRegistradoL;
    const massaTotal =
      dens > 0
        ? origemEmbaladoMassa
          ? roundMass(
              origensNorm.reduce((s, o) => s + (Number(o.massa_retirada) || 0), 0)
            )
          : massaPesagemForaMargemKg > 0
            ? roundMass(massaPesagemForaMargemKg)
            : roundMass(volumeRegistradoL * dens)
        : 0;

    // Envase não pode exceder a massa operacional (peso líquido fora da margem).
    if (massaTotal > 0 && destinosNorm.length > 0 && !origemEmbaladoMassa) {
      const aligned = alignDestinosMassaToQuantidade(
        destinosNorm.map((d) => ({
          ...d,
          massa: Number(d.peso_liquido) || 0,
          volume: Number(d.volume_total || d.volume) || 0,
        })),
        massaTotal
      );
      destinosNorm = aligned.map((d) => {
        const { massa, ...rest } = d;
        const peso = roundMass(massa);
        return {
          ...rest,
          peso_liquido: peso,
          peso_bruto: roundMass((Number(rest.tara) || 0) + peso),
        };
      });
      origensNorm = origensNorm.map((o, i) =>
        i === 0 ? { ...o, massa_retirada: roundMass(massaTotal) } : o
      );
    }

    return {
      id: null,
      data: dataOp || granelPayload?.data || new Date().toISOString().slice(0, 10),
      cliente_id: clienteId || granelPayload?.cliente_id || null,
      cliente_nome: clienteNome || granelPayload?.cliente_nome || "",
      produto_id: produtoId || granelPayload?.produto_id || null,
      produto_nome: produtoNome || granelPayload?.produto_nome || "",
      produto_codigo: produtoCodigo || granelPayload?.produto_codigo || "",
      densidade: densStr,
      volume_total: volumeTotalPersistido,
      massa_total: massaTotal,
      operadores: [...operadores],
      ...(fixedOperador?.id
        ? { operador_usuario_id: String(fixedOperador.id) }
        : {}),
      observacoes: String(
        observacoes || initialPayload?.observacoes || ""
      ).trim(),
      origens: origensNorm,
      destinos: destinosNorm,
    };
  };

  const handleSubmit = async () => {
    setError("");
    if (!(dens > 0)) {
      setError(t("painel.operacional.ordemTransbordo.envaseModal.errors.density"));
      return;
    }
    if (!allDestinosOk) {
      setError(t("painel.operacional.ordemTransbordo.envaseModal.errors.items"));
      return;
    }
    if (tankaExcedido) {
      setError(
        t("painel.operacional.ordemTransbordo.envaseModal.errors.tankaCapacity")
      );
      return;
    }
    if (!volumesMatch) {
      setError(t("painel.operacional.ordemTransbordo.envaseModal.errors.mismatch"));
      return;
    }
    if (operadores.length === 0) {
      setError(
        t("painel.operacional.ordemTransbordo.envaseModal.errors.operators")
      );
      return;
    }
    setSaving(true);
    try {
      await onSave?.(buildPayload());
    } catch (err) {
      setError(
        err?.message ||
          t("painel.operacional.ordemTransbordo.errors.saveTransbordo")
      );
    } finally {
      setSaving(false);
    }
  };

  const displayError = error || externalError;

  const formatConverted = (value, unit) => {
    if (unit === "L") return `${formatVolume(value)} L`;
    return `${formatMass(value)} kg`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !saving) onClose?.();
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] w-[min(860px,calc(100vw-1.5rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base font-semibold text-foreground">
                {t("painel.operacional.ordemTransbordo.envaseModal.title")}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {t("painel.operacional.ordemTransbordo.envaseModal.subtitle")}
              </p>
            </div>
            {headerActions ? (
              <div className="shrink-0 flex items-center gap-2">{headerActions}</div>
            ) : null}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {displayError ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {displayError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-2 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("painel.operacional.ordemTransbordo.fields.product")}
                </p>
                <p className="text-sm font-semibold text-foreground break-words">
                  {productLabel || "—"}
                </p>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="ordem-envase-lote"
                  className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("painel.operacional.ordemTransbordo.fields.lot")}
                </Label>
                {lotesEditable && multiOrigensExibidas.length <= 1 ? (
                  typeof getOrigemLoteOptions === "function" &&
                  onOrigemLoteChange ? (
                    (() => {
                      const idx = multiOrigensExibidas[0]?._index ?? 0;
                      const loteOpts = getOrigemLoteOptions(idx) || [];
                      const current = multiOrigensExibidas[0];
                      const selected =
                        loteOpts.find(
                          (opt) =>
                            String(opt.id) ===
                              String(
                                current?.entrada_id ||
                                  current?.vasilhameId ||
                                  current?.tankaId ||
                                  ""
                              ) ||
                            String(opt.lote || "") ===
                              String(current?.lote || lote || "")
                        ) || null;
                      return (
                        <SearchableSelect
                          value={
                            selected?.display_label ||
                            lote ||
                            current?.lote ||
                            ""
                          }
                          onChange={(label, row) =>
                            onOrigemLoteChange(idx, label, row)
                          }
                          options={loteOpts}
                          getOptionLabel={(opt) =>
                            opt.display_label || opt.lote || ""
                          }
                          getOptionValue={(opt) => opt.id}
                          placeholder={t(
                            "painel.operacional.ordemTransbordo.placeholders.lotStock",
                            {
                              defaultValue: "Selecione lote / saldo",
                            }
                          )}
                          typeToSearch
                          inputClassName={`${INPUT_EDITABLE} h-9 text-sm font-medium`}
                        />
                      );
                    })()
                  ) : onLoteChange ? (
                    <Input
                      id="ordem-envase-lote"
                      value={lote || multiOrigensExibidas[0]?.lote || ""}
                      onChange={(e) => onLoteChange(e.target.value)}
                      placeholder={t(
                        "painel.operacional.ordemTransbordo.envaseModal.lotPlaceholder",
                        { defaultValue: "Informe o lote" }
                      )}
                      className={`${INPUT_EDITABLE} h-9 text-sm font-medium`}
                    />
                  ) : (
                    <p className="text-sm font-medium text-foreground py-2">
                      {lote || multiOrigensExibidas[0]?.lote || "—"}
                    </p>
                  )
                ) : (
                  <p className="text-sm font-medium text-foreground py-2">
                    {multiOrigensExibidas.length > 1
                      ? lote ||
                        t(
                          "painel.operacional.ordemTransbordo.envaseModal.multipleLots",
                          { count: multiOrigensExibidas.length }
                        )
                      : lote || multiOrigensExibidas[0]?.lote || "—"}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="ordem-envase-quantidade"
                  className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("painel.operacional.ordemTransbordo.fields.qty")}
                  {unidade ? ` (${unidade})` : ""}
                </Label>
                {quantidadeEditable ? (
                  <NumberInputBr
                    id="ordem-envase-quantidade"
                    decimals={unitNorm === "L" ? 3 : 0}
                    trimTrailingZeros={unitNorm === "L"}
                    min={0}
                    value={
                      quantidade === "" || quantidade == null ? "" : quantidade
                    }
                    onChange={(v) => onQuantidadeChange?.(v === "" ? "" : v)}
                    placeholder="0"
                    className={`${INPUT_EDITABLE} font-semibold tabular-nums`}
                  />
                ) : (
                  <p className="text-sm font-semibold tabular-nums text-foreground py-2">
                    {unitNorm === "L"
                      ? `${formatVolume(qtyRaw || volumeRegistradoL)} L`
                      : `${formatNum(qtyRaw)} ${unidade || ""}`}
                  </p>
                )}
              </div>
              {multiOrigensExibidas.length > 0 ||
              (lotesEditable && tipoOrigem === "embalado") ? (
                <div className="sm:col-span-2 lg:col-span-4 space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(
                        "painel.operacional.ordemTransbordo.envaseModal.originsFifo"
                      )}
                    </p>
                    {lotesEditable &&
                    onAddOrigem &&
                    ["embalado", "tanka", "vasilhame"].includes(tipoOrigem) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={onAddOrigem}
                      >
                        <Plus className="h-3 w-3" />
                        {t(
                          "painel.operacional.ordemTransbordo.envaseModal.addLot",
                          { defaultValue: "Adicionar lote" }
                        )}
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {(multiOrigensExibidas.length > 0
                      ? multiOrigensExibidas
                      : []
                    ).map((o, i) => {
                      const isVas = tipoOrigem === "vasilhame";
                      const isEmb = tipoOrigem === "embalado";
                      const codigo = isEmb
                        ? "Embalado"
                        : isVas
                          ? o.codigo || "Vasilhame"
                          : o.tankaCodigo || "Tanka";
                      const key = isEmb
                        ? `emb-${o.entrada_id || "new"}-${o._index}`
                        : isVas
                          ? `vas-${o.vasilhameId || "new"}-${o._index}`
                          : `tanka-${o.tankaId || "new"}-${o.lote}-${o._index}`;
                      return (
                        <div
                          key={key}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground"
                        >
                          <span className="font-bold text-primary shrink-0">
                            {String(i + 1).padStart(2, "0")}.
                          </span>
                          {lotesEditable && onOrigemLoteChange ? (
                            <>
                              <span className="text-muted-foreground shrink-0">
                                {codigo} ·
                              </span>
                              {typeof getOrigemLoteOptions === "function" ? (
                                (() => {
                                  const loteOpts =
                                    getOrigemLoteOptions(o._index) || [];
                                  const selected =
                                    loteOpts.find(
                                      (opt) =>
                                        (isEmb &&
                                          String(opt.id) ===
                                            String(o.entrada_id || "")) ||
                                        (isVas &&
                                          String(opt.id) ===
                                            String(o.vasilhameId || "")) ||
                                        (!isEmb &&
                                          !isVas &&
                                          String(opt.id) ===
                                            String(o.tankaId || ""))
                                    ) ||
                                    loteOpts.find(
                                      (opt) =>
                                        String(opt.lote || "") ===
                                        String(o.lote || "")
                                    );
                                  return (
                                    <div className="min-w-[12rem] flex-1">
                                      <SearchableSelect
                                        value={
                                          selected?.display_label ||
                                          o.lote ||
                                          ""
                                        }
                                        onChange={(label, row) =>
                                          onOrigemLoteChange(
                                            o._index,
                                            label,
                                            row
                                          )
                                        }
                                        options={loteOpts}
                                        getOptionLabel={(opt) =>
                                          opt.display_label || opt.lote || ""
                                        }
                                        getOptionValue={(opt) => opt.id}
                                        placeholder={t(
                                          "painel.operacional.ordemTransbordo.placeholders.lotStock",
                                          {
                                            defaultValue:
                                              "Selecione lote / saldo",
                                          }
                                        )}
                                        typeToSearch
                                        inputClassName={`${INPUT_EDITABLE} h-8 text-xs font-medium`}
                                      />
                                    </div>
                                  );
                                })()
                              ) : (
                                <Input
                                  value={o.lote || ""}
                                  onChange={(e) =>
                                    onOrigemLoteChange(
                                      o._index,
                                      e.target.value
                                    )
                                  }
                                  placeholder={t(
                                    "painel.operacional.ordemTransbordo.envaseModal.lotPlaceholder",
                                    { defaultValue: "Lote" }
                                  )}
                                  className={`${INPUT_EDITABLE} h-8 min-w-[8rem] flex-1 text-xs font-medium`}
                                />
                              )}
                            </>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">
                              {codigo} · {o.lote || "—"}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <NumberInputBr
                              decimals={3}
                              trimTrailingZeros
                              min={0}
                              value={
                                o.quantidade === "" || o.quantidade == null
                                  ? ""
                                  : o.quantidade
                              }
                              onChange={(v) =>
                                onTankaOrigemQuantidadeChange?.(
                                  o._index,
                                  v === "" ? "" : v
                                )
                              }
                              className={`${INPUT_EDITABLE} h-8 w-[7.5rem] text-right font-semibold tabular-nums`}
                            />
                            <span className="text-muted-foreground">L</span>
                            {lotesEditable &&
                            onRemoveOrigem &&
                            multiOrigensExibidas.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => onRemoveOrigem(o._index)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                                title={t("common.remove", {
                                  defaultValue: "Remover",
                                })}
                                aria-label={t("common.remove", {
                                  defaultValue: "Remover",
                                })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {lotesEditable &&
                    multiOrigensExibidas.length === 0 &&
                    onAddOrigem ? (
                      <p className="text-xs text-muted-foreground py-1">
                        {t(
                          "painel.operacional.ordemTransbordo.envaseModal.noLotsHint",
                          {
                            defaultValue:
                              "Nenhum lote informado. Clique em Adicionar lote.",
                          }
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="space-y-1">
                <Label
                  htmlFor="ordem-envase-densidade"
                  className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("painel.operacional.ordemTransbordo.fields.density")} *
                </Label>
                <NumberInputBr
                  id="ordem-envase-densidade"
                  decimals={4}
                  min={0}
                  value={
                    densidadeEdit === "" || densidadeEdit == null
                      ? ""
                      : densidadeEdit
                  }
                  onChange={(v) => setDensidadeEdit(v === "" ? "" : v)}
                  placeholder="0"
                  className={`${INPUT_EDITABLE} font-semibold tabular-nums`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {qtyConverted
                    ? t(qtyConverted.labelKey)
                    : t(
                        "painel.operacional.ordemTransbordo.envaseModal.conversion"
                      )}
                </Label>
                <p className="text-sm font-semibold tabular-nums text-primary py-2">
                  {qtyConverted
                    ? formatConverted(qtyConverted.value, qtyConverted.unit)
                    : dens > 0
                      ? "—"
                      : t(
                          "painel.operacional.ordemTransbordo.envaseModal.noDensity"
                        )}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                {t("painel.operacional.ordemTransbordo.envaseModal.itemsTitle")}
              </h4>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addDestino}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("painel.operacional.ordemTransbordo.envaseModal.addItem")}
              </Button>
            </div>

            <div className="space-y-3">
              {destinos.map((destino, idx) => (
                <DestinoCard
                  key={`${destino.origem_uid || origemUid}-${idx}`}
                  index={idx}
                  destino={destino}
                  isotanques={filteredIsotanques}
                  vasilhames={vasilhames}
                  produtoId={produtoId}
                  produtoNome={produtoNome}
                  densidade={dens}
                  onChange={(data) => updateDestino(idx, data)}
                  onRemove={() => removeDestino(idx)}
                  collapsed={Boolean(collapsed[idx])}
                  onToggleCollapse={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [idx]: !prev[idx],
                    }))
                  }
                  todosDestinos={destinos}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              {t("painel.operacional.ordemTransbordo.envaseModal.operators")} *
            </Label>
            <div className="relative" ref={operadoresRef}>
              <button
                type="button"
                onClick={() => setOperadoresOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-md border border-border bg-white px-3 py-2 text-sm hover:border-slate-400 transition-colors"
              >
                <span
                  className={
                    operadores.length
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {operadores.length
                    ? t(
                        "painel.operacional.ordemTransbordo.envaseModal.operatorsSelected",
                        { count: operadores.length }
                      )
                    : t(
                        "painel.operacional.ordemTransbordo.envaseModal.operatorsPlaceholder"
                      )}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    operadoresOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {operadoresOpen ? (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                  <div className="max-h-48 overflow-y-auto">
                    {operadoresOpcoes.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        {t(
                          "painel.operacional.ordemTransbordo.envaseModal.operatorsEmpty"
                        )}
                      </p>
                    ) : (
                      operadoresOpcoes.map((op) => (
                        <label
                          key={op}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={operadores.includes(op)}
                            onChange={() => toggleOperador(op)}
                            className="h-4 w-4 rounded border-border"
                          />
                          <span className="text-foreground/80">{op}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {operadores.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {operadores.map((op) => (
                  <span
                    key={op}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    {op}
                    <button
                      type="button"
                      onClick={() => toggleOperador(op)}
                      className="hover:text-blue-900"
                      aria-label={t("buttons.delete", { defaultValue: "Remover" })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${
              volumeExceeded || tankaExcedido
                ? "border-red-200 bg-red-50 text-red-700"
                : volumesMatch
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-border bg-muted/30 text-foreground"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                {t(
                  "painel.operacional.ordemTransbordo.envaseModal.volumeRegistered"
                )}
                :{" "}
                <strong className="tabular-nums">
                  {formatVolume(volumeRegistradoL)} L
                </strong>
              </span>
              <span>
                {t(
                  "painel.operacional.ordemTransbordo.envaseModal.volumePacked"
                )}
                :{" "}
                <strong className="tabular-nums">
                  {formatVolume(volumeEnvasadoL)} L
                </strong>
              </span>
              <span>
                {t(
                  "painel.operacional.ordemTransbordo.envaseModal.volumeRemaining"
                )}
                :{" "}
                <strong className="tabular-nums">
                  {formatVolume(volumeRestanteL)} L
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {tankaExcedido ? (
                <>
                  <AlertCircle className="h-4 w-4" />
                  {t(
                    "painel.operacional.ordemTransbordo.envaseModal.errors.tankaCapacity"
                  )}
                </>
              ) : volumesMatch ? (
                <>
                  <CheckCircle className="h-4 w-4" />
                  {t(
                    "painel.operacional.ordemTransbordo.envaseModal.conferenceOk"
                  )}
                </>
              ) : volumeExceeded ? (
                <>
                  <AlertCircle className="h-4 w-4" />
                  {t(
                    "painel.operacional.ordemTransbordo.envaseModal.conferenceExceeded"
                  )}
                </>
              ) : (
                t(
                  "painel.operacional.ordemTransbordo.envaseModal.conferencePending"
                )
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            {t("common.cancel", { defaultValue: "Cancelar" })}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className="bg-primary hover:bg-primary/90"
          >
            {saving
              ? t("common.processing", { defaultValue: "Processando..." })
              : submitLabel ||
                t("painel.operacional.ordemTransbordo.submitValidation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
