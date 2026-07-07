const parseArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return [];
};

const norm = (v) => (v == null ? '' : String(v)).trim().toLowerCase();

const toDate = (v) => (v ? new Date(v) : null);

/**
 * Consolidates every record related to a physical vasilhame across all tables
 * (Container, Production, Transfer) into chronological CYCLES.
 *
 * A cycle = one utilization of the vasilhame (one Container record tied to one OP).
 * The same physical vasilhame (container_number + barril_number) reused in
 * multiple OPs produces multiple cycles, ordered most-recent first.
 *
 * Each cycle: { header, production, events[] }
 * Each event: { date, type, kind, fields, extra }
 */
export function buildContainerCycles(selected, allContainers = [], transfers = [], productions = [], recipes = []) {
  if (!selected || !allContainers) return [];
  const cn = norm(selected.container_number);
  const bn = norm(selected.barril_number);
  if (!cn) return [];

  // All container records of the same physical vasilhame = one cycle each
  const cycleContainers = allContainers.filter(c =>
    norm(c.container_number) === cn && norm(c.barril_number) === bn
  );

  const cycles = cycleContainers.map(c => buildCycle(c, transfers, productions, recipes));
  cycles.sort((a, b) => (b.startDate?.getTime() || 0) - (a.startDate?.getTime() || 0));
  return cycles;
}

