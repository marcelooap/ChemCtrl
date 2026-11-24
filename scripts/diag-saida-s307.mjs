/**
 * Diagnóstico da saída S307 (cancelamento vs pátio/estoque).
 * Uso: node scripts/diag-saida-s307.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const { data: saidas, error } = await sb
  .from('t_saidas')
  .select('*')
  .ilike('codigo', 'S307')
  .limit(5);
if (error) throw error;
if (!saidas?.length) {
  console.error('S307 não encontrada');
  process.exit(1);
}

for (const saida of saidas) {
  console.log('=== SAIDA ===');
  console.log({
    id: saida.id,
    codigo: saida.codigo,
    status: saida.status,
    enviado_ao_fiscal: saida.enviado_ao_fiscal,
    enviado_fiscal_usuario: saida.enviado_fiscal_usuario,
    enviado_fiscal_data: saida.enviado_fiscal_data,
    data_programada: saida.data_programada,
    cancelamento_justificativa: saida.cancelamento_justificativa,
    cancelamento_usuario: saida.cancelamento_usuario,
    cancelamento_data: saida.cancelamento_data,
    validacao_modulos: saida.validacao_modulos,
    cliente_nome: saida.cliente_nome,
    quantidade_total: saida.quantidade_total,
  });

  const itens = Array.isArray(saida.itens) ? saida.itens : [];
  console.log(`\n=== ITENS (${itens.length}) ===`);
  for (const [i, item] of itens.entries()) {
    console.log(`#${i}`, {
      tipo: item.tipo,
      origem: item.origem,
      produto_nome: item.produto_nome,
      produto_codigo: item.produto_codigo,
      lote: item.lote,
      validado: item.validado,
      validado_historico: item.validado_historico,
      vasilhame_id: item.vasilhame_id,
      vasilhame_placa: item.vasilhame_placa,
      vasilhame_barril: item.vasilhame_barril,
      container_id: item.container_id,
      entrada_id: item.entrada_id,
      quantidade_solicitada: item.quantidade_solicitada,
      quantidade_carregada: item.quantidade_carregada,
      volume_solicitado: item.volume_solicitado,
      peso_liquido: item.peso_liquido,
      tanque_vazio: item.tanque_vazio,
      reserva_id: item.reserva_id,
    });
  }

  const vasIds = [
    ...new Set(
      itens
        .map((it) => it.vasilhame_id)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const contIds = [
    ...new Set(
      itens
        .map((it) => it.container_id)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const estIds = [
    ...new Set(
      itens
        .map((it) => it.entrada_id)
        .filter(Boolean)
        .map(String)
    ),
  ];

  if (vasIds.length) {
    const { data: vas, error: vErr } = await sb
      .from('t_vasilhames')
      .select(
        'id,placa,barril,status,volume,peso_liquido,data_saida,produto_nome,lote'
      )
      .in('id', vasIds);
    if (vErr) throw vErr;
    console.log('\n=== VASILHAMES ===');
    console.log(vas);
  }

  if (contIds.length) {
    const { data: conts, error: cErr } = await sb
      .from('containers')
      .select('id,container_number,status,volume,departure_date,product_name')
      .in('id', contIds);
    if (cErr) {
      console.log('\n=== CONTAINERS (erro) ===', cErr.message);
    } else {
      console.log('\n=== CONTAINERS ===');
      console.log(conts);
    }
  }

  if (estIds.length) {
    const { data: est, error: eErr } = await sb
      .from('t_estoque')
      .select(
        'id,codigo,produto_nome,lote,quantidade,saldo_atual,saldo_final,unidade_medida'
      )
      .in('id', estIds);
    if (eErr) throw eErr;
    console.log('\n=== ESTOQUE ===');
    console.log(est);
  }
}
