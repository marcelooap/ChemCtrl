export function isScheduleProduced(row) {
  if (!row) return false;
  if (row.produced === true || row.produced === 'true' || row.produced === 't') return true;
  return Boolean(row.produced_at);
}

function sumVolume(items) {
  return (items || []).reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
}

export function getDayProgress(items) {
  const list = items || [];
  const producedItems = [];
  const remainingItems = [];

  for (const row of list) {
    if (isScheduleProduced(row)) producedItems.push(row);
    else remainingItems.push(row);
  }

  return {
    totalCount: list.length,
    producedCount: producedItems.length,
    remainingCount: remainingItems.length,
    totalVolume: sumVolume(list),
    producedVolume: sumVolume(producedItems),
    remainingVolume: sumVolume(remainingItems),
    allProduced: list.length > 0 && remainingItems.length === 0,
  };
}

export function buildProducedPayload(next, user) {
  return {
    produced: Boolean(next),
    produced_at: next ? new Date().toISOString() : null,
    produced_by: next
      ? (user?.nome || user?.full_name || user?.usuario || null)
      : null,
  };
}
