import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import ProductCombobox from '@shared/components/ui/ProductCombobox';
import { fmtDate, fmtVolume } from '@/i18n/formatters';
import { getLatestRecipeForProduct, getLatestRecipes } from '@industrializacao/lib/recipeRevisions';
import {
  getOrderAllocatableVolume,
  isOrderOpenForProgramming,
} from '@industrializacao/lib/orderProductionStatus';

function sameProduct(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function formatVolumeInput(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Number(n.toFixed(3)));
}

function getScheduledOrderIds(schedules, exceptScheduleId) {
  const ids = new Set();
  for (const row of schedules || []) {
    if (!row?.order_id) continue;
    if (exceptScheduleId && String(row.id) === String(exceptScheduleId)) continue;
    ids.add(String(row.order_id));
  }
  return ids;
}

export default function ProgramacaoFormDialog({
  open,
  onOpenChange,
  dateIso,
  editing,
  recipes,
  orders = [],
  schedules = [],
  saving,
  onSave,
}) {
  const { t } = useTranslation();
  const [product, setProduct] = useState('');
  const [orderId, setOrderId] = useState('');
  const [client, setClient] = useState('');
  const [volume, setVolume] = useState('');

  const productOptions = useMemo(
    () => getLatestRecipes(recipes).map((r) => ({
      value: r.product_name,
      label: r.product_name,
    })),
    [recipes]
  );

  const scheduledOrderIds = useMemo(
    () => getScheduledOrderIds(schedules, editing?.id),
    [schedules, editing?.id]
  );

  const eligibleOrders = useMemo(() => {
    if (!product) return [];
    return (orders || []).filter(
      (order) =>
        sameProduct(order.product, product)
        && isOrderOpenForProgramming(order)
        && !scheduledOrderIds.has(String(order.id))
    );
  }, [orders, product, scheduledOrderIds]);

  const orderOptions = useMemo(() => {
    const list = [...eligibleOrders];
    if (orderId && !list.some((o) => String(o.id) === String(orderId))) {
      const current = (orders || []).find((o) => String(o.id) === String(orderId));
      if (current) list.unshift(current);
    }
    return list;
  }, [eligibleOrders, orders, orderId]);

  const productPendingVolume = useMemo(
    () => eligibleOrders.reduce((sum, order) => sum + getOrderAllocatableVolume(order), 0),
    [eligibleOrders]
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setProduct(editing.product || '');
      setOrderId(editing.order_id || '');
      setClient(editing.client || '');
      setVolume(editing.volume != null ? String(editing.volume) : '');
      return;
    }
    setProduct('');
    setOrderId('');
    setClient('');
    setVolume('');
  }, [open, editing]);

  const applyProductDefaults = (productName, selectedOrder = null) => {
    const recipe = getLatestRecipeForProduct(recipes, productName);
    const matches = (orders || []).filter(
      (order) =>
        sameProduct(order.product, productName)
        && isOrderOpenForProgramming(order)
        && !scheduledOrderIds.has(String(order.id))
    );
    const onlyOrder = matches.length === 1 ? matches[0] : selectedOrder;
    const pendingTotal = matches.reduce((sum, order) => sum + getOrderAllocatableVolume(order), 0);
    const orderVolume = onlyOrder ? getOrderAllocatableVolume(onlyOrder) : 0;

    setProduct(productName);
    setOrderId(onlyOrder?.id || '');
    setClient(recipe?.client || onlyOrder?.client || '');
    setVolume(formatVolumeInput(onlyOrder ? orderVolume : pendingTotal));
  };

  const handleProductChange = (productName) => {
    applyProductDefaults(productName);
  };

  const handleOrderChange = (nextOrderId) => {
    const order = orderOptions.find((o) => String(o.id) === String(nextOrderId));
    setOrderId(nextOrderId);
    if (!order) return;
    if (order.client) setClient(order.client);
    setVolume(formatVolumeInput(getOrderAllocatableVolume(order)));
  };

  const handleSubmit = () => {
    onSave({
      product: (product || '').trim(),
      client: (client || '').trim(),
      volume,
      scheduled_date: dateIso,
      order_id: orderId || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('programming.form.editTitle') : t('programming.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('programming.form.date')}
            </p>
            <Input value={dateIso ? fmtDate(dateIso) : ''} readOnly className="bg-muted/50" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('programming.form.product')} *
            </p>
            <ProductCombobox
              value={product}
              onChange={handleProductChange}
              options={productOptions}
              placeholder={t('programming.form.productPlaceholder')}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('programming.form.order')}
            </p>
            <Select
              value={orderId || undefined}
              onValueChange={handleOrderChange}
              disabled={!product || orderOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !product
                      ? t('programming.form.orderPlaceholder')
                      : orderOptions.length === 0
                        ? t('programming.form.noOrders')
                        : t('programming.form.orderPlaceholder')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {orderOptions.map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.order_number || order.id}
                    {' · '}
                    {fmtVolume(getOrderAllocatableVolume(order))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('programming.form.client')}
            </p>
            <Input value={client} readOnly className="bg-muted/50" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('programming.form.volume')} *
            </p>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder={t('programming.form.volumePlaceholder')}
            />
            {product && productPendingVolume > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('programming.form.pendingHint', { volume: fmtVolume(productPendingVolume) })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('buttons.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="text-white"
            style={{ background: '#2575D1' }}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.saving')}
              </>
            ) : editing ? t('programming.form.saveChanges') : t('programming.form.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
