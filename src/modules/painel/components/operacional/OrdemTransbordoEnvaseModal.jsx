import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle, ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Label } from "@shared/components/ui/label";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import DestinoCard from "@transbordo/components/transbordo/DestinoCard";
import {
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
import { computeTankaSaldo } from "@transbordo/lib/tankaVolume";
import {
  listOperadoresAtivosNomes,
  mergeOperadoresDropdown,
} from "@transbordo/lib/operadoresCadastro";
import { calculateFIFOAllocation } from "@transbordo/lib/fifo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";

const INPUT_EDITABLE = "bg-white";

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
  onTankaOrigemQuantidadeChange,
  productLabel = "",
  produtoId = "",
  produtoNome = "",
  produtoCodigo = "",
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
        value: roundMass(qtyRaw * dens),
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
        value: roundMass(litros * dens),
        unit: "kg",
        labelKey: "painel.operacional.ordemTransbordo.envaseModal.convertedToKg",
      };
    }
    return null;
  }, [dens, qtyRaw, unitNorm]);

  /** Origens com tanka+lote (exibição/edição), inclusive qty zerada. */
  const tankaOrigensExibidas = useMemo(
    () =>
      (tankaOrigens || [])
        .map((o, index) => ({ ...o, _index: index }))
        .filter(
          (o) =>
            String(o?.tankaId || "").trim() && String(o?.lote || "").trim()
        ),
    [tankaOrigens]
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
        .filter((o) => String(o?.vasilhameId || "").trim()),
    [vasilhameOrigens]
  );

  const vasilhameOrigensValidas = useMemo(
    () =>
      vasilhameOrigensExibidas.filter((o) => Number(o?.quantidade) > 0),
    [vasilhameOrigensExibidas]
  );

  const multiOrigensExibidas =
    tipoOrigem === "tanka"
      ? tankaOrigensExibidas
      : tipoOrigem === "vasilhame"
        ? vasilhameOrigensExibidas
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

  const filteredIsotanques = useMemo(
    () =>
      (isotanques || []).map((i) => {
        const saldo = computeTankaSaldo({
          isotanqueId: i.id,
          tankaCodigo: i.nome || i.tanka || i.codigo_itku || "",
          transbordos,
        });
        const cap = roundVolume(i.capacidade || 26000);
        const volumeDisponivel = Math.max(0, cap - saldo);
        return {
          ...i,
          saldo_atual: saldo,
          volume_disponivel: volumeDisponivel,
          display_label: `${i.nome || i.tanka || i.codigo_itku || ""} · ${formatVolume(volumeDisponivel)} L disp.`,
        };
      }),
    [isotanques, transbordos]
  );

  useEffect(() => {
    if (!open) return;
    const savedOrigens = Array.isArray(initialPayload?.origens)
      ? initialPayload.origens
      : [];
    const savedDestinos = Array.isArray(initialPayload?.destinos)
      ? initialPayload.destinos
      : [];
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
    } else {
      const prevOrigem = (initialPayload?.origens || [])[0] || {};
      const prevEntradaId =
        prevOrigem.entrada_id ||
        (tipoOrigem === "entrada" ? granelPayload?.id || null : null);
      origensNorm = [
        {
          _uid: origemUid,
          tipo_origem: tipoOrigem,
          entrada_id: prevEntradaId,
          entrada_codigo:
            prevOrigem.entrada_codigo ||
            `${origemLabel} — Lote ${loteOrigem || "—"}`,
          lote: loteOrigem || prevOrigem.lote || "",
          unidade_medida: prevOrigem.unidade_medida || "L",
          volume_retirado: volumeRegistradoL,
          massa_retirada: dens > 0 ? roundMass(volumeRegistradoL * dens) : 0,
          saldo_restante: 0,
          saldo_disponivel: volumeRegistradoL,
          embalado: tipoOrigem === "embalado" || Boolean(prevOrigem.embalado),
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

    return {
      id: null,
      data: dataOp || granelPayload?.data || new Date().toISOString().slice(0, 10),
      cliente_id: clienteId || granelPayload?.cliente_id || null,
      cliente_nome: clienteNome || granelPayload?.cliente_nome || "",
      produto_id: produtoId || granelPayload?.produto_id || null,
      produto_nome: produtoNome || granelPayload?.produto_nome || "",
      produto_codigo: produtoCodigo || granelPayload?.produto_codigo || "",
      densidade: densStr,
      volume_total: volumeRegistradoL,
      massa_total: dens > 0 ? roundMass(volumeRegistradoL * dens) : 0,
      operadores: [...operadores],
      ...(fixedOperador?.id
        ? { operador_usuario_id: String(fixedOperador.id) }
        : {}),
      observacoes: "",
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
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("painel.operacional.ordemTransbordo.fields.lot")}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {multiOrigensExibidas.length > 1
                    ? lote ||
                      t(
                        "painel.operacional.ordemTransbordo.envaseModal.multipleLots",
                        { count: multiOrigensExibidas.length }
                      )
                    : lote || multiOrigensExibidas[0]?.lote || "—"}
                </p>
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
                      ? `${formatVolume(volumeRegistradoL || qtyRaw)} L`
                      : `${formatNum(volumeRegistradoL || qtyRaw)} ${unidade || ""}`}
                  </p>
                )}
              </div>
              {multiOrigensExibidas.length > 0 ? (
                <div className="sm:col-span-2 lg:col-span-4 space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(
                      "painel.operacional.ordemTransbordo.envaseModal.originsFifo"
                    )}
                  </p>
                  <div className="space-y-2">
                    {multiOrigensExibidas.map((o, i) => {
                      const isVas = tipoOrigem === "vasilhame";
                      const codigo = isVas
                        ? o.codigo || "Vasilhame"
                        : o.tankaCodigo || "Tanka";
                      const key = isVas
                        ? `${o.vasilhameId}-${o._index}`
                        : `${o.tankaId}-${o.lote}-${o._index}`;
                      return (
                        <div
                          key={key}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground"
                        >
                          <span className="font-bold text-primary shrink-0">
                            {String(i + 1).padStart(2, "0")}.
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {codigo} · {o.lote || "—"}
                          </span>
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
                          </div>
                        </div>
                      );
                    })}
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

          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${
              volumeExceeded
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
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {volumesMatch ? (
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
