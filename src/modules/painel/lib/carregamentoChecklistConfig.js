/**
 * Checklist de carregamento (Logística).
 * Configuração centralizada — futuras alterações de perguntas ficam aqui.
 */

export const CARREGAMENTO_ANSWER = {
  SIM: 'sim',
  NAO: 'nao',
};

const YES_NO = [
  { value: CARREGAMENTO_ANSWER.SIM, labelKey: 'production.operationalChecklist.answers.yes' },
  { value: CARREGAMENTO_ANSWER.NAO, labelKey: 'production.operationalChecklist.answers.no' },
];

/** @returns {Array<object>} */
export function getCarregamentoChecklistQuestions() {
  return [
    {
      key: 'doc_conferida',
      labelKey: 'painel.comercial.agendamentos.checklist.questions.docConferida',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: CARREGAMENTO_ANSWER.SIM,
      allowedAnswers: [CARREGAMENTO_ANSWER.SIM],
      blockMessageKey: 'painel.comercial.agendamentos.checklist.errors.mustBeYes',
      icon: 'file',
    },
    {
      key: 'epi_utilizado',
      labelKey: 'painel.comercial.agendamentos.checklist.questions.epiUtilizado',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: CARREGAMENTO_ANSWER.SIM,
      allowedAnswers: [CARREGAMENTO_ANSWER.SIM],
      blockMessageKey: 'painel.comercial.agendamentos.checklist.errors.mustBeYes',
      icon: 'shield',
    },
    {
      key: 'veiculo_posicionado',
      labelKey: 'painel.comercial.agendamentos.checklist.questions.veiculoPosicionado',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: CARREGAMENTO_ANSWER.SIM,
      allowedAnswers: [CARREGAMENTO_ANSWER.SIM],
      blockMessageKey: 'painel.comercial.agendamentos.checklist.errors.mustBeYes',
      icon: 'truck',
    },
    {
      key: 'produto_conforme',
      labelKey: 'painel.comercial.agendamentos.checklist.questions.produtoConforme',
      type: 'radio',
      options: YES_NO,
      requiredAnswer: CARREGAMENTO_ANSWER.SIM,
      allowedAnswers: [CARREGAMENTO_ANSWER.SIM],
      blockMessageKey: 'painel.comercial.agendamentos.checklist.errors.mustBeYes',
      icon: 'package',
    },
  ];
}

/**
 * @param {Array<object>} questions
 * @param {Record<string, { answer?: string, observacao?: string }>} answers
 */
export function validateCarregamentoChecklistAnswers(questions, answers) {
  /** @type {Record<string, string>} */
  const errors = {};

  for (const q of questions) {
    const state = answers[q.key] || {};
    const answer = state.answer;

    if (!answer) {
      errors[q.key] = 'painel.comercial.agendamentos.checklist.errors.answerRequired';
      continue;
    }

    if (q.allowedAnswers && !q.allowedAnswers.includes(answer)) {
      errors[q.key] =
        q.blockMessageKey || 'painel.comercial.agendamentos.checklist.errors.mustBeYes';
      continue;
    }

    if (q.requiredAnswer && answer !== q.requiredAnswer) {
      errors[q.key] =
        q.blockMessageKey || 'painel.comercial.agendamentos.checklist.errors.mustBeYes';
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * @param {Array<object>} questions
 * @param {Record<string, { answer?: string, observacao?: string }>} answers
 * @param {(key: string) => string} t
 */
export function buildCarregamentoChecklistPayload(questions, answers, t) {
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

/** @param {unknown} respostas */
export function parseStoredCarregamentoChecklistAnswers(respostas) {
  /** @type {Record<string, { answer?: string, observacao?: string }>} */
  const map = {};
  const list = Array.isArray(respostas) ? respostas : [];
  for (const item of list) {
    if (!item?.question_key) continue;
    map[item.question_key] = {
      answer: item.answer || '',
      observacao: item.observacao || '',
    };
  }
  return map;
}
