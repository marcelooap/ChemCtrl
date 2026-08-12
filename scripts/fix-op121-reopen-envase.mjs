/**
 * Reabre OP121 (PROCHINOR TL 93) para Envase — sem vasilhame próprio.
 * O vasilhame OP121 existente pertence à produção antiga (RO SC F656).
 *
 * Uso: node scripts/fix-op121-reopen-envase.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const clientSrc = readFileSync(
  resolve('src/modules/industrializacao/api/supabaseClient.js'),
  'utf8',
);
const url = clientSrc.match(/const supabaseUrl = '([^']+)'/)?.[1];
const anonKey = clientSrc.match(/const supabaseAnonKey = '([^']+)'/)?.[1];
const sb = createClient(url, anonKey, { auth: { persistSession: false } });

const PRODUCTION_ID = '12043c58-af36-4106-816e-545c14a15ec4';
const ORDER_ID = 'e8afae56-d5cc-4877-a2e4-39021e1ba9cf';

const { data: prod, error: prodErr } = await sb
  .from('ind_lista_producoes')
  .select('id,op_number,product,lot,status,volume,end_time')
  .eq('id', PRODUCTION_ID)
  .single();

if (prodErr || !prod) {
  console.error('Produção não encontrada', prodErr);
  process.exit(1);
}

console.log('Antes:', prod);

const { data: ownContainers, error: cErr } = await sb
  .from('ind_lista_vasilhames')
  .select('id,production_id,op_number,container_number,volume')
  .eq('production_id', PRODUCTION_ID);

if (cErr) {
  console.error('Erro ao buscar vasilhames', cErr);
  process.exit(1);
}

if ((ownContainers || []).length > 0) {
  console.error('Abortado: produção já tem vasilhame próprio', ownContainers);
  process.exit(1);
}

const { data: updated, error: updErr } = await sb
  .from('ind_lista_producoes')
  .update({
    status: 'Envase',
    end_time: null,
    updated_date: new Date().toISOString(),
  })
  .eq('id', PRODUCTION_ID)
  .eq('op_number', 'OP121')
  .select('id,op_number,product,lot,status,end_time')
  .single();

if (updErr) {
  console.error('Falha ao reabrir OP', updErr);
  process.exit(1);
}
console.log('Depois:', updated);

const { data: linked } = await sb
  .from('ind_lista_producoes')
  .select('id,status,volume')
  .eq('order_id', ORDER_ID);

const finishedVol = (linked || [])
  .filter((p) => p.status === 'Finalizado')
  .reduce((s, p) => s + (Number(p.volume) || 0), 0);
const hasOpen = (linked || []).some((p) => !['Finalizado', 'Cancelado'].includes(p.status));

const { data: order } = await sb
  .from('ind_lista_pedidos')
  .select('id,volume_ordered,status,volume_produced,volume_pending')
  .eq('id', ORDER_ID)
  .single();

const ordered = Number(order?.volume_ordered) || 0;
const pending = Math.max(0, ordered - finishedVol);
const status =
  ordered > 0 && finishedVol >= ordered - 0.05
    ? 'Finalizado'
    : hasOpen
      ? 'Em produção'
      : 'Pendente';

const { data: orderUpdated, error: orderErr } = await sb
  .from('ind_lista_pedidos')
  .update({
    volume_produced: finishedVol,
    volume_pending: pending,
    status,
    updated_date: new Date().toISOString(),
  })
  .eq('id', ORDER_ID)
  .select('id,status,volume_ordered,volume_produced,volume_pending')
  .single();

if (orderErr) {
  console.error('OP reaberta, mas falha ao sincronizar pedido', orderErr);
  process.exit(1);
}

console.log('Pedido:', orderUpdated);
console.log('OK — OP121 PROCHINOR TL 93 está em Envase. Abra Registrar Envase para ver o formulário.');
