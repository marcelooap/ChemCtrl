/** Classifica o tipo de vasilhame para KPIs e relatórios. */
export function getContainerTypeCategory(type) {
  const t = (type || '').trim().toLowerCase();
  if (!t) return 'other';
  if (t.includes('ibc')) return 'ibc';
  if (t.includes('tambor')) return 'drum';
  if (t === 'contentor') return 'contentor';
  if (t.includes('bombona')) return 'canister';
  if (t.includes('tankagem')) return 'tank';
  return 'other';
}

/** Resumo de vasilhames no pátio com contagem por categoria (sem sobreposição). */
export function summarizePatioContainers(containers) {
  const summary = {
    total: containers.length,
    distinctProducts: new Set(containers.map((c) => c.product).filter(Boolean)).size,
    totalVolume: containers.reduce((s, c) => s + (c.volume || 0), 0),
    ibc: 0,
    contentor: 0,
    canister: 0,
    drum: 0,
    tank: 0,
    other: 0,
  };

  for (const c of containers) {
    summary[getContainerTypeCategory(c.type)]++;
  }

  return summary;
}
