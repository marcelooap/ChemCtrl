import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'documentos-tecnicos';
const SIGNED_URL_EXPIRY = 3600;

// Defesa em profundidade nesta função (além do enforce_public_rate_limit já
// aplicado dentro da RPC get_public_sds_path): evita até chamar o banco em
// abuso óbvio. Em memória por instância — best effort, não substitui o
// limite no Postgres (que é a fonte de verdade e sobrevive a cold starts).
const PUBLIC_LIMIT = 30;
const PUBLIC_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

function checkLocalRateLimit(ip: string): { blocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now - entry.windowStart > PUBLIC_WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { blocked: false, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > PUBLIC_LIMIT) {
    const retryAfterSec = Math.max(1, Math.ceil((PUBLIC_WINDOW_MS - (now - entry.windowStart)) / 1000));
    return { blocked: true, retryAfterSec };
  }
  return { blocked: false, retryAfterSec: 0 };
}

function tooManyRequests(retryAfterSec: number) {
  return new Response(JSON.stringify({ error: 'Muitas requisições. Aguarde alguns segundos.' }), {
    status: 429,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const ip = getClientIp(req);
  const local = checkLocalRateLimit(ip);
  if (local.blocked) {
    return tooManyRequests(local.retryAfterSec);
  }

  try {
    const { token } = await req.json();
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Token is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: sdsInfo, error: rpcError } = await supabase.rpc('get_public_sds_path', {
      p_token: token,
    });

    if (rpcError) {
      // enforce_public_rate_limit (dentro da própria RPC) levanta PT429 —
      // repassa como 429 real, com Retry-After quando disponível.
      if (rpcError.code === 'PT429') {
        let retryAfterSec = 60;
        try {
          const details = typeof rpcError.details === 'string' ? JSON.parse(rpcError.details) : rpcError.details;
          if (details?.retry_after_seconds) retryAfterSec = Number(details.retry_after_seconds);
        } catch {
          // mantém o padrão de 60s
        }
        return tooManyRequests(retryAfterSec);
      }

      return new Response(JSON.stringify({ error: 'Failed to validate token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!sdsInfo?.has_sds || !sdsInfo?.fds_url) {
      return new Response(JSON.stringify({ has_sds: false }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let storagePath = sdsInfo.fds_url as string;
    const bucketPrefix = `${BUCKET}/`;
    if (storagePath.startsWith(bucketPrefix)) {
      storagePath = storagePath.substring(bucketPrefix.length);
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

    if (signError || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: 'Failed to generate signed URL' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        has_sds: true,
        signed_url: signedData.signedUrl,
        fds_filename: sdsInfo.fds_filename || 'sds.pdf',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
