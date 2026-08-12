/**
 * Resolve colisão OP121:
 * - F656 (produção antiga) → novo op_number único
 * - Atualiza vasilhame + composição vinculados
 * - Mantém PROCHINOR TL 93 como OP121 em Envase
 *
 * Uso: node scripts/fix-op121-rename-f656.mjs
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

const F656_ID = 'a8f723a5-c0c4-41af-96de-ec4506aadd82';
const PROCHINOR_ID = '12043c58-af36-4106-816e-545c14a15ec4';

function opNum(op) {
  const m = String(op || '').match(/^OP(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

const { data: allOps, error: listErr } = await sb
  .from('ind_lista_producoes')
  .select('id,op_number,product,lot,status')
  .order('created_date', { ascending: false })
  .limit(1000);

if (listErr) {
  console.error(listErr);
  process.exit(1);
}

const used = new Set((allOps || []).map((p) => String(p.op_number || '').toUpperCase()));
let max = 0;
for (const p of allOps || []) {
  const n = opNum(p.op_number);
  if (n > max) max = n;
}
let next = max + 1;
while (used.has(`OP${next}`)) next += 1;
const newOp = `OP${next}`;

const f656 = (allOps || []).find((p) => p.id === F656_ID);
const prochinor = (allOps || []).find((p) => p.id === PROCHINOR_ID);
console.log('F656 atual:', f656);
console.log('PROCHINOR atual:', prochinor);
console.log('Novo número F656:', newOp);

if (!f656) {
  console.error('F656 não encontrada');
  process.exit(1);
}
if (f656.op_number !== 'OP121') {
  console.log('F656 já não é OP121 — nada a renomear na produção.');
} else {
  const { data: updProd, error: updErr } = await sb
    .from('ind_lista_producoes')
    .update({ op_number: newOp, updated_date: new Date().toISOString() })
    .eq('id', F656_ID)
    .select('id,op_number,product,lot,status')
    .single();
  if (updErr) {
    console.error('Falha ao renomear produção F656', updErr);
    process.exit(1);
  }
  console.log('Produção F656:', updProd);
}

const { data: containers, error: cErr } = await sb
  .from('ind_lista_vasilhames')
  .select('id,op_number,production_id,container_number,volume')
  .eq('production_id', F656_ID);
if (cErr) {
  console.error(cErr);
  process.exit(1);
}
for (const c of containers || []) {
  const { error } = await sb
    .from('ind_lista_vasilhames')
    .update({ op_number: newOp })
    .eq('id', c.id);
  if (error) {
    console.error('Falha vasilhame', c.id, error);
    process.exit(1);
  }
  console.log('Vasilhame atualizado:', c.container_number, c.op_number, '→', newOp);
}

const { data: origins, error: oErr } = await sb
  .from('ind_composicao_vasilhame')
  .select('id,op_number,production_id,container_id')
  .eq('production_id', F656_ID);
if (oErr) {
  console.error(oErr);
  process.exit(1);
}
for (const o of origins || []) {
  const { error } = await sb
    .from('ind_composicao_vasilhame')
    .update({ op_number: newOp })
    .eq('id', o.id);
  if (error) {
    console.error('Falha origem', o.id, error);
    process.exit(1);
  }
  console.log('Origem atualizada:', o.id, o.op_number, '→', newOp);
}

// Checklists (se existirem)
const { data: checks } = await sb
  .from('ind_checklist_op')
  .select('id,op_number')
  .eq('production_id', F656_ID);
for (const row of checks || []) {
  if (row.op_number === 'OP121') {
    await sb.from('ind_checklist_op').update({ op_number: newOp }).eq('id', row.id);
  }
}

// Garante PROCHINOR em Envase
const { data: p2, error: p2Err } = await sb
  .from('ind_lista_producoes')
  .update({
    status: 'Envase',
    end_time: null,
    updated_date: new Date().toISOString(),
  })
  .eq('id', PROCHINOR_ID)
  .select('id,op_number,product,lot,status,end_time')
  .single();
if (p2Err) {
  console.error('Falha ao garantir Envase no PROCHINOR', p2Err);
  process.exit(1);
}

const { data: remaining } = await sb
  .from('ind_lista_producoes')
  .select('id,op_number,product,lot,status')
  .eq('op_number', 'OP121');
const { data: byOpCont } = await sb
  .from('ind_lista_vasilhames')
  .select('id,op_number,production_id,container_number,volume,product')
  .eq('op_number', 'OP121');

console.log('Produções ainda OP121:', remaining);
console.log('Vasilhames ainda OP121:', byOpCont);
console.log('PROCHINOR:', p2);
console.log('OK');
