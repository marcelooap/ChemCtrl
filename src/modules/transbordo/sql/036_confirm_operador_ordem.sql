-- Identificação do operador por Ordem de Transbordo.
-- Confirma usuário + senha SEM criar sessão e SEM alterar o login do computador.
-- Reutiliza o mesmo hash (senha_hash / crypt) e o mesmo RBAC de login_user.
-- Idempotente. Executar no SQL Editor do Supabase.

create extension if not exists pgcrypto;

-- Vínculo estável com o usuário ChemCtrl. O nome exibido continua em operadores.
alter table t_transbordos
  add column if not exists operador_usuario_id text;

comment on column t_transbordos.operador_usuario_id is
  'id de ind_lista_usuarios de quem autenticou a ordem. operadores guarda o nome para as telas existentes.';

create index if not exists idx_t_transbordos_operador_usuario
  on t_transbordos (operador_usuario_id);

-- Perfil Operacional: slug/nome do cadastro de perfis, com fallback no nivel_acesso
-- apenas quando o usuário ainda não tem perfil vinculado.
create or replace function _usuario_perfil_operacional(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from ind_lista_usuarios u
    left join perfis p on p.id = u.perfil_id
    where u.id = p_user_id
      and (
        lower(btrim(coalesce(p.slug, ''))) = 'operacional'
        or lower(btrim(coalesce(p.nome, ''))) = 'operacional'
        or p.id = 'perfil_operacional'
        or (
          p.id is null
          and lower(btrim(coalesce(u.nivel_acesso, ''))) = 'operacional'
        )
      )
  );
$$;

-- Usuários ativos do perfil Operacional.
-- Não devolve senha, hash nem permissões.
create or replace function list_ordem_transbordo_operators()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session jsonb;
  v_users jsonb := '[]'::jsonb;
begin
  begin
    v_session := get_current_session();
  exception when others then
    v_session := null;
  end;

  if v_session is null then
    return jsonb_build_object('success', false, 'error_code', 'session');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'nome_completo', u.nome_completo,
        'usuario', u.usuario
      )
      order by u.nome_completo
    ),
    '[]'::jsonb
  )
  into v_users
  from ind_lista_usuarios u
  where coalesce(u.status, 'Ativo') is distinct from 'Inativo'
    and _usuario_perfil_operacional(u.id)
    and translate(
      lower(btrim(coalesce(u.usuario, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ) <> 'operacao';

  return jsonb_build_object('success', true, 'users', v_users);
end;
$$;

-- Confirma a identidade para UMA ordem. Não grava sessão e não devolve session_id.
create or replace function confirm_ordem_transbordo_operator(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session jsonb;
  v_row jsonb;
  v_status text;
  v_senha_hash text;
  v_senha_plain text;
  v_ok boolean := false;
begin
  begin
    v_session := get_current_session();
  exception when others then
    v_session := null;
  end;

  if v_session is null then
    return jsonb_build_object('success', false, 'error_code', 'session');
  end if;

  begin
    perform check_login_rate_limit(p_username);
  exception
    when undefined_function then
      null;
  end;

  if p_username is null or btrim(p_username) = '' or p_password is null or p_password = '' then
    return jsonb_build_object('success', false, 'error_code', 'invalid_credentials');
  end if;

  select to_jsonb(u) into v_row
  from ind_lista_usuarios u
  where u.usuario = p_username
  limit 1;

  if v_row is null then
    begin
      perform register_failed_login_attempt(p_username);
    exception when undefined_function then
      null;
    end;
    return jsonb_build_object('success', false, 'error_code', 'invalid_credentials');
  end if;

  v_status := coalesce(v_row ->> 'status', 'Ativo');
  if v_status = 'Inativo' then
    return jsonb_build_object('success', false, 'error_code', 'inactive');
  end if;

  v_senha_hash := nullif(btrim(coalesce(v_row ->> 'senha_hash', '')), '');
  v_senha_plain := nullif(v_row ->> 'senha', '');

  if v_senha_hash is not null then
    begin
      v_ok := (v_senha_hash = extensions.crypt(p_password, v_senha_hash));
    exception when others then
      v_ok := false;
    end;
  end if;

  -- Mesmo fallback do login quando o hash ainda não foi gravado.
  if not v_ok and v_senha_plain is not null and v_senha_plain = p_password then
    v_ok := true;
  end if;

  if not v_ok then
    begin
      perform register_failed_login_attempt(p_username);
    exception when undefined_function then
      null;
    end;
    return jsonb_build_object('success', false, 'error_code', 'invalid_credentials');
  end if;

  begin
    perform reset_login_attempts(p_username);
  exception when undefined_function then
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_row ->> 'id',
      'nome_completo', v_row ->> 'nome_completo',
      'usuario', v_row ->> 'usuario'
    )
  );
end;
$$;

revoke all on function _usuario_perfil_operacional(text) from public;
revoke all on function list_ordem_transbordo_operators() from public;
revoke all on function confirm_ordem_transbordo_operator(text, text) from public;
grant execute on function list_ordem_transbordo_operators() to anon, authenticated;
grant execute on function confirm_ordem_transbordo_operator(text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
