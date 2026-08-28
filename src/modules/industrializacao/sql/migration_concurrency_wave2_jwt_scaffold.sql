-- ============================================================================
-- Onda 2 — Scaffold JWT de sessão para RLS (fase 1)
-- Emite claims no login_user / validate_session para o frontend guardar.
-- RLS real completa exige signing JWT Supabase (fase 2 — ver README no final).
-- ============================================================================

-- Função auxiliar: monta claims a partir da sessão
CREATE OR REPLACE FUNCTION build_session_claims(p_session jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'sub', p_session ->> 'id',
    'usuario', p_session ->> 'usuario',
    'perfil_id', p_session ->> 'perfil_id',
    'nivel_acesso', p_session ->> 'nivel_acesso',
    'session_id', p_session ->> 'session_id',
    'iat', extract(epoch from now())::bigint,
    'chemctrl', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION build_session_claims(jsonb) TO anon, authenticated;

-- Política de transição: ainda USING(true), mas documentada.
-- Próximo passo (manual / ops): configurar JWT custom claim no Supabase Auth Hook
-- ou Edge Function que troca x-session-id por JWT assinado com role authenticated
-- e policies do tipo:
--   USING ( (current_setting('request.jwt.claims', true)::jsonb ->> 'chemctrl') = 'true' )
--
-- Até lá, TODAS as escritas críticas devem passar por RPCs SECURITY DEFINER
-- que chamam get_current_session().

COMMENT ON FUNCTION build_session_claims(jsonb) IS
  'Onda 2 scaffold: claims para futura emissão de JWT. Não substitui RLS ainda.';

SELECT pg_notify('pgrst', 'reload schema');
