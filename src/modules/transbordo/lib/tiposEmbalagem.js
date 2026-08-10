/**
 * Tipos de embalagem do destino de transbordo (lista suspensa + regras).
 * value = valor persistido; label = texto exibido.
 */

export const TIPOS_EMBALAGEM_DESTINO = [
  { value: "Vasilhame", label: "Vasilhames" },
  { value: "Tankagem", label: "Tankagem" },
  { value: "One Way (IBC)", label: "One Way (IBC)" },
  { value: "Bombona de 200 L", label: "Bombona de 200 L" },
  { value: "Tambor 200 L", label: "Tambor 200 L" },
  { value: "Bombona de 50 L", label: "Bombona de 50 L" },
  { value: "Bombona de 25 L", label: "Bombona de 25 L" },
  { value: "Bombona de 20 L", label: "Bombona de 20 L" },
];

/** Volume padrão (L) por tipo unitário — IBC permanece livre. */
export const VOLUME_PADRAO_EMBALAGEM = {
  "Bombona de 200 L": 200,
  "Bombona 200 L": 200,
  "bombona de 200 L": 200,
  "Tambor 200 L": 200,
  "tambor 200 L": 200,
  "Bombona de 50 L": 50,
  "bombona de 50 L": 50,
  "Bombona de 25 L": 25,
  "bombona de 25 L": 25,
  "Bombona de 20 L": 20,
  "bombona de 20 L": 20,
};

/**
 * Destinos unitários (IBC / Bombona / Tambor).
 * Geram registro na tela de Vasilhames (não no Estoque).
 */
export const TIPOS_EMBALAGEM_ESTOQUE = new Set([
  "One Way (IBC)",
  "Bombona de 200 L",
  "Tambor 200 L",
  "Bombona de 50 L",
  "Bombona de 25 L",
  "Bombona de 20 L",
  // Legado
  "Bombona 200 L",
  "bombona de 200 L",
  "tambor 200 L",
  "bombona de 50 L",
  "bombona de 25 L",
  "bombona de 20 L",
]);

const TIPOS_VASILHAME_LEGADO_EMBALADO = new Set([
  ...TIPOS_EMBALAGEM_ESTOQUE,
  "Tambor",
  "Bombona",
  "IBC",
  "One Way",
]);

/** Tankagem + tipos do cadastro que não são tanque de pátio "clássico". */
export const TIPOS_NAO_VASILHAME = new Set([
  "Tankagem",
  ...TIPOS_EMBALAGEM_ESTOQUE,
]);

export function isDestinoEstoqueEmbalado(tipoEmbalagem) {
  return TIPOS_EMBALAGEM_ESTOQUE.has(tipoEmbalagem);
}

/** Alias semântico: destino unitário (bombona/tambor/IBC). */
export function isDestinoEmbalagemUnitaria(tipoEmbalagem) {
  return isDestinoEstoqueEmbalado(tipoEmbalagem);
}

export function isVasilhameLegadoEmbalado(tipo) {
  return TIPOS_VASILHAME_LEGADO_EMBALADO.has(tipo);
}

export function labelTipoEmbalagem(tipo) {
  if (!tipo) return "";
  const opt = TIPOS_EMBALAGEM_DESTINO.find((t) => t.value === tipo);
  return opt?.label || tipo;
}

/** Pluraliza e formata rótulo para placa (ex.: "Bombonas de 200 L"). */
function pluralizeLabelEmbalagem(label) {
  const raw = String(label || "").trim();
  if (!raw) return "Embalagens";

  let text = raw
    // normaliza unidade de volume
    .replace(/\b[lL]\b/g, "L")
    .replace(/\s+/g, " ")
    .trim();

  const lower = text.toLowerCase();

  if (lower.startsWith("bombona ")) {
    text = `Bombonas ${text.slice(text.indexOf(" ") + 1)}`;
  } else if (lower === "bombona") {
    text = "Bombonas";
  } else if (lower.startsWith("tambor ")) {
    text = `Tambores ${text.slice(text.indexOf(" ") + 1)}`;
  } else if (lower === "tambor") {
    text = "Tambores";
  } else if (lower.includes("ibc")) {
    // Mantém "One Way (IBC)" com capitalização do label original
    text = labelTipoEmbalagem(raw) || raw;
  } else {
    // Capitaliza a primeira letra
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Garante "L" maiúsculo na unidade
  text = text.replace(/\b[lL]\b/g, "L");

  // Capitaliza a primeira letra do resultado final
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Placa sintética para destino unitário.
 * Ex.: 4 × Bombona de 200 L → "04 x Bombonas de 200 L"
 */
export function buildPlacaEmbalagens(quantidade, tipoEmbalagem) {
  const qtd = Math.max(0, Math.round(Number(quantidade) || 0));
  const n = String(qtd).padStart(2, "0");
  const plural = pluralizeLabelEmbalagem(
    labelTipoEmbalagem(tipoEmbalagem) || tipoEmbalagem
  );
  return `${n} x ${plural}`;
}

/** Lê quantidade de embalagens de um vasilhame unitário. */
export function getQuantidadeEmbalagensFromVasilhame(vasilhame) {
  if (!vasilhame) return 0;
  const fromComp = (vasilhame.composicao || []).find(
    (c) => Number(c.quantidade_embalagens) > 0
  )?.quantidade_embalagens;
  if (fromComp > 0) return Math.round(Number(fromComp));

  const fromField = Number(vasilhame.quantidade_embalagens);
  if (fromField > 0) return Math.round(fromField);

  const volPadrao = VOLUME_PADRAO_EMBALAGEM[vasilhame.tipo];
  const volume = Number(vasilhame.volume) || 0;
  if (volPadrao > 0 && volume > 0) {
    return Math.max(1, Math.round(volume / volPadrao));
  }

  const m = String(vasilhame.placa || "").match(/^(\d+)\s*x\s*/i);
  if (m) return parseInt(m[1], 10) || 0;

  return 0;
}

/** Volume por embalagem (L) a partir do tipo / composição. */
export function getVolumePorEmbalagemFromVasilhame(vasilhame) {
  if (!vasilhame) return 0;
  const fromComp = (vasilhame.composicao || []).find(
    (c) => Number(c.volume_por_embalagem) > 0
  )?.volume_por_embalagem;
  if (fromComp > 0) return Number(fromComp);

  const padrao = VOLUME_PADRAO_EMBALAGEM[vasilhame.tipo];
  if (padrao > 0) return padrao;

  const qtd = getQuantidadeEmbalagensFromVasilhame(vasilhame);
  const volume = Number(vasilhame.volume) || 0;
  if (qtd > 0 && volume > 0) return Math.round(volume / qtd);
  return 0;
}
