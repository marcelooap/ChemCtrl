import { canAccessRoute, hasPermission } from "@industrializacao/lib/permissions";

/** Origens do relatório de OT (query `?from=` ou `location.state.from`). */
export const RELATORIO_FROM = {
  CHEMFLOW_VALIDACAO: "chemflow-validacao",
  IND_VALIDACAO: "ind-validacao",
};

/** Permissão da tela de Validação que originou a impressão. */
const VALIDACAO_VIEW_BY_DESTINO = {
  industrializacao: "ind_validacao.view",
  convencional: "tb_validacao.view",
};

export const OT_RELATORIO_BASE = "/painel/operacional/ordem-transbordo/relatorio";
export const OT_BASE_PATH = "/painel/operacional/ordem-transbordo";
export const RECEBIMENTO_BASE_PATH = "/painel/logistica/recebimento";
export const CHEMFLOW_VALIDACAO_PATH = "/chemflow/validacao";
export const IND_VALIDACAO_PATH = "/validacao";

const BACK_LABEL_DEFAULT =
  "painel.operacional.ordemTransbordo.relatorio.back";
const BACK_LABEL_VALIDACAO =
  "painel.operacional.ordemTransbordo.relatorio.backToValidacao";

/**
 * Resolve destino e label do botão Voltar no relatório de OT.
 * Preferência: `?from=` → `location.state.from` → path do relatório.
 */
export function resolveBackNav(location) {
  const from = readRelatorioFrom(location);

  if (from === RELATORIO_FROM.CHEMFLOW_VALIDACAO) {
    return { path: CHEMFLOW_VALIDACAO_PATH, labelKey: BACK_LABEL_VALIDACAO };
  }
  if (from === RELATORIO_FROM.IND_VALIDACAO) {
    return { path: IND_VALIDACAO_PATH, labelKey: BACK_LABEL_VALIDACAO };
  }
  if (String(location?.pathname || "").includes("/logistica/recebimento")) {
    return { path: RECEBIMENTO_BASE_PATH, labelKey: BACK_LABEL_DEFAULT };
  }
  return { path: OT_BASE_PATH, labelKey: BACK_LABEL_DEFAULT };
}

export function buildRelatorioUrl(destino, id, from) {
  const base = `${OT_RELATORIO_BASE}/${destino}/${id}`;
  return from ? `${base}?from=${encodeURIComponent(from)}` : base;
}

export function readRelatorioFrom(location) {
  const searchFrom = new URLSearchParams(location?.search || "").get("from");
  if (searchFrom) return searchFrom;
  return typeof location?.state?.from === "string" ? location.state.from : null;
}

/** Segmento `:destino` de `.../relatorio/:destino/:id`. */
export function reportDestinoFromPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const idx = parts.indexOf("relatorio");
  if (idx < 0) return null;
  return parts[idx + 1] || null;
}

/**
 * Quem pode abrir o preview de impressão.
 * A rota fica em `/painel/...`, mas a Validação (Transbordo e Industrialização)
 * também imprime. Exigir a tela Operacional devolvia quem só tem Validação
 * para `/painel/home`, sem abrir o preview.
 */
export function canOpenOrdemTransbordoRelatorio(user, location) {
  if (!user) return false;
  const pathname = location?.pathname || "";
  if (canAccessRoute(user, pathname)) return true;

  const destino = reportDestinoFromPath(pathname);
  const viewKey = VALIDACAO_VIEW_BY_DESTINO[destino];
  return Boolean(viewKey && hasPermission(user, viewKey));
}

/** Destino quando o preview é negado — volta à Validação de origem. */
export function resolveRelatorioDeniedPath(location) {
  const from = readRelatorioFrom(location);
  if (from === RELATORIO_FROM.CHEMFLOW_VALIDACAO) return CHEMFLOW_VALIDACAO_PATH;
  if (from === RELATORIO_FROM.IND_VALIDACAO) return IND_VALIDACAO_PATH;
  return null;
}
