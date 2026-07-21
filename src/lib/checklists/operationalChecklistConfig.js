/**
 * Configuração reutilizável dos checklists operacionais.
 * Regras condicionais derivam de recipe.necessita_n2 (produto inflamável / N₂).
 */

export const CHECKLIST_ETAPAS = {
  START_PRODUCTION: 'start_production',
  PAUSE_PRODUCTION: 'pause_production',
  START_FILLING: 'start_filling',
  FINISH_FILLING: 'finish_filling',
};

export const ANSWER = {
  SIM: 'sim',
  NAO: 'nao',
  NAO_SE_APLICA: 'nao_se_aplica',
  CONFIRMADO: 'confirmado',
};

/** @param {object|null|undefined} recipe */
export function isFlammableRecipe(recipe) {
  return Boolean(recipe?.necessita_n2);
}

const YES_NO = [
  { value: ANSWER.SIM, labelKey: 'production.operationalChecklist.answers.yes' },
  { value: ANSWER.NAO, labelKey: 'production.operationalChecklist.answers.no' },
];

const YES_NO_NA = [
  ...YES_NO,
  { value: ANSWER.NAO_SE_APLICA, labelKey: 'production.operationalChecklist.answers.notApplicable' },
];

/**
 * @param {object|null|undefined} recipe
 * @returns {import('./operationalChecklistTypes').ChecklistQuestion[]}
 */
export function getStartProductionQuestions(recipe) {
  const flammable = isFlammableRecipe(recipe);
  /** @type {import('./operationalChecklistTypes').ChecklistQuestion[]} */
  const questions = [
    {
      key: 'equipment_grounding',
      labelKey: 'production.operationalChecklist.start.equipmentGrounding',
      type: 'radio',
      options: YES_NO_NA,
      requiredAnswer: flammable ? ANSWER.SIM : null,
      allowedAnswers: flammable ? [ANSWER.SIM] : [ANSWER.SIM, ANSWER.NAO, ANSWER.NAO_SE_APLICA],
      blockMessageKey: flammable
        ? 'production.operationalChecklist.errors.flammableGrounding'
        : null,
      icon: 'zap',
    },
  ];

  if (flammable) {
    questions.push({
      key: 'n2_inertization',
      labelKey: 'production.operationalChecklist.start.n2Inertization',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.flammableN2',
      icon: 'flame',
    });
  }

  questions.push(
    {
      key: 'scale_ok',
      labelKey: 'production.operationalChecklist.start.scaleOk',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.mustBeYes',
      icon: 'scale',
    },
    {
      key: 'mixer_empty',
      labelKey: 'production.operationalChecklist.start.mixerEmpty',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.mustBeYes',
      icon: 'box',
    },
    {
      key: 'joints_hoses',
      labelKey: 'production.operationalChecklist.start.jointsHoses',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.mustBeYes',
      icon: 'link',
    },
    {
      key: 'ppe_used',
      labelKey: 'production.operationalChecklist.start.ppeUsed',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.ppeRequired',
      icon: 'shield',
    },
  );

  return questions;
}

export function getPauseProductionQuestions() {
  return [
    {
      key: 'valves_double_block',
      labelKey: 'production.operationalChecklist.pause.valvesDoubleBlock',
      type: 'checkbox',
      helperKey: 'production.operationalChecklist.pause.helper',
      requiredAnswer: ANSWER.CONFIRMADO,
      allowedAnswers: [ANSWER.CONFIRMADO],
      blockMessageKey: 'production.operationalChecklist.errors.pauseRequired',
      icon: 'lock',
    },
  ];
}

/**
 * @param {object|null|undefined} recipe
 */
export function getStartFillingQuestions(recipe) {
  const flammable = isFlammableRecipe(recipe);
  return [
    {
      key: 'packaging_clean',
      labelKey: 'production.operationalChecklist.startFilling.packagingClean',
      type: 'radio',
      options: YES_NO,
      allowedAnswers: [ANSWER.SIM, ANSWER.NAO],
      observationWhen: ANSWER.NAO,
      observationRequiredWhen: ANSWER.NAO,
      icon: 'sparkles',
    },
    {
      key: 'packaging_damage',
      labelKey: 'production.operationalChecklist.startFilling.packagingDamage',
      type: 'radio',
      options: YES_NO,
      allowedAnswers: [ANSWER.SIM, ANSWER.NAO],
      observationWhen: ANSWER.SIM,
      observationRequiredWhen: ANSWER.SIM,
      icon: 'alert',
    },
    {
      key: 'packaging_grounding',
      labelKey: 'production.operationalChecklist.startFilling.packagingGrounding',
      type: 'radio',
      options: YES_NO_NA,
      requiredAnswer: flammable ? ANSWER.SIM : null,
      allowedAnswers: flammable ? [ANSWER.SIM] : [ANSWER.SIM, ANSWER.NAO, ANSWER.NAO_SE_APLICA],
      blockMessageKey: flammable
        ? 'production.operationalChecklist.errors.flammablePackagingGrounding'
        : null,
      icon: 'zap',
    },
  ];
}

