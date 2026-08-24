-- ============================================================================
-- ChemCtrl v2 — Bloco 10: Seeds iniciais
-- ============================================================================

INSERT INTO modulos (codigo, nome, ativo) VALUES
  ('painel', 'Painel', true),
  ('transbordo', 'Transbordo', true),
  ('industrializacao', 'Industrialização', true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
VALUES
  ('perfil_administrador', 'Administrador', 'administrador', 'Acesso total ao sistema', 'Ativo', true, '/'),
  ('perfil_supervisor', 'Supervisor', 'supervisor', 'Gestão operacional sem administração de usuários', 'Ativo', true, '/'),
  ('perfil_operacional', 'Operacional', 'operacional', 'Execução de produção e inventário', 'Ativo', true, '/ordens'),
  ('perfil_visualizacao', 'Visualização', 'visualizacao', 'Somente leitura em telas permitidas', 'Ativo', true, '/vasilhames'),
  ('perfil_cliente', 'Cliente', 'cliente', 'Portal do cliente externo', 'Ativo', true, '/tela-clientes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_modulos (perfil_id, modulo) VALUES
  ('perfil_administrador', 'industrializacao'),
  ('perfil_administrador', 'transbordo'),
  ('perfil_supervisor', 'industrializacao'),
  ('perfil_operacional', 'industrializacao'),
  ('perfil_visualizacao', 'industrializacao')
ON CONFLICT DO NOTHING;

-- Catálogo de permissões (extraído de migration_user_permissions.sql)INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  -- Acesso a módulos
  ('module.painel', 'painel', NULL, 'access', 'module.painel', 'Acesso ao módulo Painel'),
  ('module.industrializacao', 'industrializacao', NULL, 'access', 'module.industrializacao', 'Acesso ao módulo Industrialização'),
  ('module.transbordo', 'transbordo', NULL, 'access', 'module.transbordo', 'Acesso ao módulo Transbordo'),

  -- Painel
  ('painel_home.view', 'painel', 'home', 'view', 'painel_home.view', 'Visualizar Home do Painel'),
  ('painel_dashboard.view', 'painel', 'dashboard', 'view', 'painel_dashboard.view', 'Visualizar Dashboard do Painel'),
  ('painel_comercial_reserva.view', 'painel', 'comercial_reserva', 'view', 'painel_comercial_reserva.view', 'Visualizar Reservar Material'),
  ('painel_comercial_reserva.create', 'painel', 'comercial_reserva', 'create', 'painel_comercial_reserva.create', 'Criar reserva de material'),
  ('painel_comercial_reserva.edit', 'painel', 'comercial_reserva', 'edit', 'painel_comercial_reserva.edit', 'Editar reserva de material'),
  ('painel_comercial_saida.view', 'painel', 'comercial_saida', 'view', 'painel_comercial_saida.view', 'Visualizar Solicitações de Saída'),
  ('painel_comercial_saida.create', 'painel', 'comercial_saida', 'create', 'painel_comercial_saida.create', 'Criar solicitação de saída'),
  ('painel_comercial_saida.edit', 'painel', 'comercial_saida', 'edit', 'painel_comercial_saida.edit', 'Editar solicitação de saída'),
  ('painel_comercial_saida.delete', 'painel', 'comercial_saida', 'delete', 'painel_comercial_saida.delete', 'Excluir solicitação de saída'),
  ('painel_comercial_carga.view', 'painel', 'comercial_carga', 'view', 'painel_comercial_carga.view', 'Visualizar Composição de Carga'),
  ('painel_comercial_carga.create', 'painel', 'comercial_carga', 'create', 'painel_comercial_carga.create', 'Criar composição de carga'),
  ('painel_comercial_carga.edit', 'painel', 'comercial_carga', 'edit', 'painel_comercial_carga.edit', 'Editar composição de carga'),
  ('painel_comercial_carga.delete', 'painel', 'comercial_carga', 'delete', 'painel_comercial_carga.delete', 'Excluir composição de carga'),
  ('painel_comercial_agendamentos.view', 'painel', 'comercial_agendamentos', 'view', 'painel_comercial_agendamentos.view', 'Visualizar Agendamentos'),
  ('painel_comercial_agendamentos.create', 'painel', 'comercial_agendamentos', 'create', 'painel_comercial_agendamentos.create', 'Criar agendamento de carregamento'),
  ('painel_comercial_agendamentos.edit', 'painel', 'comercial_agendamentos', 'edit', 'painel_comercial_agendamentos.edit', 'Editar agendamento de carregamento'),
  ('painel_comercial_agendamentos.delete', 'painel', 'comercial_agendamentos', 'delete', 'painel_comercial_agendamentos.delete', 'Cancelar agendamento de carregamento'),
  ('painel_logistica.view', 'painel', 'logistica', 'view', 'painel_logistica.view', 'Visualizar Logística'),
  ('painel_logistica_agendamentos.view', 'painel', 'logistica_agendamentos', 'view', 'painel_logistica_agendamentos.view', 'Visualizar Agendamentos de Logística'),
  ('painel_logistica_carregamentos.view', 'painel', 'logistica_carregamentos', 'view', 'painel_logistica_carregamentos.view', 'Visualizar Carregamentos de Logística'),
  ('painel_operacional_ordem_transbordo.view', 'painel', 'operacional_ordem_transbordo', 'view', 'painel_operacional_ordem_transbordo.view', 'Visualizar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.create', 'painel', 'operacional_ordem_transbordo', 'create', 'painel_operacional_ordem_transbordo.create', 'Criar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.edit', 'painel', 'operacional_ordem_transbordo', 'edit', 'painel_operacional_ordem_transbordo.edit', 'Editar Ordem de Transbordo'),
  ('painel_operacional_ordem_transbordo.delete', 'painel', 'operacional_ordem_transbordo', 'delete', 'painel_operacional_ordem_transbordo.delete', 'Excluir Ordem de Transbordo'),
  ('painel_operacional_estoque.view', 'painel', 'operacional_estoque', 'view', 'painel_operacional_estoque.view', 'Visualizar Estoque Operacional'),

  -- Industrialização (keys existentes)
  ('home.view', 'industrializacao', 'home', 'view', 'home.view', 'Visualizar Home'),
  ('dashboard.view', 'industrializacao', 'dashboard', 'view', 'dashboard.view', 'Visualizar Dashboard'),
  ('recipes.view', 'industrializacao', 'recipes', 'view', 'recipes.view', 'Visualizar Receitas'),
  ('recipes.create', 'industrializacao', 'recipes', 'create', 'recipes.create', 'Criar Receita'),
  ('recipes.edit', 'industrializacao', 'recipes', 'edit', 'recipes.edit', 'Editar Receita'),
  ('recipes.delete', 'industrializacao', 'recipes', 'delete', 'recipes.delete', 'Excluir Receita'),
  ('recipes.approve', 'industrializacao', 'recipes', 'approve', 'recipes.approve', 'Aprovar Receita'),
  ('recipes.manage_fds', 'industrializacao', 'recipes', 'manage_fds', 'recipes.manage_fds', 'Gerenciar FDS'),
  ('recipes.remove_fds', 'industrializacao', 'recipes', 'remove_fds', 'recipes.remove_fds', 'Remover FDS'),
  ('orders.view', 'industrializacao', 'orders', 'view', 'orders.view', 'Visualizar Pedidos'),
  ('orders.create', 'industrializacao', 'orders', 'create', 'orders.create', 'Criar Pedido'),
  ('orders.edit', 'industrializacao', 'orders', 'edit', 'orders.edit', 'Editar Pedido'),
  ('orders.delete', 'industrializacao', 'orders', 'delete', 'orders.delete', 'Excluir Pedido'),
  ('raw_material_stock.view', 'industrializacao', 'raw_material_stock', 'view', 'raw_material_stock.view', 'Visualizar Estoque de MP'),
  ('raw_material_stock.create', 'industrializacao', 'raw_material_stock', 'create', 'raw_material_stock.create', 'Criar Estoque de MP'),
  ('raw_material_stock.edit', 'industrializacao', 'raw_material_stock', 'edit', 'raw_material_stock.edit', 'Editar Estoque de MP'),
  ('raw_material_stock.delete', 'industrializacao', 'raw_material_stock', 'delete', 'raw_material_stock.delete', 'Excluir Estoque de MP'),
  ('inventory.view', 'industrializacao', 'inventory', 'view', 'inventory.view', 'Visualizar Inventário'),
  ('inventory.create', 'industrializacao', 'inventory', 'create', 'inventory.create', 'Criar Inventário'),
  ('inventory.edit', 'industrializacao', 'inventory', 'edit', 'inventory.edit', 'Editar Inventário'),
  ('inventory.delete', 'industrializacao', 'inventory', 'delete', 'inventory.delete', 'Excluir Inventário'),
  ('containers.view', 'industrializacao', 'containers', 'view', 'containers.view', 'Visualizar Vasilhames'),
  ('containers.create', 'industrializacao', 'containers', 'create', 'containers.create', 'Criar Vasilhame'),
  ('containers.edit', 'industrializacao', 'containers', 'edit', 'containers.edit', 'Editar Vasilhame'),
  ('containers.delete', 'industrializacao', 'containers', 'delete', 'containers.delete', 'Excluir Vasilhame'),
  ('saida.view', 'industrializacao', 'saida', 'view', 'saida.view', 'Visualizar Saída'),
  ('saida.create', 'industrializacao', 'saida', 'create', 'saida.create', 'Criar Saída'),
  ('saida.edit', 'industrializacao', 'saida', 'edit', 'saida.edit', 'Editar Saída'),
  ('saida.delete', 'industrializacao', 'saida', 'delete', 'saida.delete', 'Excluir Saída'),
  ('tankage.view', 'industrializacao', 'tankage', 'view', 'tankage.view', 'Visualizar Tankagem'),
  ('tankage.create', 'industrializacao', 'tankage', 'create', 'tankage.create', 'Criar Tanque'),
  ('tankage.edit', 'industrializacao', 'tankage', 'edit', 'tankage.edit', 'Editar Tanque'),
  ('tankage.delete', 'industrializacao', 'tankage', 'delete', 'tankage.delete', 'Excluir Tanque'),
  ('transfer.view', 'industrializacao', 'transfer', 'view', 'transfer.view', 'Visualizar Transbordo (industrialização)'),
  ('transfer.create', 'industrializacao', 'transfer', 'create', 'transfer.create', 'Criar Transbordo'),
  ('transfer.edit', 'industrializacao', 'transfer', 'edit', 'transfer.edit', 'Editar Transbordo'),
  ('transfer.delete', 'industrializacao', 'transfer', 'delete', 'transfer.delete', 'Excluir Transbordo'),
  ('new_production.view', 'industrializacao', 'new_production', 'view', 'new_production.view', 'Visualizar Nova Produção'),
  ('new_production.create', 'industrializacao', 'new_production', 'create', 'new_production.create', 'Criar OP'),
  ('productions.view', 'industrializacao', 'productions', 'view', 'productions.view', 'Visualizar Produções'),
  ('productions.create_op', 'industrializacao', 'productions', 'create_op', 'productions.create_op', 'Criar OP'),
  ('productions.edit_op', 'industrializacao', 'productions', 'edit_op', 'productions.edit_op', 'Editar OP'),
  ('productions.complement', 'industrializacao', 'productions', 'complement', 'productions.complement', 'Complementar lote'),
  ('productions.cancel', 'industrializacao', 'productions', 'cancel', 'productions.cancel', 'Cancelar OP'),
  ('productions.finish', 'industrializacao', 'productions', 'finish', 'productions.finish', 'Finalizar OP'),
  ('productions.print_label', 'industrializacao', 'productions', 'print_label', 'productions.print_label', 'Imprimir etiqueta'),
  ('productions.export', 'industrializacao', 'productions', 'export', 'productions.export', 'Exportar produções'),
  ('production_orders.view', 'industrializacao', 'production_orders', 'view', 'production_orders.view', 'Visualizar Ordens'),
  ('production_orders.create', 'industrializacao', 'production_orders', 'create', 'production_orders.create', 'Criar Ordem'),
  ('production_orders.edit', 'industrializacao', 'production_orders', 'edit', 'production_orders.edit', 'Editar Ordem'),
  ('production_orders.delete', 'industrializacao', 'production_orders', 'delete', 'production_orders.delete', 'Excluir Ordem'),
  ('quality_tests.view', 'industrializacao', 'quality_tests', 'view', 'quality_tests.view', 'Visualizar Ensaios'),
  ('quality_tests.register_test', 'industrializacao', 'quality_tests', 'register_test', 'quality_tests.register_test', 'Registrar ensaio'),
  ('quality_tests.edit', 'industrializacao', 'quality_tests', 'edit', 'quality_tests.edit', 'Editar ensaio'),
  ('quality_tests.delete', 'industrializacao', 'quality_tests', 'delete', 'quality_tests.delete', 'Excluir ensaio'),
  ('quality_analyses.view', 'industrializacao', 'quality_analyses', 'view', 'quality_analyses.view', 'Visualizar Lista de Ensaios'),
  ('quality_analyses.create', 'industrializacao', 'quality_analyses', 'create', 'quality_analyses.create', 'Criar análise'),
  ('quality_analyses.edit', 'industrializacao', 'quality_analyses', 'edit', 'quality_analyses.edit', 'Editar análise'),
  ('quality_analyses.delete', 'industrializacao', 'quality_analyses', 'delete', 'quality_analyses.delete', 'Excluir análise'),
  ('quality_pending.view', 'industrializacao', 'quality_pending', 'view', 'quality_pending.view', 'Visualizar Produções CQ'),
  ('quality_pending.release_production', 'industrializacao', 'quality_pending', 'release_production', 'quality_pending.release_production', 'Liberar produção'),
  ('quality_pending.edit', 'industrializacao', 'quality_pending', 'edit', 'quality_pending.edit', 'Editar CQ'),
  ('quality_coa.view', 'industrializacao', 'quality_coa', 'view', 'quality_coa.view', 'Visualizar COA'),
  ('quality_coa.issue_coa', 'industrializacao', 'quality_coa', 'issue_coa', 'quality_coa.issue_coa', 'Emitir COA'),
  ('quality_coa.export', 'industrializacao', 'quality_coa', 'export', 'quality_coa.export', 'Exportar COA'),
  ('lab_equipment.view', 'industrializacao', 'lab_equipment', 'view', 'lab_equipment.view', 'Visualizar Equipamentos de Lab'),
  ('lab_equipment.create', 'industrializacao', 'lab_equipment', 'create', 'lab_equipment.create', 'Criar equipamento'),
  ('lab_equipment.edit', 'industrializacao', 'lab_equipment', 'edit', 'lab_equipment.edit', 'Editar equipamento'),
  ('lab_equipment.delete', 'industrializacao', 'lab_equipment', 'delete', 'lab_equipment.delete', 'Excluir equipamento'),
  ('client_portal.view', 'industrializacao', 'client_portal', 'view', 'client_portal.view', 'Visualizar Tela Clientes'),
  ('client_stock.view', 'industrializacao', 'client_stock', 'view', 'client_stock.view', 'Visualizar Estoque Cliente'),
  ('users.view', 'painel', 'users', 'view', 'users.view', 'Visualizar Usuários'),
  ('users.create', 'painel', 'users', 'create', 'users.create', 'Criar Usuário'),
  ('users.edit', 'painel', 'users', 'edit', 'users.edit', 'Editar Usuário'),
  ('users.delete', 'painel', 'users', 'delete', 'users.delete', 'Excluir Usuário'),
  ('profiles.view', 'painel', 'profiles', 'view', 'profiles.view', 'Visualizar Permissões'),
  ('profiles.create', 'painel', 'profiles', 'create', 'profiles.create', 'Criar perfil (legado)'),
  ('profiles.edit', 'painel', 'profiles', 'edit', 'profiles.edit', 'Editar permissões de usuário'),
  ('profiles.delete', 'painel', 'profiles', 'delete', 'profiles.delete', 'Excluir perfil (legado)'),

  -- Transbordo
  ('tb_home.view', 'transbordo', 'home', 'view', 'tb_home.view', 'Visualizar Home do Transbordo'),
  ('tb_dashboard.view', 'transbordo', 'dashboard', 'view', 'tb_dashboard.view', 'Visualizar Dashboard do Transbordo'),
  ('tb_cadastro.view', 'transbordo', 'cadastro', 'view', 'tb_cadastro.view', 'Visualizar Cadastro'),
  ('tb_cadastro.create', 'transbordo', 'cadastro', 'create', 'tb_cadastro.create', 'Criar cadastro'),
  ('tb_cadastro.edit', 'transbordo', 'cadastro', 'edit', 'tb_cadastro.edit', 'Editar cadastro'),
  ('tb_cadastro.delete', 'transbordo', 'cadastro', 'delete', 'tb_cadastro.delete', 'Excluir cadastro'),
  ('tb_entrada.view', 'transbordo', 'entrada', 'view', 'tb_entrada.view', 'Visualizar Entrada'),
  ('tb_entrada.create', 'transbordo', 'entrada', 'create', 'tb_entrada.create', 'Criar entrada'),
  ('tb_entrada.edit', 'transbordo', 'entrada', 'edit', 'tb_entrada.edit', 'Editar entrada'),
  ('tb_entrada.delete', 'transbordo', 'entrada', 'delete', 'tb_entrada.delete', 'Excluir entrada'),
  ('tb_saida.view', 'transbordo', 'saida', 'view', 'tb_saida.view', 'Visualizar Saída'),
  ('tb_saida.create', 'transbordo', 'saida', 'create', 'tb_saida.create', 'Criar saída'),
  ('tb_saida.edit', 'transbordo', 'saida', 'edit', 'tb_saida.edit', 'Editar saída'),
  ('tb_saida.delete', 'transbordo', 'saida', 'delete', 'tb_saida.delete', 'Excluir saída'),
  ('tb_transbordo.view', 'transbordo', 'transbordo', 'view', 'tb_transbordo.view', 'Visualizar Transbordo'),
  ('tb_transbordo.create', 'transbordo', 'transbordo', 'create', 'tb_transbordo.create', 'Criar transbordo'),
  ('tb_transbordo.edit', 'transbordo', 'transbordo', 'edit', 'tb_transbordo.edit', 'Editar transbordo'),
  ('tb_transbordo.delete', 'transbordo', 'transbordo', 'delete', 'tb_transbordo.delete', 'Excluir transbordo'),
  ('tb_vasilhames.view', 'transbordo', 'vasilhames', 'view', 'tb_vasilhames.view', 'Visualizar Vasilhames (Transbordo)'),
  ('tb_vasilhames.create', 'transbordo', 'vasilhames', 'create', 'tb_vasilhames.create', 'Criar vasilhame'),
  ('tb_vasilhames.edit', 'transbordo', 'vasilhames', 'edit', 'tb_vasilhames.edit', 'Editar vasilhame'),
  ('tb_vasilhames.delete', 'transbordo', 'vasilhames', 'delete', 'tb_vasilhames.delete', 'Excluir vasilhame'),
  ('tb_filtracao.view', 'transbordo', 'filtracao', 'view', 'tb_filtracao.view', 'Visualizar Filtração'),
  ('tb_filtracao.create', 'transbordo', 'filtracao', 'create', 'tb_filtracao.create', 'Criar filtração'),
  ('tb_filtracao.edit', 'transbordo', 'filtracao', 'edit', 'tb_filtracao.edit', 'Editar filtração'),
  ('tb_filtracao.delete', 'transbordo', 'filtracao', 'delete', 'tb_filtracao.delete', 'Excluir filtração'),
  ('tb_estoque.view', 'transbordo', 'estoque', 'view', 'tb_estoque.view', 'Visualizar Estoque (Transbordo)'),
  ('tb_estoque.create', 'transbordo', 'estoque', 'create', 'tb_estoque.create', 'Criar estoque'),
  ('tb_estoque.edit', 'transbordo', 'estoque', 'edit', 'tb_estoque.edit', 'Editar estoque'),
  ('tb_estoque.delete', 'transbordo', 'estoque', 'delete', 'tb_estoque.delete', 'Excluir estoque'),
  ('tb_estoque_envio.view', 'transbordo', 'estoque_envio', 'view', 'tb_estoque_envio.view', 'Visualizar Estoque Envio'),
  ('tb_estoque_envio.export', 'transbordo', 'estoque_envio', 'export', 'tb_estoque_envio.export', 'Exportar Estoque Envio'),
  ('tb_tankagem.view', 'transbordo', 'tankagem', 'view', 'tb_tankagem.view', 'Visualizar Tankagem (Transbordo)')
ON CONFLICT (id) DO NOTHING;
-- Operadores seed
INSERT INTO operadores (nome, ativo)
SELECT v.nome, true
FROM (VALUES
  ('Adriano Q.'),
  ('Leonardo S.'),
  ('Rafael N.'),
  ('Mariano'),
  ('Ezequiel F.'),
  ('Wandre C.')
) AS v(nome)
WHERE NOT EXISTS (
  SELECT 1 FROM operadores o WHERE lower(btrim(o.nome)) = lower(btrim(v.nome))
);


-- Permissões adicionais (migrations posteriores)
INSERT INTO permissoes (id, modulo, tela, acao, codigo, descricao) VALUES
  ('programming.view', 'industrializacao', 'programming', 'view', 'programming.view', 'Visualizar Programação'),
  ('programming.create', 'industrializacao', 'programming', 'create', 'programming.create', 'Criar Programação'),
  ('programming.edit', 'industrializacao', 'programming', 'edit', 'programming.edit', 'Editar Programação'),
  ('programming.delete', 'industrializacao', 'programming', 'delete', 'programming.delete', 'Excluir Programação')
ON CONFLICT (id) DO NOTHING;

-- Concede todas as permissões do catálogo ao perfil Administrador
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT 'perfil_administrador', p.codigo
FROM permissoes p
ON CONFLICT DO NOTHING;

-- Supervisor: tudo exceto users/profiles
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT 'perfil_supervisor', p.codigo
FROM permissoes p
WHERE p.codigo NOT LIKE 'users.%'
  AND p.codigo NOT LIKE 'profiles.%'
ON CONFLICT DO NOTHING;
SELECT pg_notify('pgrst', 'reload schema');