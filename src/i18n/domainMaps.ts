import i18n from './index';

export const PRODUCTION_STATUS_KEYS: Record<string, string> = {
  'Aguardando Início': 'production.status.waitingStart',
  'Em Produção': 'production.status.inProgress',
  Qualidade: 'production.status.quality',
  Envase: 'production.status.packaging',
  Finalizado: 'production.status.finished',
  Cancelado: 'production.status.cancelled',
};

export const ROLE_KEYS: Record<string, string> = {
  Administrador: 'users.roles.administrator',
  Supervisor: 'users.roles.supervisor',
  Operacional: 'users.roles.operational',
  Visualização: 'users.roles.viewOnly',
  'Cliente Externo': 'users.roles.externalClient',
};

export const USER_STATUS_KEYS: Record<string, string> = {
  Ativo: 'users.status.active',
  Inativo: 'users.status.inactive',
};

export const PACKAGING_TYPE_KEYS: Record<string, string> = {
  Contentor: 'packaging.container',
  'IBC – 1.000 L': 'packaging.ibc1000',
  'Tambor 200 L': 'packaging.drum200',
  Tankagem: 'packaging.tank',
};

export const CONTAINER_EVENT_KEYS: Record<string, string> = {
  Produção: 'containers.events.production',
  Transbordo: 'containers.events.transfer',
  Expedição: 'containers.events.shipping',
  Envase: 'containers.events.packaging',
  Retorno: 'containers.events.return',
};

export const INVENTORY_STATUS_KEYS: Record<string, string> = {
  Aberto: 'inventory.status.open',
  'Em andamento': 'inventory.status.inProgressDb',
  Finalizado: 'inventory.status.finishedDb',
};

export const STOCK_EXPIRY_STATUS_KEYS: Record<string, string> = {
  Vencido: 'clients.expiryStatus.expired',
  Válido: 'clients.expiryStatus.valid',
};

export const CONTAINER_STATUS_KEYS: Record<string, string> = {
  'No Pátio': 'containers.status.inYard',
  Expedido: 'containers.status.shipped',
};

export const STOCK_DESTINATION_KEYS: Record<string, string> = {
  'Perda em Processo': 'rawMaterialStock.destinations.processLoss',
  'Retorno de MP Não Aplicada': 'rawMaterialStock.destinations.unusedReturn',
};

export const TRANSFER_TYPE_KEYS: Record<string, string> = {
  Transbordo: 'transfer.destination.transfer',
  Expedição: 'transfer.destination.shipping',
};

export const EQUIPMENT_TYPE_KEYS: Record<string, string> = {
  Balança: 'quality.equipment.types.scale',
  pHmetro: 'quality.equipment.types.phMeter',
  Termômetro: 'quality.equipment.types.thermometer',
  Viscosímetro: 'quality.equipment.types.viscometer',
  Estufa: 'quality.equipment.types.oven',
  Mufla: 'quality.equipment.types.muffle',
  Agitador: 'quality.equipment.types.stirrer',
  Colorímetro: 'quality.equipment.types.colorimeter',
  Espectrofotômetro: 'quality.equipment.types.spectrophotometer',
  Densímetro: 'quality.equipment.types.densimeter',
  Refratômetro: 'quality.equipment.types.refractometer',
  Condutivímetro: 'quality.equipment.types.conductivityMeter',
  Titulador: 'quality.equipment.types.titulator',
  Microscópio: 'quality.equipment.types.microscope',
  Outro: 'quality.equipment.types.other',
};

export const EQUIPMENT_CALIBRATION_STATUS_KEYS: Record<string, string> = {
  sem_data: 'quality.equipment.calibrationStatus.noDate',
  vencido: 'quality.equipment.calibrationStatus.expired',
  vencer: 'quality.equipment.calibrationStatus.dueSoon',
  conforme: 'quality.equipment.calibrationStatus.compliant',
};