export function getFinishFillingQuestions() {
  return [
    {
      key: 'packaging_sealed',
      labelKey: 'production.operationalChecklist.finishFilling.packagingSealed',
      type: 'radio',
      options: YES_NO_NA,
      allowedAnswers: [ANSWER.SIM, ANSWER.NAO, ANSWER.NAO_SE_APLICA],
      // registro apenas — não bloqueia
      icon: 'seal',
    },
    {
      key: 'packaging_labeled',
      labelKey: 'production.operationalChecklist.finishFilling.packagingLabeled',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.labelsRequired',
      icon: 'tag',
    },
    {
      key: 'packaging_externally_clean',
      labelKey: 'production.operationalChecklist.finishFilling.packagingExternallyClean',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: ANSWER.SIM,
      allowedAnswers: [ANSWER.SIM],
      blockMessageKey: 'production.operationalChecklist.errors.externalCleanRequired',
      icon: 'sparkles',
    },
  ];
}

/**
 * @param {string} etapa
 * @param {object|null|undefined} recipe
 */
export function getQuestionsForEtapa(etapa, recipe) {
  switch (etapa) {
    case CHECKLIST_ETAPAS.START_PRODUCTION:
      return getStartProductionQuestions(recipe);
    case CHECKLIST_ETAPAS.PAUSE_PRODUCTION:
      return getPauseProductionQuestions();
    case CHECKLIST_ETAPAS.START_FILLING:
      return getStartFillingQuestions(recipe);
    case CHECKLIST_ETAPAS.FINISH_FILLING:
      return getFinishFillingQuestions();
    default:
      return [];
  }
}

/**
 * @typedef {{ answer?: string, observacao?: string }} AnswerState
 * @param {Array<object>} questions
 * @param {Record<string, AnswerState>} answers
 * @returns {{ ok: boolean, errors: Record<string, string> }}
 */
export function validateAnswers(questions, answers) {
  /** @type {Record<string, string>} */
  const errors = {};

  for (const q of questions) {
    const state = answers[q.key] || {};
    const answer = state.answer;
    const obs = (state.observacao || '').trim();

    if (!answer) {
      errors[q.key] = 'production.operationalChecklist.errors.answerRequired';
      continue;
    }

    if (q.allowedAnswers && !q.allowedAnswers.includes(answer)) {
      errors[q.key] = q.blockMessageKey || 'production.operationalChecklist.errors.invalidAnswer';
      continue;
    }

    if (q.requiredAnswer && answer !== q.requiredAnswer) {
      errors[q.key] = q.blockMessageKey || 'production.operationalChecklist.errors.mustBeYes';
      continue;
    }

    if (q.observationRequiredWhen && answer === q.observationRequiredWhen && !obs) {
      errors[q.key] = 'production.operationalChecklist.errors.observationRequired';
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Monta payload para a RPC a partir das perguntas e respostas.
 * @param {Array<object>} questions
 * @param {Record<string, AnswerState>} answers
 * @param {(key: string) => string} t
 */
export function buildAnswersPayload(questions, answers, t) {
  return questions.map((q) => {
    const state = answers[q.key] || {};
    return {
      question_key: q.key,
      question_label: t(q.labelKey),
      answer: state.answer || '',
      observacao: (state.observacao || '').trim() || null,
    };
  });
}

export function getEtapaTitleKey(etapa) {
  const map = {
    [CHECKLIST_ETAPAS.START_PRODUCTION]: 'production.operationalChecklist.titles.startProduction',
    [CHECKLIST_ETAPAS.PAUSE_PRODUCTION]: 'production.operationalChecklist.titles.pauseProduction',
    [CHECKLIST_ETAPAS.START_FILLING]: 'production.operationalChecklist.titles.startFilling',
    [CHECKLIST_ETAPAS.FINISH_FILLING]: 'production.operationalChecklist.titles.finishFilling',
  };
  return map[etapa] || 'production.operationalChecklist.titles.generic';
}

export function getEtapaConfirmLabelKey(etapa) {
  const map = {
    [CHECKLIST_ETAPAS.START_PRODUCTION]: 'production.operationalChecklist.actions.confirmChecklist',
    [CHECKLIST_ETAPAS.PAUSE_PRODUCTION]: 'production.operationalChecklist.actions.confirm',
    [CHECKLIST_ETAPAS.START_FILLING]: 'production.operationalChecklist.actions.confirmChecklist',
    [CHECKLIST_ETAPAS.FINISH_FILLING]: 'production.operationalChecklist.actions.finishFilling',
  };
  return map[etapa] || 'production.operationalChecklist.actions.confirm';
}

export function getEtapaCancelLabelKey(etapa) {
  if (etapa === CHECKLIST_ETAPAS.PAUSE_PRODUCTION || etapa === CHECKLIST_ETAPAS.FINISH_FILLING) {
    return 'production.operationalChecklist.actions.back';
  }
  return 'production.operationalChecklist.actions.cancel';
}
