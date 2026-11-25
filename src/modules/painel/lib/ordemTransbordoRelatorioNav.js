/** Origens do relatório de OT (query `?from=` ou `location.state.from`). */
export const RELATORIO_FROM = {
  CHEMFLOW_VALIDACAO: "chemflow-validacao",
  IND_VALIDACAO: "ind-validacao",
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
  const searchFrom = new URLSearchParams(location?.search || "").get("from");
  const stateFrom =
    typeof location?.state?.from === "string" ? location.state.from : null;
  const from = searchFrom || stateFrom;

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
