import { base44 } from '@industrializacao/api/base44Client';
import { toDateInputValue } from '@/i18n/formatters';
import { productionOfContainer } from '@industrializacao/lib/fractionalSupply';
import { resolveValidityDays } from '@industrializacao/lib/recipeRevisions';
import { resolveQualityValidityDays } from '@industrializacao/lib/qualityValidity';
import { groupQualityTestRows } from '@industrializacao/lib/qualitySpecComposition';
import { calcValidityDate } from '@industrializacao/lib/labelprint';
import { containerLabelDateOverride } from '@industrializacao/lib/containerLabelDateOverride';

/**
 * Dias de validade do container: Cadastro CQ → receita (lista) → receita remota.
 * `tests` evita consultar o CQ a cada container quando o chamador já o carregou.
 */
export async function resolveValidityDaysForContainer(
  container,
  production,
  recipes,
  { tests = null } = {}
) {
  const cqProduct = container?.product || production?.product;
  const cqClient = container?.client || production?.client;
  try {
    const list = groupQualityTestRows(
      tests || (await base44.entities.QualityTest.list('-updated_date', 2000)),
    );
    const fromCq = resolveQualityValidityDays(list || [], cqProduct, cqClient);
    if (fromCq != null) return fromCq;
  } catch { /* Cadastro CQ indisponível: usa a receita como fallback */ }

  let validityDays = resolveValidityDays(recipes || [], container, production);

  if (validityDays == null && production?.recipe_id) {
    try {
      const remote = await base44.entities.Recipe.get(production.recipe_id);
      const n = Number(remote?.validity_days);
      if (Number.isFinite(n) && n > 0) validityDays = n;
    } catch { /* ignore */ }
  }
  if (validityDays == null) {
    const productName = container?.product || production?.product;
    if (productName) {
      try {
        const remoteList = await base44.entities.Recipe.filter(
          { product_name: productName },
          '-revision_number',
          20,
        );
        validityDays = resolveValidityDays(remoteList || [], container, production);
      } catch { /* ignore */ }
    }
  }
  return validityDays;
}

/** Fabricação do container: correção da etiqueta, fim da produção ou criação do vasilhame. */
export function resolveContainerFabricacao(container, production) {
  const override = containerLabelDateOverride(container);
  if (override?.manufactureDate) return override.manufactureDate;
  return production?.end_time || container?.created_date || null;
}

/**
 * Carrega uma única vez containers, produções, receitas e CQ e devolve
 * `Map<containerId, { lote, data_fabricacao, data_validade }>` dos ids pedidos.
 */
export async function loadContainerLoteDatasMap(containerIds = []) {
  const wanted = new Set((containerIds || []).filter(Boolean).map(String));
  const result = new Map();
  if (wanted.size === 0) return result;

  // Cada consulta é independente: falha em produção/receita/CQ não pode esconder
  // lote e lacres do container.
  const [containers, productions, recipes, tests] = await Promise.all([
    base44.entities.Container.list('-created_date', 1000).catch(() => []),
    base44.entities.Production.list('-created_date', 500).catch(() => []),
    import('@industrializacao/hooks/useRecipes')
      .then(({ listRecipesGrouped }) => listRecipesGrouped('-updated_date', 2000))
      .catch(() => []),
    base44.entities.QualityTest.list('-updated_date', 2000)
      .then((rows) => groupQualityTestRows(rows || []))
      .catch(() => null),
  ]);

  const selected = (containers || []).filter((c) => wanted.has(String(c.id)));

  // Containers fora da janela da listagem são buscados individualmente.
  const found = new Set(selected.map((c) => String(c.id)));
  const missing = [...wanted].filter((id) => !found.has(id));
  const extra = await Promise.all(
    missing.map((id) => base44.entities.Container.get(id).catch(() => null))
  );
  selected.push(...extra.filter(Boolean));

  const datas = await Promise.all(
    selected.map((container) =>
      resolveContainerLoteDatas(container, { productions, recipes, tests }).catch(
        () => ({
          lote: String(container?.lot || '').trim(),
          lacres: String(container?.seals || '').trim(),
          data_fabricacao: null,
          data_validade: null,
        })
      )
    )
  );
  selected.forEach((container, i) => result.set(String(container.id), datas[i]));
  return result;
}

/**
 * Lote, lacres, fabricação e validade (YYYY-MM-DD) do container da Industrialização,
 * com as mesmas regras da etiqueta da tela de Vasilhames.
 */
export async function resolveContainerLoteDatas(
  container,
  { productions = [], recipes = [], tests = null } = {}
) {
  const production = productionOfContainer(container, productions || []);
  const dateOverride = containerLabelDateOverride(container);
  if (dateOverride) {
    return {
      lote: String(container?.lot || '').trim(),
      lacres: String(container?.seals || '').trim(),
      data_fabricacao: dateOverride.manufactureDate,
      data_validade: dateOverride.expiryDate,
    };
  }
  const fabricacao = resolveContainerFabricacao(container, production);
  const validityDays = await resolveValidityDaysForContainer(
    container,
    production,
    recipes,
    { tests }
  );
  return {
    lote: String(container?.lot || '').trim(),
    lacres: String(container?.seals || '').trim(),
    data_fabricacao: toDateInputValue(fabricacao) || null,
    data_validade: toDateInputValue(calcValidityDate(fabricacao, validityDays)) || null,
  };
}
