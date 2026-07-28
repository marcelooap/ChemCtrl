-- ChemFlow — Troca fiscal no estoque
-- Mantém a nota fiscal original e registra a NF após a troca.

alter table estoque
  add column if not exists nota_fiscal_troca text;

comment on column estoque.nota_fiscal is
  'Nota fiscal original da entrada (preservada após troca fiscal).';

comment on column estoque.nota_fiscal_troca is
  'Nota fiscal após troca fiscal. Quando preenchida, é a NF vigente operacionalmente.';
