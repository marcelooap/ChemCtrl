import { createNotificationRpc } from '../api/notificationApi';
import { EVENT_TEMPLATES } from '../constants';
import type {
  CreateNotificationInput,
  NotificationEvent,
  ProductionNotificationPayload,
} from '../types';

function buildProductionInput(
  event: NotificationEvent,
  production: ProductionNotificationPayload
): CreateNotificationInput | null {
  const client = production.client?.trim();
  if (!client) return null;

  const template = EVENT_TEMPLATES[event];
  const opNumber = production.op_number || '—';
  const entityId = production.id;

  return {
    title: template.title,
    message: template.message(opNumber),
    type: template.type,
    priority: 'normal',
    event,
    entity_type: 'production',
    entity_id: entityId,
    related_op: production.op_number ?? null,
    related_table: 'productions',
    action_url: template.actionUrlInternal(entityId),
    client,
  };
}

async function emit(input: CreateNotificationInput): Promise<void> {
  try {
    const result = await createNotificationRpc(input);
    if (!result?.success) {
      console.warn('[NotificationService] Falha ao criar notificação:', result?.error);
    }
  } catch (err) {
    console.warn('[NotificationService] Erro ao criar notificação:', err);
  }
}

export const NotificationService = {
  async emit(event: NotificationEvent, production: ProductionNotificationPayload) {
    const input = buildProductionInput(event, production);
    if (!input) return;
    await emit(input);
  },

  async productionCreated(production: ProductionNotificationPayload) {
    await this.emit('production_created', production);
  },

  async productionFinished(production: ProductionNotificationPayload) {
    await this.emit('production_finished', production);
  },

  async cqReleased(production: ProductionNotificationPayload) {
    await this.emit('cq_released', production);
  },

  async fillingFinished(production: ProductionNotificationPayload) {
    await this.emit('filling_finished', production);
  },
};