function buildCycle(container, transfers, productions, recipes) {
  const recipe = (recipes || []).find(r => r.product_name === container.product);
  const code = recipe?.code || container.product;
  const production = (productions || []).find(p =>
    (container.production_id && p.id === container.production_id) ||
    (container.op_number && p.op_number === container.op_number)
  );
  const prodRecipe = production ? (recipes || []).find(r => r.product_name === production.product) : recipe;

  const events = [];

  // Origin of this container — was it created via transbordo?
  const incomingTransfer = (container.op_number && container.op_number.startsWith('TB'))
    ? (transfers || []).find(t => t.transfer_number === container.op_number)
    : null;

  // 1. First event: Produção / Registro / Transbordo de Entrada
  if (production) {
    events.push({
      date: toDate(production.date) || toDate(container.created_date),
      type: 'Produção',
      kind: 'producao',
      fields: {
        'Nº da OP': production.op_number,
        'Produto': production.product,
        'Código do Produto': prodRecipe?.code,
        'Cliente': production.client,
        'Lote': production.lot,
        'Volume Produzido (L)': production.volume,
        'Massa Produzida (kg)': production.mass,
        'Densidade': production.density,
        'Status': production.status,
        'Prioridade': production.priority,
        'Embalagem de Destino': production.packaging_type,
        'Pedido Cliente': production.client_order,
        'Operador': production.operator,
        'Analista CQ': production.qc_analyst,
        'Status CQ': production.qc_status,
        'Início': production.start_time,
        'Fim': production.end_time,
        'Observações': production.observations,
      },
      extra: { raw_materials: parseArr(production.raw_materials_used) },
    });
  } else if (incomingTransfer) {
    const origins = parseArr(incomingTransfer.origins);
    const dests = parseArr(incomingTransfer.destinations);
    const destEntry = dests.find(d => d.placa === container.container_number) || dests[0] || {};
    events.push({
      date: toDate(incomingTransfer.date) || toDate(container.created_date),
      type: 'Transbordo de Entrada',
      kind: 'transbordo',
      fields: {
        'Nº Transbordo': incomingTransfer.transfer_number,
        'Produto': incomingTransfer.product,
        'Código do Produto': code,
        'Cliente': incomingTransfer.client,
        'Lote': container.lot,
        'Volume Recebido (L)': destEntry.volume ?? container.volume,
        'Massa (kg)': destEntry.mass,
        'Tipo Embalagem': destEntry.packaging_type,
        'Tara (kg)': destEntry.tare,
        'Peso Líquido (kg)': destEntry.net_weight,
        'Peso Bruto (kg)': destEntry.gross_weight,
        'Lacres': destEntry.seals,
        'Eslinga': destEntry.sling,
        'Operador': incomingTransfer.operator,
        'Origens': origins.map(o => `${o.container_number || ''}${o.barril_number ? ' / ' + o.barril_number : ''}`).join(', '),
        'Observações': incomingTransfer.observations,
      },
    });
  } else {
    // Manual registration (Adicionar Tanque)
    events.push({
      date: toDate(container.created_date),
      type: 'Registro no Sistema',
      kind: 'registro',
      fields: {
        'Produto': container.product,
        'Código do Produto': code,
        'Cliente': container.client,
        'Lote': container.lot,
        'Volume (L)': container.volume,
        'Densidade (g/mL)': recipe?.density,
        'Nº Placa': container.container_number,
        'Nº Barril': container.barril_number,
        'Tipo': container.type,
        'Tara (kg)': container.tare,
        'Peso Líquido (kg)': container.net_weight,
        'Peso Bruto (kg)': container.gross_weight,
        'Responsável': container.operator,
        'Origem do Cadastro': 'Manual (Adicionar Tanque)',
      },
    });
  }

  // 2. Transbordos de Saída — this container was the source of a transfer
  const outgoingTransfers = (transfers || []).filter(t =>
    parseArr(t.origins).some(o => o.container_id === container.id)
  );
  outgoingTransfers.forEach(t => {
    const originEntry = parseArr(t.origins).find(o => o.container_id === container.id) || {};
    const dests = parseArr(t.destinations);
    const isExpedicao = t.destination_type === 'Expedição';
    events.push({
      date: toDate(t.date),
      type: isExpedicao ? 'Expedição (via Transbordo)' : 'Transbordo',
      kind: isExpedicao ? 'expedicao' : 'transbordo',
      fields: {
        'Nº do Registro': t.transfer_number,
        'Data/Hora': t.date,
        'Tipo': t.destination_type,
        'Produto': t.product,
        'Cliente': t.client,
        'Volume Transferido (L)': originEntry.volume_used,
        'Saldo Restante (L)': originEntry.remaining_stock,
        'Massa Total (kg)': t.mass,
        'Destino(s)': dests.map(d => `${d.placa || ''}${d.barril ? ' / ' + d.barril : ''}`).join(', '),
        'Tipo Embalagem': dests[0]?.packaging_type,
        'Motorista': t.driver || dests[0]?.driver,
        'Lacres': t.seals || dests[0]?.seals,
        'Eslinga': t.sling || dests[0]?.sling,
        'GPS': t.gps || dests[0]?.gps,
        'Operador': t.operator,
        'Observações': t.observations,
      },
    });
  });

  // 3. Saída / Expedição direta (departure_date set on container)
  if (container.departure_date) {
    const hasExpedicaoTransfer = outgoingTransfers.some(t => t.destination_type === 'Expedição');
    if (!hasExpedicaoTransfer) {
      events.push({
        date: toDate(container.departure_date),
        type: 'Saída do Vasilhame',
        kind: 'saida',
        fields: {
          'Data/Hora da Saída': container.departure_date,
          'Situação': container.status,
          'Produto': container.product,
          'Cliente': container.client,
          'Nº Placa': container.container_number,
          'Nº Barril': container.barril_number,
          'Volume Expedido (L)': container.volume,
          'Peso Líquido (kg)': container.net_weight,
          'Peso Bruto (kg)': container.gross_weight,
          'Lacres': container.seals,
          'Eslinga': container.sling,
          'GPS': container.gps,
          'Responsável': container.operator,
          'Observações': container.observations,
        },
      });
    }
  }

  // Sort events chronologically (earliest first within the cycle)
  events.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  // Cycle dates
  const startDate = events.length ? events[0].date : toDate(container.created_date);
  const endDate = toDate(container.departure_date);
  const status = container.departure_date ? 'Finalizado' : 'Em andamento';

  return {
    containerId: container.id,
    header: {
      op: container.op_number || 'Manual',
      product: container.product,
      code,
      client: container.client,
      lot: container.lot,
      manufactureDate: production ? toDate(production.date) : toDate(container.created_date),
      startDate,
      endDate,
      status,
    },
    production: {
      container,
      production,
      recipe,
      prodRecipe,
    },
    events,
  };
}
