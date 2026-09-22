import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { formatVolume, formatMass, formatNum, roundVolume, roundMass } from "@transbordo/lib/format";
import { getEstoqueUnidade } from "@transbordo/lib/estoqueSaldo";
import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
} from "@transbordo/lib/tiposEmbalagem";
import {
  ORIGEM_TRANSBORDO,
  ORIGEM_INDUSTRIALIZACAO,
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  DESTINO_RETORNO_MP,
  emptySaidaItem,
  resolveItemOrigem,
  tipoItemLabel,
  origemLabel,
  containerLabel,
  retornoMpLabel,
  clientsMatch,
  filterContainersIndForSaida,
} from "@transbordo/lib/saidaOrigem";
import { buildReservaChave } from "@painel/lib/materialReservas";
import {
  SEM_RESERVA_ID,
  formatQtyReserva,
  opcoesReservaEmbalado,
  reservadoAtivoChave,
  saldoDisponivelReserva,
  saldoExcepcionalDisponivel,
  sumBloqueioPendenteChave,
  sumExcepcionalNoForm,
  isSaidaPendenteBaixa,
} from "@painel/lib/saidaReservas";
import {
  buildVasilhameReservaChave,
  isVasilhameReservado,
} from "@painel/lib/vasilhameReservas";
import {
  getContainerPackageQty,
  isUnitPackagingType,
  getUnitPackagingCapacity,
} from "@industrializacao/lib/packagingTypes";

const TIPO_UI_VASILHAME = "vasilhame";

const TIPO_SAIDA_OPTIONS = [
  { value: TIPO_EMBALADO, label: "Embalado" },
  { value: TIPO_UI_VASILHAME, label: "Vasilhame" },
  { value: TIPO_IND_RETORNO_MP, label: "Retorno de MP" },
];

const TIPO_TRANSBORDO_OPTIONS = [
  { value: TIPO_EMBALADO, label: "Embalado" },
  { value: TIPO_CONVENCIONAL, label: "Vasilhame" },
];

const TIPO_IND_OPTIONS = [
  { value: TIPO_IND_VASILHAME, label: "Vasilhame" },
  { value: TIPO_IND_RETORNO_MP, label: DESTINO_RETORNO_MP },
];

/** Rótulo: n placa - n barril. Reserva aparece como badge, não no texto. */
function vasilhameLabel(v) {
  if (!v) return "—";
  const placa = String(v.placa || "").trim();
  const barril = String(v.barril || "").trim();
  const tanque = placa || v.tipo || "—";
  const hasBarril = Boolean(barril) && barril !== "—" && barril !== "-";
  if (hasBarril) return `${tanque} - ${barril}`;
  return tanque;
}

function ReservadoBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium leading-4 text-emerald-800">
      Reservado
    </span>
  );
}

function isUnidadeVolumeMedida(unidade) {
  const u = String(unidade || "").toLowerCase().trim();
  return u === "l" || u === "lt" || u === "litro" || u === "litros";
}

function formatQtdPorUnidade(n, unidade) {
  return isUnidadeVolumeMedida(unidade) ? formatVolume(n) : formatMass(n);
}

function loteLabel(lote, saldo, unidade) {
  return `${lote || "—"} - ${formatQtdPorUnidade(saldo, unidade)} - ${unidade || "kg"}`;
}

