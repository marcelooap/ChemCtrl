import i18n from '@/i18n';
import { createNotificationRpc } from '../api/notificationApi';
import { EVENT_TEMPLATE_CONFIG, getNotificationText } from '../constants';
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

  const template = EVENT_TEMPLATE_CONFIG[event];
  const opNumber = production.op_number || '—';
  const entityId = production.id;
  const { title, message } = getNotificationText(i18n.t.bind(i18n), event, opNumber);

  return {
    title,
    message,
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