export const CYCLE_STATUS_KEYS: Record<string, string> = {
  'Encerrado p/ Transbordo': 'containers.cycleCard.closedByTransfer',
  Finalizado: 'production.status.finished',
  'Em andamento': 'containers.cycleCard.inProgress',
};

export const PRIORITY_KEYS: Record<string, string> = {
  Baixa: 'common.low',
  Média: 'common.medium',
  Alta: 'common.high',
};

export const ORDER_STATUS_KEYS: Record<string, string> = {
  Pendente: 'orders.status.pending',
  'Em produção': 'orders.status.inProduction',
  Finalizado: 'orders.status.finished',
  Parcial: 'orders.status.partial',
  Atrasado: 'orders.status.late',
};

export const QC_STATUS_KEYS: Record<string, string> = {
  Aprovado: 'quality.fields.approved',
  Reprovado: 'quality.fields.rejected',
  'Com Restrição': 'quality.fields.restricted',
  Pendente: 'quality.fields.pending',
};

export const USER_TYPE_KEYS: Record<string, string> = {
  interno: 'users.types.internal',
  externo: 'users.types.external',
};

export function translateDomainValue(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = '—'
): string {
  if (!value) return fallback;
  const key = map[value];
  if (!key) return value;
  return i18n.t(key, { defaultValue: value });
}

export function translateProductionStatus(status: string | null | undefined): string {
  return translateDomainValue(PRODUCTION_STATUS_KEYS, status);
}

export function translateRole(role: string | null | undefined): string {
  return translateDomainValue(ROLE_KEYS, role);
}

export function translateUserStatus(status: string | null | undefined): string {
  return translateDomainValue(USER_STATUS_KEYS, status);
}

export function translateUserType(type: string | null | undefined): string {
  return translateDomainValue(USER_TYPE_KEYS, type);
}

export function translatePackagingType(type: string | null | undefined): string {
  return translateDomainValue(PACKAGING_TYPE_KEYS, type);
}

export function translateContainerEvent(event: string | null | undefined): string {
  return translateDomainValue(CONTAINER_EVENT_KEYS, event);
}

export function translateInventoryStatus(status: string | null | undefined): string {
  return translateDomainValue(INVENTORY_STATUS_KEYS, status);
}

export function translateStockExpiryStatus(status: string | null | undefined): string {
  return translateDomainValue(STOCK_EXPIRY_STATUS_KEYS, status);
}

export function translateContainerStatus(status: string | null | undefined): string {
  return translateDomainValue(CONTAINER_STATUS_KEYS, status);
}

export function translatePriority(priority: string | null | undefined): string {
  return translateDomainValue(PRIORITY_KEYS, priority);
}

export function translateOrderStatus(status: string | null | undefined): string {
  return translateDomainValue(ORDER_STATUS_KEYS, status, translateProductionStatus(status));
}

export function translateStockDestination(destination: string | null | undefined): string {
  return translateDomainValue(STOCK_DESTINATION_KEYS, destination);
}

export function translateTransferType(type: string | null | undefined): string {
  return translateDomainValue(TRANSFER_TYPE_KEYS, type);
}

export function translateEquipmentType(type: string | null | undefined): string {
  return translateDomainValue(EQUIPMENT_TYPE_KEYS, type);
}

export function translateEquipmentCalibrationStatus(key: string | null | undefined): string {
  return translateDomainValue(EQUIPMENT_CALIBRATION_STATUS_KEYS, key);
}

export function translateCycleStatus(status: string | null | undefined): string {
  return translateDomainValue(CYCLE_STATUS_KEYS, status);
}

export function translateQcStatus(status: string | null | undefined): string {
  return translateDomainValue(QC_STATUS_KEYS, status);
}

export function translateCalibrationDueLabel(days: number | null): string {
  if (days === null) return i18n.t('quality.equipment.calibrationStatus.noDate');
  if (days < 0) return i18n.t('quality.equipment.calibrationStatus.expiredDaysAgo', { days: Math.abs(days) });
  return i18n.t('quality.equipment.calibrationStatus.inDays', { days });
}
