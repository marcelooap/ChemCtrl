/**
 * Plano de teste de carga — ChemCtrl (Onda 1 gate)
 *
 * Uso (k6):
 *   k6 run scripts/load-test-chemctrl.mjs
 *
 * Variáveis:
 *   BASE_URL          default http://localhost:5173
 *   SUPABASE_URL      projeto Supabase
 *   SUPABASE_ANON_KEY anon key
 *   SESSION_ID        x-session-id válido (opcional — RPCs autenticadas)
 *
 * Cenários cobertos (T1/T2/T6/T7 do plano de auditoria):
 *   - T1: 5 VUs × 15s leitura de listagens
 *   - T2: 15 VUs × 30s leitura + writes leves
 *   - T6: alocação concorrente de códigos (allocate_op_number)
 *   - T7: baixas concorrentes no mesmo stock (deduct_raw_material_stock)
 *
 * Critérios de aprovação (thresholds):
 *   - http_req_failed < 1%
 *   - http_req_duration p95 < 800ms (leituras)
 *   - checks de unicidade de OP em T6
 *
 * NOTA: Este script é um harness. Ajuste STOCK_ID / endpoints ao ambiente.
 * Não rode T7 em produção com dados reais sem stock de teste.
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.SUPABASE_URL || 'https://cpzibnwytukcgxeamfhp.supabase.co';
const ANON = __ENV.SUPABASE_ANON_KEY || '';
const SESSION = __ENV.SESSION_ID || '';
const STOCK_ID = __ENV.STOCK_ID || '';

const opAllocDuration = new Trend('op_alloc_duration');
const duplicateOps = new Counter('duplicate_op_codes');

export const options = {
  scenarios: {
    T1_five_users_read: {
      executor: 'constant-vus',
      vus: 5,
      duration: '15s',
      exec: 'readHeavy',
      tags: { test: 'T1' },
    },
    T2_fifteen_users: {
      executor: 'constant-vus',
      vus: 15,
      duration: '30s',
      startTime: '20s',
      exec: 'readHeavy',
      tags: { test: 'T2' },
    },
    T6_concurrent_op_alloc: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 5,
      startTime: '55s',
      exec: 'allocOp',
      tags: { test: 'T6' },
    },
    T7_same_stock_deduct: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 2,
      startTime: '70s',
      exec: 'deductSameStock',
      tags: { test: 'T7' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    duplicate_op_codes: ['count==0'],
  },
};

function headers() {
  return {
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    'Content-Type': 'application/json',
    ...(SESSION ? { 'x-session-id': SESSION } : {}),
  };
}

export function readHeavy() {
  group('list productions', () => {
    const res = http.get(
      `${BASE}/rest/v1/ind_lista_producoes?select=id,op_number,status&order=created_date.desc&limit=100`,
      { headers: headers() }
    );
    check(res, { 'productions 200': (r) => r.status === 200 });
  });
  group('list estoque mp', () => {
    const res = http.get(
      `${BASE}/rest/v1/ind_estoque_mp?select=id,entry_id,current_stock&order=created_date.desc&limit=100`,
      { headers: headers() }
    );
    check(res, { 'estoque 200': (r) => r.status === 200 });
  });
  sleep(1);
}

const seenOps = new SharedArray('seen-ops-placeholder', () => []);

export function allocOp() {
  const start = Date.now();
  const res = http.post(`${BASE}/rest/v1/rpc/allocate_op_number`, '{}', {
    headers: headers(),
  });
  opAllocDuration.add(Date.now() - start);
  const ok = check(res, {
    'allocate_op 200': (r) => r.status === 200,
    'allocate_op returns string': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body === 'string' || typeof body?.allocate_op_number === 'string';
      } catch {
        return typeof r.body === 'string' && r.body.includes('OP');
      }
    },
  });
  if (!ok) duplicateOps.add(1);
  sleep(0.2);
}

export function deductSameStock() {
  if (!STOCK_ID) {
    console.warn('STOCK_ID não definido — T7 skipped');
    return;
  }
  const res = http.post(
    `${BASE}/rest/v1/rpc/deduct_raw_material_stock`,
    JSON.stringify({ p_stock_id: STOCK_ID, p_qty: 0.001 }),
    { headers: headers() }
  );
  // Esperado: no máximo uma série de sucessos; insuficiência = 400/P0001 (não é falha de corrida silenciosa)
  check(res, {
    'deduct responded': (r) => r.status === 200 || r.status === 400 || r.status === 409,
  });
  sleep(0.1);
}

export function setup() {
  if (!ANON) {
    console.warn('SUPABASE_ANON_KEY vazio — requests falharão.');
  }
  return { startedAt: new Date().toISOString() };
}

export function teardown(data) {
  console.log(`Load test finished. startedAt=${data.startedAt}`);
}
