/**
 * Corrige vasilhames tipo Tankagem cujo saldo real (transbordos) já é 0:
 * volume → 0, data_saida → data do último transbordo que usou a tanka como origem,
 * status → Expedido.
 *
 * Por padrão processa TANKA 06. Use --all para todas as tankas esvaziadas.
 *
 * Uso:
 *   node scripts/fix-chemflow-tanka-empty-vasilhames.mjs
 *   node scripts/fix-chemflow-tanka-empty-vasilhames.mjs --all
 *   node scripts/fix-chemflow-tanka-empty-vasilhames.mjs --dry-run
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

function normalizeSupabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function normPlaca(v) {
  return String(v || '')
    .trim()
    .toUpperCase();
}

function roundVolume(v) {
  return Math.round(Number(v) || 0);
}

function matchesTanka(ref, isotanqueId, tankaCodigo) {
  if (!ref) return false;
  if (isotanqueId && (ref.tanka_id === isotanqueId || ref.entrada_id === isotanqueId)) {
    return true;
  }
  const codigo = normPlaca(tankaCodigo);
  if (!codigo) return false;
  return (
    normPlaca(ref.tanka_codigo) === codigo ||
    normPlaca(ref.entrada_codigo) === codigo
  );
}

function computeSaldo(iso, transbordos) {
  let entrada = 0;
  let saida = 0;
  let lastSaidaData = null;
  let lastSaidaAt = 0;

  for (const t of transbordos) {
    for (const d of t.destinos || []) {
      if (
        d.tipo_embalagem === 'Tankagem' &&
        matchesTanka(d, iso.id, iso.tanka)
      ) {
        entrada += roundVolume(d.volume_total || d.volume || 0);
      }
    }
    for (const o of t.origens || []) {
      if (o.tipo_origem === 'tanka' && matchesTanka(o, iso.id, iso.tanka)) {
        saida += roundVolume(o.volume_retirado || 0);
        const at = new Date(t.created_at || t.data || 0).getTime();
        if (at >= lastSaidaAt) {
          lastSaidaAt = at;
          lastSaidaData = t.data || (t.created_at || '').slice(0, 10) || null;
        }
      }
    }
  }

  return {
    saldo: roundVolume(entrada - saida),
    entrada,
    saida,
    lastSaidaData,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const all = args.has('--all');
  const targetName = 'TANKA 06';

  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };

  const url = normalizeSupabaseUrl(env.VITE_CHEMFLOW_SUPABASE_URL || '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error(
      'Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY no .env'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const [{ data: isotanques, error: errI }, { data: transbordos, error: errT }, { data: vasilhames, error: errV }] =
    await Promise.all([
      supabase.from('isotanques').select('*'),
      supabase.from('transbordos').select('*'),
      supabase.from('vasilhames').select('*'),
    ]);

  if (errI) throw new Error(`isotanques: ${errI.message}`);
  if (errT) throw new Error(`transbordos: ${errT.message}`);
  if (errV) throw new Error(`vasilhames: ${errV.message}`);

  const targets = (isotanques || []).filter((iso) => {
    if (all) return true;
    return normPlaca(iso.tanka) === normPlaca(targetName);
  });

  if (targets.length === 0) {
    console.error(`Isotanque "${targetName}" não encontrado.`);
    process.exit(1);
  }

  let updated = 0;

  for (const iso of targets) {
    const { saldo, entrada, saida, lastSaidaData } = computeSaldo(
      iso,
      transbordos || []
    );
    console.log(
      `\n${iso.tanka || iso.codigo_itku}: entrada=${entrada} L, saida=${saida} L, saldo=${saldo} L, data_saida sugerida=${lastSaidaData || '—'}`
    );

    if (saldo !== 0) {
      console.log('  → saldo ≠ 0, sem alteração.');
      continue;
    }
    if (!lastSaidaData) {
      console.log('  → sem origem tanka no histórico, sem alteração.');
      continue;
    }

    const placas = new Set(
      [iso.tanka, iso.codigo_itku].filter(Boolean).map(normPlaca)
    );

    const matches = (vasilhames || []).filter((v) => {
      if (v.tipo !== 'Tankagem') return false;
      if (!placas.has(normPlaca(v.placa))) return false;
      const status = v.status || (v.data_saida ? 'Expedido' : 'No Pátio');
      const needsVolume = roundVolume(v.volume || 0) !== 0;
      const needsSaida = !v.data_saida;
      const needsStatus = status !== 'Expedido';
      return needsVolume || needsSaida || needsStatus;
    });

    if (matches.length === 0) {
      console.log('  → nenhum vasilhame Tankagem pendente de ajuste.');
      continue;
    }

    for (const v of matches) {
      const patch = {
        volume: 0,
        peso_liquido: 0,
        peso_bruto: Math.round(Number(v.tara) || 0),
        data_saida: lastSaidaData,
        status: 'Expedido',
      };
      console.log(
        `  → ${dryRun ? '[dry-run] ' : ''}update ${v.id} placa=${v.placa} volume ${v.volume}→0 data_saida=${lastSaidaData}`
      );
      if (!dryRun) {
        const { error } = await supabase
          .from('vasilhames')
          .update(patch)
          .eq('id', v.id);
        if (error) throw new Error(`update ${v.id}: ${error.message}`);
        updated += 1;
      }
    }
  }

  console.log(
    dryRun
      ? `\nDry-run concluído (nenhuma escrita).`
      : `\nConcluído. Registros atualizados: ${updated}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
