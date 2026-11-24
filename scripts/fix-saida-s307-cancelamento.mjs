/**
 * Reaplica baixa/validação da S307 após cancelamento antigo que devolveu
 * vasilhames ao pátio. Mantém status cancelado + justificativa.
 *
 * Uso:
 *   node scripts/fix-saida-s307-cancelamento.mjs --dry-run
 *   node scripts/fix-saida-s307-cancelamento.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const CODIGO = 'S307';

function loadEnv(filePath) {
  const env = {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

const env = {
  ...loadEnv(resolve('.env')),
  ...loadEnv(resolve('.env.local')),
};
const url = (env.VITE_CHEMFLOW_SUPABASE_URL || env.VITE_SUPABASE_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const key =
  env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Configure VITE_CHEMFLOW_SUPABASE_URL/ANON_KEY no .env');
  process.exit(1);
}

const sb = createClient(url, key);

const { data: saida, error } = await sb
  .from('t_saidas')
  .select('*')
  .eq('codigo', CODIGO)
  .maybeSingle();
if (error) throw error;
if (!saida) {
  console.error(`${CODIGO} não encontrada`);
  process.exit(1);
}

const itens = Array.isArray(saida.itens) ? saida.itens : [];
const vasIds = [
  ...new Set(itens.map((it) => it.vasilhame_id).filter(Boolean).map(String)),
];

const { data: vasilhames, error: vErr } = await sb
  .from('t_vasilhames')
  .select('*')
  .in('id', vasIds);
if (vErr) throw vErr;

const vasById = new Map((vasilhames || []).map((v) => [String(v.id), v]));

// Data de saída: preferir data do cancelamento (dia local) ou hoje.
const cancelIso = saida.cancelamento_data || new Date().toISOString();
const dataSaida = String(cancelIso).slice(0, 10);

const nextItens = itens.map((item) => {
  if (item?.tipo !== 'convencional' || !item.vasilhame_id) return item;
  const v = vasById.get(String(item.vasilhame_id));
  const volDisponivel = Number(v?.volume) || 0;
  const volSolic = Number(item.volume_solicitado) || 0;
  return {
    ...item,
    validado: true,
    validado_historico: true,
    volume_disponivel: volDisponivel,
    saldo_final: Math.max(0, volDisponivel - volSolic),
  };
});

const validacaoModulos = {
  ...(saida.validacao_modulos && typeof saida.validacao_modulos === 'object'
    ? saida.validacao_modulos
    : {}),
  transbordo: {
    validado: true,
    usuario: saida.cancelamento_usuario || saida.enviado_fiscal_usuario || null,
    data: saida.cancelamento_data || new Date().toISOString(),
  },
};

const saidaPatch = {
  // Mantém cancelamento
  status: 'cancelado',
  cancelamento_justificativa: saida.cancelamento_justificativa,
  cancelamento_usuario: saida.cancelamento_usuario,
  cancelamento_data: saida.cancelamento_data,
  // Restaura validação / baixa
  enviado_ao_fiscal: true,
  enviado_fiscal_usuario:
    saida.enviado_fiscal_usuario || saida.cancelamento_usuario || null,
  enviado_fiscal_data:
    saida.enviado_fiscal_data || saida.cancelamento_data || new Date().toISOString(),
  validacao_modulos: validacaoModulos,
  itens: nextItens,
};

const vasPatches = [];
for (const item of nextItens) {
  if (item?.tipo !== 'convencional' || !item.vasilhame_id) continue;
  const v = vasById.get(String(item.vasilhame_id));
  if (!v) {
    throw new Error(`Vasilhame não encontrado: ${item.vasilhame_id}`);
  }
  const volTaken = Number(item.volume_solicitado) || 0;
  const currentVol = Number(v.volume) || 0;
  const newVol = Math.max(0, round3(currentVol - volTaken));
  const dens =
    (() => {
      const fromField =
        parseFloat(String(v.densidade || '0').replace(',', '.')) || 0;
      if (fromField > 0) return fromField;
      const vol = Number(v.volume) || 0;
      const peso = Number(v.peso_liquido) || 0;
      if (vol > 0 && peso > 0) return peso / vol;
      const iVol = Number(item.volume_solicitado) || 0;
      const iPeso =
        Number(item.peso_liquido) || Number(item.quantidade_solicitada) || 0;
      if (iVol > 0 && iPeso > 0) return iPeso / iVol;
      return 0;
    })();
  const newPesoLiq =
    dens > 0
      ? round3(newVol * dens)
      : Math.max(0, round3((Number(v.peso_liquido) || 0) - (Number(item.peso_liquido) || 0)));
  const expedir = newVol <= 0.001 || newVol < volTaken * 0.001;
  const patch = {
    id: v.id,
    volume: newVol,
    peso_liquido: newPesoLiq,
    peso_bruto: round3((Number(v.tara) || 0) + newPesoLiq),
    status: expedir ? 'Expedido' : 'No Pátio',
    data_saida: expedir ? dataSaida : null,
  };
  vasPatches.push({ before: v, patch });
}

console.log('=== SAIDA PATCH ===');
console.log({
  id: saida.id,
  codigo: saida.codigo,
  status: saidaPatch.status,
  enviado_ao_fiscal: saidaPatch.enviado_ao_fiscal,
  enviado_fiscal_usuario: saidaPatch.enviado_fiscal_usuario,
  enviado_fiscal_data: saidaPatch.enviado_fiscal_data,
  validacao_modulos: saidaPatch.validacao_modulos,
  itens: nextItens.map((it) => ({
    placa: it.vasilhame_placa,
    validado: it.validado,
    volume_solicitado: it.volume_solicitado,
    saldo_final: it.saldo_final,
  })),
});

console.log('\n=== VASILHAMES PATCH ===');
for (const { before, patch } of vasPatches) {
  console.log({
    placa: before.placa,
    before: {
      status: before.status,
      volume: before.volume,
      peso_liquido: before.peso_liquido,
      data_saida: before.data_saida,
    },
    after: patch,
  });
}

if (DRY_RUN) {
  console.log('\n[dry-run] Nenhuma alteração persistida.');
  process.exit(0);
}

for (const { patch } of vasPatches) {
  const { id, ...fields } = patch;
  const { error: uErr } = await sb
    .from('t_vasilhames')
    .update(fields)
    .eq('id', id);
  if (uErr) throw uErr;
}

const { error: sErr } = await sb
  .from('t_saidas')
  .update(saidaPatch)
  .eq('id', saida.id);
if (sErr) throw sErr;

// Recarrega e confirma
const { data: afterSaida, error: aErr } = await sb
  .from('t_saidas')
  .select(
    'codigo,status,enviado_ao_fiscal,cancelamento_justificativa,itens,validacao_modulos'
  )
  .eq('id', saida.id)
  .maybeSingle();
if (aErr) throw aErr;

const { data: afterVas, error: avErr } = await sb
  .from('t_vasilhames')
  .select('id,placa,status,volume,peso_liquido,data_saida')
  .in('id', vasIds);
if (avErr) throw avErr;

console.log('\n=== CONFIRM SAIDA ===');
console.log({
  codigo: afterSaida.codigo,
  status: afterSaida.status,
  enviado_ao_fiscal: afterSaida.enviado_ao_fiscal,
  cancelamento_justificativa: afterSaida.cancelamento_justificativa,
  validacao_modulos: afterSaida.validacao_modulos,
  itens_validados: (afterSaida.itens || []).map((it) => ({
    placa: it.vasilhame_placa,
    validado: it.validado,
  })),
});
console.log('\n=== CONFIRM VASILHAMES ===');
console.log(afterVas);

console.log('\nOK: S307 — validação/baixa reaplicadas; cancelamento preservado.');