function TipoButtons({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            value === opt.value
              ? opt.value === TIPO_IND_RETORNO_MP
                ? "bg-orange-500 text-white"
                : "bg-primary text-white"
              : "bg-card border border-border text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function SaidaItemRow({
  index,
  item,
  itens = [],
  entradas,
  vasilhames,
  containersInd = [],
  stocksInd = [],
  movementsInd = [],
  reservas = [],
  saidas = [],
  saidaId = null,
  clienteId,
  clienteNome = "",
  enableMultiOrigem = false,
  lockedOrigem = null,
  onChange,
  onRemove,
  getAvailableSaldo,
  getAvailableVolume,
  getAvailableContainerVolume,
  getAvailableStockSaldo,
  collapsed = false,
  onToggleCollapse,
}) {
  const hasCliente = Boolean(clienteId);
  const origem = resolveItemOrigem(item) || lockedOrigem || ORIGEM_TRANSBORDO;
  const showOrigemSelector = enableMultiOrigem && !lockedOrigem;

  const handleTipoChange = (newTipo) => {
    onChange({
      ...emptySaidaItem(origem),
      tipo: newTipo,
    });
  };

  const handleTipoUnificadoChange = (newTipo) => {
    if (newTipo === TIPO_EMBALADO) {
      onChange({ ...emptySaidaItem(ORIGEM_TRANSBORDO), tipo: TIPO_EMBALADO });
      return;
    }
    if (newTipo === TIPO_UI_VASILHAME) {
      onChange({ ...emptySaidaItem(ORIGEM_TRANSBORDO), tipo: TIPO_CONVENCIONAL });
      return;
    }
    onChange({
      ...emptySaidaItem(ORIGEM_INDUSTRIALIZACAO),
      tipo: TIPO_IND_RETORNO_MP,
    });
  };

  // ── Embalado: produtos do cliente com saldo disponível (após outras linhas) ──
  const embaladoEntradas = hasCliente
    ? entradas.filter((e) => e.embalado && e.cliente_id === clienteId)
    : [];

  const uniqueProdutos = [];
  const seen = new Set();
  embaladoEntradas.forEach((e) => {
    const key = e.produto_id || e.produto_nome;
    if (!key || seen.has(key)) return;
    const isCurrent = (item.produto_id || item.produto_nome) === key;
    const hasSaldoDisponivel = embaladoEntradas.some(
      (x) =>
        (x.produto_id || x.produto_nome) === key &&
        getAvailableSaldo(x.id, index) > 0
    );
    if (!hasSaldoDisponivel && !isCurrent) return;
    seen.add(key);
    uniqueProdutos.push({
      id: e.produto_id,
      nome: e.produto_nome,
      codigo: e.produto_codigo,
      peso_liquido: e.peso_liquido,
    });
  });

  const lotesForProduct = embaladoEntradas.filter((e) => {
    const sameProduct =
      (e.produto_id || e.produto_nome) === (item.produto_id || item.produto_nome);
    if (!sameProduct) return false;
    const saldoDisponivel = getAvailableSaldo(e.id, index);
    return saldoDisponivel > 0 || e.id === item.entrada_id;
  });

  // ── Convencional (Transbordo) ──
  const vasilhamesUsados = new Set(
    (itens || [])
      .filter(
        (it, i) =>
          i !== index &&
          it.tipo === TIPO_CONVENCIONAL &&
          it.vasilhame_id
      )
      .map((it) => it.vasilhame_id)
  );

  const vasilhamesEmOutraSaida = new Set();
  for (const saida of saidas || []) {
    if (saidaId && String(saida.id) === String(saidaId)) continue;
    if (!isSaidaPendenteBaixa(saida)) continue;
    for (const it of saida.itens || []) {
      if (it?.tipo === TIPO_CONVENCIONAL && it.vasilhame_id) {
        vasilhamesEmOutraSaida.add(it.vasilhame_id);
      }
    }
  }

  const vasilhamesDisponiveis = hasCliente
    ? vasilhames.filter(
        (v) =>
          v.cliente_id === clienteId &&
          (v.status || "No Pátio") === "No Pátio" &&
          (v.volume || 0) > 0 &&
          (!vasilhamesUsados.has(v.id) || v.id === item.vasilhame_id) &&
          (!vasilhamesEmOutraSaida.has(v.id) || v.id === item.vasilhame_id)
      )
    : [];

  const produtosVasilhame = [];
  const produtosVistos = new Set();
  vasilhamesDisponiveis.forEach((v) => {
    const key = v.produto_id || v.produto_nome;
    if (!key || produtosVistos.has(key)) return;
    produtosVistos.add(key);
    produtosVasilhame.push({
      id: v.produto_id || key,
      produto_id: v.produto_id || "",
      nome: v.produto_nome || "—",
      codigo: v.produto_codigo || "",
    });
  });

  const mesmoProdutoVasilhame = (v) => {
    if (item.produto_id && v.produto_id) return v.produto_id === item.produto_id;
    return (
      String(v.produto_nome || "").trim().toUpperCase() ===
      String(item.produto_nome || "").trim().toUpperCase()
    );
  };
  const produtoVasilhameSelecionado = Boolean(item.produto_id || item.produto_nome);
  const vasilhamesDoProduto = produtoVasilhameSelecionado
    ? vasilhamesDisponiveis
        .filter((v) => v.id === item.vasilhame_id || mesmoProdutoVasilhame(v))
        .map((v) => ({
          ...v,
          reservado: isVasilhameReservado(
            reservas,
            buildVasilhameReservaChave(ORIGEM_TRANSBORDO, v.id)
          ),
        }))
    : [];

  // ── Industrialização: vasilhames (containers) ──
  const containersUsados = new Set(
    (itens || [])
      .filter(
        (it, i) =>
          i !== index &&
          it.tipo === TIPO_IND_VASILHAME &&
          it.container_id
      )
      .map((it) => it.container_id)
  );

  // Mesma base da tela Vasilhames (No Pátio): tanques, IBC, bombona/contentor, tambor…
  const containersDisponiveis = hasCliente
    ? filterContainersIndForSaida(containersInd, clienteNome, {
        usedIds: containersUsados,
        keepId: item.container_id,
      })
    : [];

  const containersEmOutraSaida = new Set();
  for (const saida of saidas || []) {
    if (saidaId && String(saida.id) === String(saidaId)) continue;
    if (!isSaidaPendenteBaixa(saida)) continue;
    for (const it of saida.itens || []) {
      if (it?.tipo === TIPO_IND_VASILHAME && it.container_id) {
        containersEmOutraSaida.add(it.container_id);
      }
    }
  }

  const vasilhamesUnificados = [
    ...vasilhamesDisponiveis.map((v) => ({
      source: ORIGEM_TRANSBORDO,
      id: `tb:${v.id}`,
      raw: v,
      reservado: isVasilhameReservado(
        reservas,
        buildVasilhameReservaChave(ORIGEM_TRANSBORDO, v.id)
      ),
      label: `${vasilhameLabel(v)}${v.produto_nome ? ` - ${v.produto_nome}` : ""} · Transbordo`,
    })),
    ...containersDisponiveis
      .filter((c) => !containersEmOutraSaida.has(c.id) || c.id === item.container_id)
      .map((c) => ({
        source: ORIGEM_INDUSTRIALIZACAO,
        id: `ind:${c.id}`,
        raw: c,
        reservado: isVasilhameReservado(
          reservas,
          buildVasilhameReservaChave(ORIGEM_INDUSTRIALIZACAO, c.id)
        ),
        label: `${containerLabel(c)} · Industrialização`,
      })),
  ];
  const vasilhameUnificadoSelecionado =
    vasilhamesUnificados.find((o) =>
      o.source === ORIGEM_TRANSBORDO
        ? item.tipo === TIPO_CONVENCIONAL && o.raw.id === item.vasilhame_id
        : item.tipo === TIPO_IND_VASILHAME && o.raw.id === item.container_id
    ) || null;

  // ── Industrialização: retorno MP (movimentações fiscais + estoque) ──
  const movementsUsados = new Set(
    (itens || [])
      .filter(
        (it, i) =>
          i !== index &&
          it.tipo === TIPO_IND_RETORNO_MP &&
          it.movement_id
      )
      .map((it) => it.movement_id)
  );

  const retornosMovimento = hasCliente
    ? movementsInd.filter(
        (m) =>
          m.destination === DESTINO_RETORNO_MP &&
          clientsMatch(m.client, clienteNome) &&
          (m.quantity || 0) > 0 &&
          (!movementsUsados.has(m.id) || m.id === item.movement_id)
      )
    : [];

  const retornoMpOptions = retornosMovimento.map((m) => ({
    ...m,
    _kind: "movement",
    _label: retornoMpLabel(m),
  }));

  // ── Valores dinâmicos ──
  const selectedEntrada =
    item.entrada_id && item.tipo === TIPO_EMBALADO
      ? entradas.find((e) => e.id === item.entrada_id) || null
      : null;
  const unidadeEmbalado =
    selectedEntrada?.unidade_medida ||
    (selectedEntrada && getEstoqueUnidade(selectedEntrada)) ||
    item.unidade ||
    "kg";
  const isUnidadeVolume = isUnidadeVolumeMedida(unidadeEmbalado);
  const formatQtdEmbalado = (n) => formatQtdPorUnidade(n, unidadeEmbalado);

  const chaveEmbalado =
    item.tipo === TIPO_EMBALADO && item.entrada_id
      ? buildReservaChave({
          clienteId,
          clienteNome,
          produtoCodigo: item.produto_codigo || selectedEntrada?.produto_codigo,
          lote: item.lote || selectedEntrada?.lote,
          unidade: unidadeEmbalado,
        })
      : "";
  const opcoesReserva = chaveEmbalado
    ? opcoesReservaEmbalado({
        reservas,
        saidas,
        itens,
        index,
        chave: chaveEmbalado,
        unidade: unidadeEmbalado,
        excludeSaidaId: saidaId,
        reservaIdAtual: item.reserva_id,
      })
    : [];
  const reservaSelecionada = item.reserva_id
    ? (reservas || []).find((r) => r.id === item.reserva_id && r.status === "ativa")
    : null;
  const dispReserva = reservaSelecionada
    ? saldoDisponivelReserva(reservaSelecionada, saidas, itens, index, saidaId)
    : 0;
  const fisicoChave = chaveEmbalado
    ? embaladoEntradas.reduce((sum, entrada) => {
        const chave = buildReservaChave({
          clienteId: entrada.cliente_id,
          clienteNome: entrada.cliente_nome,
          produtoCodigo: entrada.produto_codigo,
          lote: entrada.lote,
          unidade: entrada.unidade_medida || unidadeEmbalado,
        });
        if (chave !== chaveEmbalado) return sum;
        return sum + (Number(entrada.saldo_atual) || 0);
      }, 0)
    : 0;
  const tetoExcepcional = chaveEmbalado
    ? saldoExcepcionalDisponivel({
        saldoFisico: fisicoChave,
        reservadoAtivo: reservadoAtivoChave(reservas, chaveEmbalado),
        bloqueioPendente:
          sumBloqueioPendenteChave(saidas, chaveEmbalado, { excludeSaidaId: saidaId }) +
          sumExcepcionalNoForm(itens, index, chaveEmbalado),
      })
    : 0;
  const semReservaAtivo = item.tipo === TIPO_EMBALADO && item.entrada_id && !item.reserva_id;
  const reservaInsuficiente =
    item.tipo === TIPO_EMBALADO &&
    item.reserva_id &&
    (item.quantidade_solicitada || 0) > dispReserva;
  const saldoAtualLote = Math.round(Number(selectedEntrada?.saldo_atual) || 0);
  const saldoDisponivelSemReserva = Math.max(0, Math.min(saldoAtualLote, tetoExcepcional));
  const displayEstoqueFinal =
    saldoDisponivelSemReserva - (item.reserva_id ? 0 : item.quantidade_solicitada || 0);
  const estoqueInsuficiente =
    semReservaAtivo && (item.quantidade_solicitada || 0) > saldoDisponivelSemReserva;
  const maxQuantidadeSolicitada = item.reserva_id ? dispReserva : saldoDisponivelSemReserva;
  const reservaSelectValue = !item.entrada_id
    ? ""
    : item.reserva_id
      ? opcoesReserva.find((o) => o.id === item.reserva_id)?.label ||
        (item.reserva_solicitante
          ? `${item.reserva_solicitante} - ${formatQtyReserva(dispReserva, unidadeEmbalado)} ${unidadeEmbalado}`
          : "")
      : "Sem reserva";

  const displayVolumeDisponivel =
    item.vasilhame_id && item.tipo === TIPO_CONVENCIONAL
      ? getAvailableVolume(item.vasilhame_id, index)
      : 0;
  const displaySaldoFinal = displayVolumeDisponivel - (item.volume_solicitado || 0);
  const volumeInsuficiente =
    item.tipo === TIPO_CONVENCIONAL &&
    item.vasilhame_id &&
    (item.volume_solicitado || 0) > displayVolumeDisponivel;

  const displayContainerVol =
    item.container_id && item.tipo === TIPO_IND_VASILHAME
      ? getAvailableContainerVolume?.(item.container_id, index) ?? item.volume_disponivel ?? 0
      : 0;
  const displayContainerSaldo = displayContainerVol - (item.volume_solicitado || 0);
  const containerVolInsuficiente =
    item.tipo === TIPO_IND_VASILHAME &&
    item.container_id &&
    (item.volume_solicitado || 0) > displayContainerVol;

  const displayStockSaldo =
    item.stock_id && item.tipo === TIPO_IND_RETORNO_MP && !item.movement_id
      ? getAvailableStockSaldo?.(item.stock_id, index) ?? 0
      : item.movement_id
        ? item.quantidade_solicitada || 0
        : 0;
  const displayStockFinal = item.movement_id
    ? 0
    : displayStockSaldo - (item.quantidade_solicitada || 0);
  const stockInsuficiente =
    item.tipo === TIPO_IND_RETORNO_MP &&
    item.stock_id &&
    !item.movement_id &&
    (item.quantidade_solicitada || 0) > displayStockSaldo;

  // ── Handlers Embalado ──
  const handleProdutoChange = (_label, option) => {
    if (!option) return;
    onChange({
      ...item,
      produto_id: option.id,
      produto_nome: option.nome,
      produto_codigo: option.codigo || "",
      peso_liquido_embalagem: option.peso_liquido || 0,
      entrada_id: "",
      lote: "",
      unidade: "kg",
      quantidade_solicitada: 0,
      quantidade_embalagens: 0,
      reserva_id: "",
      sem_reserva: false,
      reserva_solicitante: "",
      reserva_chave: "",
    });
  };

  const handleLoteChange = (_label, option) => {
    if (!option) return;
    const unidade =
      option.unidade_medida || getEstoqueUnidade(option) || "kg";
    onChange({
      ...item,
      entrada_id: option.id,
      lote: option.lote || "",
      unidade,
      peso_liquido_embalagem:
        option.peso_liquido || item.peso_liquido_embalagem || 0,
      reserva_id: "",
      sem_reserva: true,
      reserva_solicitante: "",
      reserva_chave: buildReservaChave({
        clienteId,
        clienteNome,
        produtoCodigo: item.produto_codigo,
        lote: option.lote,
        unidade,
      }),
      quantidade_solicitada: 0,
      quantidade_embalagens: 0,
    });
  };

  const aplicarQuantidade = (qtdInformada) => {
    let qtd = Math.round(Number(qtdInformada) || 0);
    if (qtd < 0) qtd = 0;
    if (item.entrada_id && qtd > maxQuantidadeSolicitada) qtd = maxQuantidadeSolicitada;
    const pesoLiq = item.peso_liquido_embalagem || 0;
    const qtdEmbalagens = pesoLiq > 0 ? qtd / pesoLiq : 0;
    onChange({
      ...item,
      quantidade_solicitada: qtd,
      quantidade_embalagens: qtdEmbalagens,
    });
  };

  const handleQuantidadeChange = (v) => {
    aplicarQuantidade(v === "" ? 0 : v);
  };

  const handleReservaChange = (_label, option) => {
    if (!option) return;
    if (option.semReserva || option.id === SEM_RESERVA_ID) {
      const qtd = Math.min(Math.round(Number(item.quantidade_solicitada) || 0), saldoDisponivelSemReserva);
      const pesoLiq = item.peso_liquido_embalagem || 0;
      onChange({
        ...item,
        reserva_id: "",
        sem_reserva: true,
        reserva_solicitante: "",
        reserva_chave: chaveEmbalado,
        quantidade_solicitada: Math.max(0, qtd),
        quantidade_embalagens: pesoLiq > 0 ? Math.max(0, qtd) / pesoLiq : 0,
      });
      return;
    }
    const qtd = option.disponivel || 0;
    const pesoLiq = item.peso_liquido_embalagem || 0;
    onChange({
      ...item,
      reserva_id: option.id,
      sem_reserva: false,
      reserva_solicitante: option.solicitante || "",
      reserva_chave: chaveEmbalado,
      quantidade_solicitada: qtd,
      quantidade_embalagens: pesoLiq > 0 ? qtd / pesoLiq : 0,
    });
  };

  // ── Handlers Convencional ──
  const selectedVasilhame =
    vasilhames.find((v) => v.id === item.vasilhame_id) || null;
  const isUnitarioSelecionado = isDestinoEmbalagemUnitaria(
    selectedVasilhame?.tipo || item.tipo_embalagem
  );
  const qtdEmbDisponivel = selectedVasilhame
    ? getQuantidadeEmbalagensFromVasilhame(selectedVasilhame)
    : 0;

  const handleProdutoVasilhameChange = (_label, option) => {
    if (!option) return;
    onChange({
      ...item,
      produto_id: option.produto_id || option.id || "",
      produto_nome: option.nome || "",
      produto_codigo: option.codigo || "",
      vasilhame_id: "",
      vasilhame_placa: "",
      vasilhame_barril: "",
      lote: "",
      volume_solicitado: 0,
      peso_liquido: 0,
      peso_bruto: 0,
      tipo_embalagem: "",
      quantidade_embalagens: 0,
    });
  };

  const handleVasilhameChange = (_label, option) => {
    if (!option) return;
    const volumeAtual = option.volume || 0;
    const unitario = isDestinoEmbalagemUnitaria(option.tipo);
    const qtdEmb = getQuantidadeEmbalagensFromVasilhame(option);
    onChange({
      ...item,
      vasilhame_id: option.id,
      vasilhame_placa: option.placa || "",
      vasilhame_barril: option.barril || "",
      produto_id: option.produto_id || "",
      produto_nome: option.produto_nome || "",
      produto_codigo: option.produto_codigo || "",
      lote: option.lote || "",
      peso_liquido: option.peso_liquido || 0,
      peso_bruto: option.peso_bruto || 0,
      volume_solicitado: volumeAtual,
      tipo_embalagem: option.tipo || "",
      quantidade_embalagens: unitario ? qtdEmb : 0,
      volume_por_embalagem: unitario
        ? getVolumePorEmbalagemFromVasilhame(option)
        : 0,
    });
  };

  const handleQtdEmbalagensSaida = (qtd) => {
    if (!selectedVasilhame) return;
    const qtdN = Math.max(0, Math.round(Number(qtd) || 0));
    const volPorEmb =
      getVolumePorEmbalagemFromVasilhame(selectedVasilhame) ||
      (qtdEmbDisponivel > 0
        ? roundVolume((selectedVasilhame.volume || 0) / qtdEmbDisponivel)
        : 0);
    const dens =
      parseFloat(String(selectedVasilhame.densidade || "0").replace(",", ".")) ||
      0;
    const volSolicitado = roundVolume(qtdN * volPorEmb);
    const pesoLiq =
      dens > 0
        ? roundMass(volSolicitado * dens)
        : qtdEmbDisponivel > 0
          ? roundMass(
              ((selectedVasilhame.peso_liquido || 0) * qtdN) / qtdEmbDisponivel
            )
          : 0;
    const tara = roundMass(selectedVasilhame.tara || 0);
    onChange({
      ...item,
      quantidade_embalagens: qtdN,
      volume_por_embalagem: volPorEmb,
      volume_solicitado: volSolicitado,
      peso_liquido: pesoLiq,
      peso_bruto: roundMass(tara + pesoLiq),
    });
  };

  // ── Handlers Industrialização ──
  const selectedContainer =
    containersInd.find((c) => c.id === item.container_id) || null;
  const isIndUnitario =
    isUnitPackagingType(selectedContainer?.type || item.container_type);
  const qtdIndEmb = selectedContainer
    ? getContainerPackageQty(selectedContainer)
    : 0;

  const handleContainerChange = (_label, option) => {
    if (!option) return;
    const volumeAtual = option.volume || 0;
    const dens = parseFloat(String(option.density || "0").replace(",", ".")) || 0;
    const pesoLiq =
      option.net_weight ||
      (dens > 0 ? roundMass(volumeAtual * dens) : 0);
    const tara = option.tare || 0;
    const unitario = isUnitPackagingType(option.type);
    const qtdEmb = getContainerPackageQty(option);
    onChange({
      ...item,
      container_id: option.id,
      container_type: option.type || "",
      vasilhame_placa: option.container_number || "",
      vasilhame_barril: option.barril_number || "",
      produto_nome: option.product || "",
      produto_codigo: "",
      lote: option.lot || "",
      peso_liquido: pesoLiq,
      peso_bruto: option.gross_weight || roundMass(tara + pesoLiq),
      volume_solicitado: volumeAtual,
      quantidade_embalagens: unitario ? qtdEmb : 0,
      volume_por_embalagem: unitario
        ? getUnitPackagingCapacity(option.type) || 0
        : 0,
      quantidade_solicitada: pesoLiq,
    });
  };

  const handleQtdIndEmbalagens = (qtd) => {
    if (!selectedContainer) return;
    const qtdN = Math.max(0, Math.round(Number(qtd) || 0));
    const volPorEmb =
      getUnitPackagingCapacity(selectedContainer.type) ||
      (qtdIndEmb > 0
        ? roundVolume((selectedContainer.volume || 0) / qtdIndEmb)
        : 0);
    const dens =
      parseFloat(String(selectedContainer.density || "0").replace(",", ".")) ||
      0;
    const volSolicitado = roundVolume(qtdN * volPorEmb);
    const pesoLiq =
      dens > 0
        ? roundMass(volSolicitado * dens)
        : qtdIndEmb > 0
          ? roundMass(
              ((selectedContainer.net_weight || 0) * qtdN) / qtdIndEmb
            )
          : 0;
    const tara = roundMass(selectedContainer.tare || 0);
    onChange({
      ...item,
      quantidade_embalagens: qtdN,
      volume_por_embalagem: volPorEmb,
      volume_solicitado: volSolicitado,
      peso_liquido: pesoLiq,
      peso_bruto: roundMass(tara + pesoLiq),
      quantidade_solicitada: pesoLiq,
    });
  };

  const handleVasilhameUnificadoChange = (_label, option) => {
    if (!option) return;
    if (option.source === ORIGEM_TRANSBORDO) {
      const v = option.raw;
      const volumeAtual = v.volume || 0;
      const unitario = isDestinoEmbalagemUnitaria(v.tipo);
      const qtdEmb = getQuantidadeEmbalagensFromVasilhame(v);
      onChange({
        ...emptySaidaItem(ORIGEM_TRANSBORDO),
        tipo: TIPO_CONVENCIONAL,
        origem: ORIGEM_TRANSBORDO,
        vasilhame_id: v.id,
        vasilhame_placa: v.placa || "",
        vasilhame_barril: v.barril || "",
        produto_id: v.produto_id || "",
        produto_nome: v.produto_nome || "",
        produto_codigo: v.produto_codigo || "",
        lote: v.lote || "",
        peso_liquido: v.peso_liquido || 0,
        peso_bruto: v.peso_bruto || 0,
        volume_solicitado: volumeAtual,
        tipo_embalagem: v.tipo || "",
        quantidade_embalagens: unitario ? qtdEmb : 0,
        volume_por_embalagem: unitario ? getVolumePorEmbalagemFromVasilhame(v) : 0,
      });
      return;
    }
    const c = option.raw;
    const volumeAtual = c.volume || 0;
    const dens = parseFloat(String(c.density || "0").replace(",", ".")) || 0;
    const pesoLiq = c.net_weight || (dens > 0 ? roundMass(volumeAtual * dens) : 0);
    const tara = c.tare || 0;
    const unitario = isUnitPackagingType(c.type);
    const qtdEmb = getContainerPackageQty(c);
    onChange({
      ...emptySaidaItem(ORIGEM_INDUSTRIALIZACAO),
      tipo: TIPO_IND_VASILHAME,
      origem: ORIGEM_INDUSTRIALIZACAO,
      container_id: c.id,
      container_type: c.type || "",
      vasilhame_placa: c.container_number || "",
      vasilhame_barril: c.barril_number || "",
      produto_nome: c.product || "",
      lote: c.lot || "",
      peso_liquido: pesoLiq,
      peso_bruto: c.gross_weight || roundMass(tara + pesoLiq),
      volume_solicitado: volumeAtual,
      quantidade_embalagens: unitario ? qtdEmb : 0,
      volume_por_embalagem: unitario ? getUnitPackagingCapacity(c.type) || 0 : 0,
      quantidade_solicitada: pesoLiq,
    });
  };

  const handleRetornoMpChange = (_label, option) => {
    if (!option) return;
    if (option._kind === "movement") {
      onChange({
        ...item,
        movement_id: option.id,
        stock_id: option.stock_id || "",
        produto_nome: option.mp_name || "",
        produto_codigo: option.mp_code || "",
        lote: option.lot || "",
        quantidade_solicitada: option.quantity || 0,
        unidade: option.unit || "kg",
        estoque_atual: option.quantity || 0,
        estoque_final: 0,
      });
      return;
    }
    const saldo = getAvailableStockSaldo?.(option.id, index) ?? option.current_stock ?? 0;
    onChange({
      ...item,
      movement_id: "",
      stock_id: option.id,
      produto_nome: option.mp_name || "",
      produto_codigo: option.mp_code || "",
      lote: option.lot || "",
      quantidade_solicitada: saldo,
      unidade: option.unit || "kg",
      estoque_atual: saldo,
      estoque_final: 0,
    });
  };

  const handleRetornoQtyChange = (v) => {
    onChange({
      ...item,
      quantidade_solicitada: v || 0,
    });
  };

  const loteSelectValue = (() => {
    if (!item.entrada_id) return "";
    const entrada =
      lotesForProduct.find((e) => e.id === item.entrada_id) ||
      entradas.find((e) => e.id === item.entrada_id);
    if (!entrada) return item.lote || "";
    return loteLabel(
      entrada.lote,
      getAvailableSaldo(entrada.id, index),
      entrada.unidade_medida
    );
  })();

  const vasilhameSelectValue = item.vasilhame_id
    ? vasilhameLabel({
        placa: item.vasilhame_placa,
        barril: item.vasilhame_barril,
        tipo: item.tipo_embalagem,
        produto_nome: item.produto_nome,
      })
    : "";

  const containerSelectValue = item.container_id
    ? containerLabel({
        container_number: item.vasilhame_placa,
        barril_number: item.vasilhame_barril,
        type: item.container_type,
      })
    : "";

  const retornoSelectValue = (() => {
    if (!item.movement_id) return "";
    const mov = (movementsInd || []).find((m) => m.id === item.movement_id);
    if (mov) return retornoMpLabel(mov);
    return retornoMpLabel({
      mp_code: item.produto_codigo,
      mp_name: item.produto_nome,
      lot: item.lote,
      quantity: item.quantidade_solicitada,
      unit: item.unidade,
    });
  })();

  const resumoProduto =
    item.produto_nome ||
    ((item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME) &&
    item.vasilhame_placa
      ? containerLabel({
          container_number: item.vasilhame_placa,
          barril_number: item.vasilhame_barril,
          type: item.container_type || item.tipo_embalagem,
        })
      : "—");

  const resumoQuantidade =
    item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
      ? `${formatVolume(item.volume_solicitado)} L`
      : (() => {
          const u =
            item.unidade ||
            (item.entrada_id &&
              (entradas.find((e) => e.id === item.entrada_id)?.unidade_medida ||
                getEstoqueUnidade(
                  entradas.find((e) => e.id === item.entrada_id) || {}
                ))) ||
            "kg";
          return `${formatQtdPorUnidade(item.quantidade_solicitada, u)} ${u}`;
        })();

  return (
    <div className="rounded-lg border border-border bg-muted/40/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-primary shrink-0">
            Produto {String(index + 1).padStart(2, "0")}
          </span>
          {collapsed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground min-w-0">
              {lockedOrigem && (
                <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 px-2 py-0.5 font-medium">
                  {origemLabel(origem)}
                </span>
              )}
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5 font-medium">
                {tipoItemLabel(item)}
              </span>
              <span className="truncate font-medium text-foreground" title={resumoProduto}>
                {resumoProduto}
              </span>
              <span className="shrink-0 font-semibold text-foreground">
                {resumoQuantidade}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={collapsed ? "Expandir" : "Minimizar"}
            aria-label={collapsed ? "Expandir produto" : "Minimizar produto"}
          >
            {collapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Remover"
            aria-label="Remover produto"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {showOrigemSelector ? (
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <TipoButtons
                options={TIPO_SAIDA_OPTIONS}
                value={
                  item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME
                    ? TIPO_UI_VASILHAME
                    : item.tipo
                }
                onChange={handleTipoUnificadoChange}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <TipoButtons
                options={
                  origem === ORIGEM_INDUSTRIALIZACAO
                    ? TIPO_IND_OPTIONS
                    : TIPO_TRANSBORDO_OPTIONS
                }
                value={item.tipo}
                onChange={handleTipoChange}
              />
            </div>
          )}

          {/* ── EMBALADO (Transbordo) ── */}
          {item.tipo === TIPO_EMBALADO && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Produto *</Label>
                <SearchableSelect
                  value={item.produto_nome || ""}
                  onChange={handleProdutoChange}
                  options={uniqueProdutos}
                  getOptionLabel={(o) => o.nome || ""}
                  getOptionValue={(o) => o.id}
                  placeholder={
                    hasCliente
                      ? "Selecione um produto embalado..."
                      : "Selecione o cliente primeiro..."
                  }
                  disabled={!hasCliente}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lote *</Label>
                <SearchableSelect
                  value={loteSelectValue}
                  onChange={handleLoteChange}
                  options={lotesForProduct}
                  getOptionLabel={(o) =>
                    loteLabel(
                      o.lote,
                      getAvailableSaldo(o.id, index),
                      o.unidade_medida
                    )
                  }
                  getOptionValue={(o) => o.id}
                  placeholder="Selecione o lote..."
                  disabled={!hasCliente || !item.produto_id}
                />
              </div>
              {item.entrada_id && (
                <div className="space-y-1.5 col-span-3 sm:col-span-2">
                  <Label>Reserva *</Label>
                  <SearchableSelect
                    selectOnly
                    value={reservaSelectValue}
                    onChange={handleReservaChange}
                    options={opcoesReserva}
                    getOptionLabel={(o) => o.label || ""}
                    getOptionValue={(o) => o.id}
                    placeholder="Selecione a reserva..."
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Quantidade Solicitada ({unidadeEmbalado}) *</Label>
                <NumberInputBr
                  decimals={0}
                  value={item.quantidade_solicitada || ""}
                  onChange={(v) => handleQuantidadeChange(v === "" ? 0 : v)}
                  max={item.entrada_id ? maxQuantidadeSolicitada : undefined}
                  placeholder="0"
                  disabled={!item.entrada_id}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {isUnidadeVolume
                    ? `Qtd. por Embalagem (${unidadeEmbalado})`
                    : `Peso Líq. Embalagem (${unidadeEmbalado})`}
                </Label>
                <Input
                  value={formatQtdEmbalado(item.peso_liquido_embalagem)}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Qtd. Embalagens (auto)</Label>
                <Input
                  value={formatNum(item.quantidade_embalagens, 1)}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Saldo disponível ({unidadeEmbalado})</Label>
                <Input
                  value={formatQtdEmbalado(saldoDisponivelSemReserva)}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Estoque Final ({unidadeEmbalado})</Label>
                <Input
                  value={formatQtdEmbalado(displayEstoqueFinal)}
                  disabled
                  className={`bg-card font-medium ${estoqueInsuficiente ? "text-red-600" : "text-green-600"}`}
                />
              </div>
              {estoqueInsuficiente && (
                <p className="col-span-3 text-xs text-red-600 font-medium">
                  ⚠ Quantidade solicitada maior que o saldo disponível (
                  {formatQtdEmbalado(saldoDisponivelSemReserva)} {unidadeEmbalado})!
                </p>
              )}
              {reservaInsuficiente && (
                <p className="col-span-3 text-xs text-red-600 font-medium">
                  ⚠ Quantidade solicitada maior que o saldo da reserva (
                  {formatQtdEmbalado(dispReserva)} {unidadeEmbalado}).
                </p>
              )}
            </div>
          )}

          {/* ── VASILHAME (Transbordo + Industrialização) ── */}
          {showOrigemSelector &&
            (item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-3 sm:col-span-2">
                <Label>Produto *</Label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      value={vasilhameUnificadoSelecionado?.label || ""}
                      onChange={handleVasilhameUnificadoChange}
                      options={vasilhamesUnificados}
                      getOptionLabel={(o) => o.label || ""}
                      getOptionValue={(o) => o.id}
                      renderOption={(o, label) => (
                        <span className="inline-flex items-center gap-2">
                          <span>{label}</span>
                          {o.reservado ? <ReservadoBadge /> : null}
                        </span>
                      )}
                      placeholder={
                        hasCliente
                          ? "Selecione o vasilhame..."
                          : "Selecione o cliente primeiro..."
                      }
                      disabled={!hasCliente}
                    />
                  </div>
                  {vasilhameUnificadoSelecionado?.reservado ? <ReservadoBadge /> : null}
                </div>
              </div>
              {(item.vasilhame_id || item.container_id) && (
                <>
                  <div className="space-y-1.5">
                    <Label>Volume Disponível (L)</Label>
                    <Input
                      value={formatVolume(
                        item.tipo === TIPO_IND_VASILHAME
                          ? displayContainerVol
                          : displayVolumeDisponivel
                      )}
                      disabled
                      className="bg-card font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lote</Label>
                    <Input
                      value={item.lote || ""}
                      disabled
                      className="bg-card font-medium"
                    />
                  </div>
                </>
              )}
              {hasCliente && vasilhamesUnificados.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground">
                  Nenhum vasilhame disponível no pátio para este cliente.
                </p>
              )}
            </div>
          )}

          {/* ── CONVENCIONAL (Transbordo) ── */}
          {!showOrigemSelector && item.tipo === TIPO_CONVENCIONAL && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-3 sm:col-span-2">
                <Label>Produto *</Label>
                <SearchableSelect
                  value={item.produto_nome || ""}
                  onChange={handleProdutoVasilhameChange}
                  options={produtosVasilhame}
                  getOptionLabel={(o) => o.nome || ""}
                  getOptionValue={(o) => o.id}
                  placeholder={
                    hasCliente
                      ? "Selecione um produto com tanque no pátio..."
                      : "Selecione o cliente primeiro..."
                  }
                  disabled={!hasCliente}
                />
              </div>
              <div className="space-y-1.5 col-span-3 sm:col-span-2">
                <Label>Vasilhame *</Label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      value={vasilhameSelectValue}
                      onChange={handleVasilhameChange}
                      options={vasilhamesDoProduto}
                      getOptionLabel={vasilhameLabel}
                      getOptionValue={(v) => v.id}
                      renderOption={(v, label) => (
                        <span className="inline-flex items-center gap-2">
                          <span>{label}</span>
                          {v.reservado ? <ReservadoBadge /> : null}
                        </span>
                      )}
                      placeholder={
                        !hasCliente
                          ? "Selecione o cliente primeiro..."
                          : produtoVasilhameSelecionado
                            ? "Buscar por placa ou barril..."
                            : "Selecione o produto primeiro..."
                      }
                      disabled={!hasCliente || !produtoVasilhameSelecionado}
                    />
                  </div>
                  {vasilhamesDoProduto.find((v) => v.id === item.vasilhame_id)?.reservado ? (
                    <ReservadoBadge />
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Volume Disponível (L)</Label>
                <Input
                  value={formatVolume(displayVolumeDisponivel)}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lote</Label>
                <Input
                  value={item.lote || ""}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              {hasCliente && produtosVasilhame.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground">
                  Nenhum produto com tanque disponível no pátio para este cliente.
                </p>
              )}
            </div>
          )}

          {/* ── VASILHAME (Industrialização) ── */}
          {!showOrigemSelector && item.tipo === TIPO_IND_VASILHAME && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-3 sm:col-span-2">
                <Label>Vasilhame *</Label>
                <SearchableSelect
                  value={containerSelectValue}
                  onChange={handleContainerChange}
                  options={containersDisponiveis}
                  getOptionLabel={containerLabel}
                  getOptionValue={(c) => c.id}
                  placeholder={
                    hasCliente
                      ? "Selecione contentor, IBC, tambor, tankagem..."
                      : "Selecione o cliente primeiro..."
                  }
                  disabled={!hasCliente}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Volume Disponível (L)</Label>
                <Input
                  value={formatVolume(displayContainerVol)}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lote</Label>
                <Input
                  value={item.lote || ""}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              {hasCliente && containersDisponiveis.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground">
                  {containersInd.length === 0
                    ? "Não foi possível carregar os vasilhames da Industrialização."
                    : "Nenhum vasilhame No Pátio encontrado na Industrialização."}
                </p>
              )}
              {hasCliente &&
                containersDisponiveis.length > 0 &&
                !containersDisponiveis.some((c) =>
                  clientsMatch(c.client, clienteNome)
                ) && (
                  <p className="col-span-3 text-xs text-amber-700">
                    Nenhum vasilhame com o cliente &quot;{clienteNome}&quot;.
                    Exibindo todos os vasilhames No Pátio da Industrialização.
                  </p>
                )}
            </div>
          )}

          {/* ── RETORNO MP (Industrialização) ── */}
          {item.tipo === TIPO_IND_RETORNO_MP && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-3">
                <Label>Retorno de MP Não Aplicada *</Label>
                <SearchableSelect
                  value={retornoSelectValue}
                  onChange={handleRetornoMpChange}
                  options={retornoMpOptions}
                  getOptionLabel={(o) => o._label}
                  getOptionValue={(o) => `${o._kind}:${o.id}`}
                  placeholder={
                    hasCliente
                      ? "Selecione a movimentação fiscal..."
                      : "Selecione o cliente primeiro..."
                  }
                  disabled={!hasCliente}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Produto / MP</Label>
                <Input
                  value={item.produto_nome || ""}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Código</Label>
                <Input
                  value={item.produto_codigo || ""}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lote</Label>
                <Input
                  value={item.lote || ""}
                  disabled
                  className="bg-card font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Quantidade Solicitada ({item.unidade || "kg"}) *
                </Label>
                <NumberInputBr
                  decimals={3}
                  value={item.quantidade_solicitada || ""}
                  onChange={(v) => handleRetornoQtyChange(v === "" ? 0 : v)}
                  placeholder="0"
                  disabled={!item.stock_id && !item.movement_id}
                />
              </div>
              {item.stock_id && !item.movement_id && (
                <>
                  <div className="space-y-1.5">
                    <Label>Saldo Disponível</Label>
                    <Input
                      value={formatMass(displayStockSaldo)}
                      disabled
                      className="bg-card font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Saldo Final</Label>
                    <Input
                      value={formatMass(displayStockFinal)}
                      disabled
                      className={`bg-card font-medium ${stockInsuficiente ? "text-red-600" : "text-green-600"}`}
                    />
                  </div>
                </>
              )}
              {item.movement_id && (
                <div className="space-y-1.5 col-span-2">
                  <Label>Origem</Label>
                  <Input
                    value="Movimentação fiscal já registrada"
                    disabled
                    className="bg-card font-medium"
                  />
                </div>
              )}
              {stockInsuficiente && (
                <p className="col-span-3 text-xs text-red-600 font-medium">
                  ⚠ Quantidade maior que o saldo disponível (
                  {formatMass(displayStockSaldo)} {item.unidade || "kg"})!
                </p>
              )}
              {hasCliente && retornoMpOptions.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground">
                  Nenhuma movimentação fiscal de Retorno de MP Não Aplicada para este cliente.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
