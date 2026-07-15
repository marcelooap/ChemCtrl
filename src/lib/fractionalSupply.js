const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
};

export const calcMassBalance = (mpList) => {
  const totalOperationQty = round3(
    mpList.reduce(
      (s, mp) =>
        s +
        mp.lots
          .filter((l) => l.stock_id)
          .reduce((ls, l) => ls + (l.qty_operational_raw ?? l.qty_operational ?? 0), 0),
      0
    )
  );
  const totalNeeded = round3(mpList.reduce((s, mp) => s + (mp.qty_needed_raw || 0), 0));
  const massDiff = round3(totalOperationQty - totalNeeded);
  return { totalOperationQty, totalNeeded, massDiff };
};

export const hasNegativeQuantities = (mpList) =>
  mpList.some((mp) =>
    mp.lots.some(
      (l) =>
        l.stock_id &&
        ((l.qty_operational_raw ?? l.qty_operational ?? 0) < 0 || (l.qty_fiscal ?? 0) < 0)
    )
  );

export const canSaveStandard = (balance, mass, mpList) =>
  Math.abs(balance.massDiff) < 0.01 && mass > 0 && !hasNegativeQuantities(mpList);

export const canSaveFractional = (balance, mass, mpList) => {
  if (mass <= 0) return false;
  if (hasNegativeQuantities(mpList)) return false;
  const { totalOperationQty, totalNeeded } = balance;
  return totalOperationQty > 0 && totalOperationQty <= totalNeeded + 0.001;
};

export const calcVolumeMetrics = (volumeOp, totalOperation, totalNeeded) => {
  const vol = parseFloat(volumeOp) || 0;
  if (totalNeeded <= 0) {
    return { volume_apontado: vol, volume_pendente: 0 };
  }
  const ratio = Math.min(1, totalOperation / totalNeeded);
  const volume_apontado = round3(vol * ratio);
  const volume_pendente = round3(vol - volume_apontado);
  return { volume_apontado, volume_pendente };
};

export const isComplementPending = (production) =>
  !!production?.fractional_supply &&
  production?.complement_status === 'Pendente' &&
  (production?.volume_pendente || 0) > 0.001;

/** Origem de transbordo com saldo residual (> 0 L). */
export const isFractionalFromTransfer = (container, transfers = []) => {
  if (!container?.id) return false;
  const vol = parseFloat(container.volume) || 0;
  if (vol <= 0.001) return false;
  if (container.status && container.status !== 'No Pátio') return false;
  if (container.is_fractional) return true;

  return (transfers || []).some((tr) => {
    const origins = parseArr(tr.origins);
    return origins.some((o) => {
      if (o.container_id !== container.id) return false;
      const remaining = parseFloat(o.remaining_stock);
      if (!Number.isNaN(remaining)) return remaining > 0.001;
      return (parseFloat(o.volume_used) || 0) > 0.001;
    });
  });
};

/** Badge "Fracionado" no vasilhame: complemento pendente ou residual de transbordo. */
export const isContainerFractional = (container, production, transfers = []) =>
  isComplementPending(production) || isFractionalFromTransfer(container, transfers);

export const buildSupplyHistoryEntry = (type, user, lots) => ({
  type,
  date: new Date().toISOString(),
  user: user || '',
  entries: lots.map((l) => ({
    mp_code: l.mp_code,
    mp_name: l.mp_name,
    lot: l.lot,
    stock_id: l.stock_id,
    qty_operational: l.qty_operational,
    qty_fiscal: l.qty_fiscal,
  })),
});

export const mpQtyNeededKg = (mp, mass, density) => {
  const vol = density > 0 ? mass / density : 0;
  if (mp.quantity_kg != null && mp.quantity_kg > 0) {
    return mp.quantity_kg * (vol / 5000);
  }
  return (mp.percentage / 100) * mass;
};

