/**
 * @typedef {'radio'|'checkbox'} ChecklistQuestionType
 *
 * @typedef {{
 *   value: string,
 *   labelKey: string,
 * }} ChecklistOption
 *
 * @typedef {{
 *   key: string,
 *   labelKey: string,
 *   type: ChecklistQuestionType,
 *   options?: ChecklistOption[],
 *   helperKey?: string,
 *   requiredAnswer?: string|null,
 *   allowedAnswers?: string[],
 *   blockMessageKey?: string|null,
 *   observationWhen?: string,
 *   observationRequiredWhen?: string,
 *   icon?: string,
 * }} ChecklistQuestion
 */

export {};
