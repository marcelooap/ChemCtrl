-- ChemFlow — Supabase Projeto B — Row Level Security
--
-- MODELO DE AUTENTICAÇÃO (Etapa 1 — login único na plataforma)
-- ---------------------------------------------------------------
-- O ChemFlow NÃO possui login próprio. O usuário se autentica uma única vez
-- na plataforma ChemCtrl (Supabase Projeto A / InternalAuthContext) e, a
-- partir da sessão da plataforma, as rotas /chemflow/* ficam liberadas no
-- app (gated por <ProtectedRoute> + <InternalAuthProvider>, ver
-- src/App.jsx). O navegador então fala com o Supabase Projeto B usando a
-- ANON KEY pública do projeto — não existe JWT de usuário do Projeto B.
--
-- Por isso, nesta etapa, o RLS do Projeto B não pode diferenciar usuários
-- individuais (não há identidade de usuário no token). O controle de acesso
-- real é feito no nível da aplicação (rota protegida pela sessão da
-- plataforma). As políticas abaixo mantêm RLS habilitado (boa prática e
-- pré-requisito para evoluir a segurança depois) liberando operações para
-- a role `anon` apenas nas tabelas do domínio ChemFlow.
--
-- LIMITE ATUAL (documentado conforme decisão do usuário):
--   Qualquer requisição que apresente a URL + anon key do Projeto B consegue
--   ler/escrever nestas tabelas, independente de estar logado na plataforma.
--   Mitigações recomendadas enquanto esta etapa estiver em produção:
--     1. Nunca expor a service role key no cliente.
--     2. Restringir CORS/allowed origins do Projeto B ao domínio da
--        plataforma (Supabase Dashboard > Settings > API).
--     3. Manter rate limiting / monitoramento de uso da anon key.
--     4. Não deixar a anon key do Projeto B em repositórios públicos.
--
-- EVOLUÇÃO FUTURA (fora do escopo desta etapa, documentada para referência):
--   Opção A — Edge Function no Projeto A (ou B) que valida a sessão da
--     plataforma (`chemctrl_session` / RPC validate_session) e, se válida,
--     assina um JWT de curta duração para o Projeto B (custom claims),
--     permitindo políticas RLS por usuário/perfil no Projeto B.
--   Opção B — Bridge de identidade: espelhar o usuário autenticado da
--     plataforma como um "usuário" no Projeto B (Supabase Auth custom JWT),
--     unificando RLS baseada em auth.uid() em ambos os projetos.
--   Este mesmo padrão deve ser reaplicado para futuros módulos
--     (ChemLab, ChemQuality, ...).

alter table clientes           enable row level security;
alter table produtos           enable row level security;
alter table isotanques         enable row level security;
alter table descontaminacoes   enable row level security;
alter table entradas           enable row level security;
alter table estoque            enable row level security;
alter table transbordos        enable row level security;
alter table vasilhames         enable row level security;
alter table saidas             enable row level security;

-- Política única por tabela (etapa 1): acesso total para anon + authenticated.
-- Nome padronizado: chemflow_anon_all_<tabela>
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'produtos', 'isotanques', 'descontaminacoes', 'entradas',
    'estoque', 'transbordos', 'vasilhames', 'saidas'
  ]
  loop
    execute format(
      'drop policy if exists chemflow_anon_all_%1$s on %1$s;', t
    );
    execute format(
      'create policy chemflow_anon_all_%1$s on %1$s
         for all
         to anon, authenticated
         using (true)
         with check (true);',
      t
    );
  end loop;
end;
$$;