export const calcMpDeficits = (recipe, production) => {
  const rawMaterials = parseArr(recipe?.raw_materials);
  const used = parseArr(production?.raw_materials_used);
  const mass = production?.mass || (production?.volume || 0) * (production?.density || 1);
  const density = production?.density || 1;

  return rawMaterials
    .map((rm) => {
      const neededKg = mpQtyNeededKg(rm, mass, density);
      const allocatedKg = used
        .filter((u) => u.mp_code === rm.mp_code)
        .reduce((s, u) => s + (u.qty_operational || 0), 0);
      const deficitKg = round3(Math.max(0, neededKg - allocatedKg));
      if (deficitKg < 0.001) return null;
      const volEquiv = mass > 0 ? round3((deficitKg / mass) * (production?.volume || 0)) : 0;
      return {
        mp_code: rm.mp_code,
        mp_name: rm.mp_name,
        mp_density: rm.mp_density,
        percentage: rm.percentage,
        quantity_kg: rm.quantity_kg,
        qty_needed_kg: round3(neededKg),
        qty_allocated_kg: round3(allocatedKg),
        deficit_kg: deficitKg,
        deficit_volume_l: volEquiv,
        lots: [{
          stock_id: '',
          lot: '',
          qty_fiscal: deficitKg,
          qty_operational: deficitKg,
          qty_operational_raw: deficitKg,
        }],
      };
    })
    .filter(Boolean);
};

/** Merge freshly calculated deficits with existing user lot selections (preserve lots). */
export const mergeMpDeficitsPreservingLots = (freshDeficits, previousList) => {
  const prevByCode = new Map((previousList || []).map((mp) => [mp.mp_code, mp]));
  return freshDeficits.map((fresh) => {
    const prev = prevByCode.get(fresh.mp_code);
    if (!prev) return fresh;
    return {
      ...fresh,
      lots: prev.lots?.length ? prev.lots : fresh.lots,
    };
  });
};

export const flattenAllocatedLots = (mpList) =>
  mpList.flatMap((m) =>
    m.lots
      .filter((l) => l.stock_id)
      .map((l) => ({
        mp_code: m.mp_code,
        mp_name: m.mp_name,
        stock_id: l.stock_id,
        lot: l.lot,
        qty_fiscal: l.qty_fiscal,
        qty_operational: l.qty_operational,
      }))
  );

export const productionOfContainer = (container, productions) => {
  if (!container) return null;
  if (container.production_id) {
    return productions.find((p) => p.id === container.production_id) || null;
  }
  if (container.op_number) {
    return productions.find((p) => p.op_number === container.op_number) || null;
  }
  return null;
};

export const getFractionalDisplayVolume = (container, production) => {
  if (!production?.fractional_supply) return null;
  return parseFloat(production.volume_apontado) || 0;
};

/**
 * Volume físico/exibível do vasilhame.
 * Em atendimento fracionado, o envase muitas vezes grava o volume nominal da OP
 * enquanto o volume realmente apontado (massa) fica em volume_apontado (ex.: 4.993 L).
 * Nesse caso exibimos o apontado. Após transbordo/redução, containers.volume é a fonte da verdade.
 */
export const containerDisplayVolume = (container, productions) => {
  const containerVol = parseFloat(container?.volume) || 0;
  const production = productionOfContainer(container, productions);

  if (production?.fractional_supply) {
    const apontado = parseFloat(production.volume_apontado);
    const opVol = parseFloat(production.volume) || 0;
    if (Number.isFinite(apontado) && apontado > 0) {
      // Volume ainda parece o nominal da OP (não reduzido por TB/expedição)
      const storedAsOpVolume =
        opVol > 0 && Math.abs(containerVol - opVol) <= 0.51;
      if (storedAsOpVolume || containerVol <= 0) {
        return round3(apontado);
      }
    }
  }

  return containerVol;
};

export const containerDensity = (container, productions, recipes = []) => {
  const production = productionOfContainer(container, productions);
  if (production?.density) return production.density;
  const recipe = recipes.find((r) => r.product_name === container?.product);
  if (recipe?.density) return recipe.density;
  const vol = container?.volume || 0;
  if (vol > 0 && container?.net_weight) {
    return container.net_weight / vol;
  }
  return 1;
};

export const containerDisplayNetWeight = (container, productions, recipes = []) => {
  const volume = containerDisplayVolume(container, productions);
  const density = containerDensity(container, productions, recipes);
  return Math.round(volume * density);
};

export const containerDisplayGrossWeight = (container, productions, recipes = []) => {
  const net = containerDisplayNetWeight(container, productions, recipes);
  return Math.round(net + (parseFloat(container?.tare) || 0));
};
