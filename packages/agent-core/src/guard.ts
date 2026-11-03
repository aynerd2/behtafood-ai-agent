// Topic guard: the assistant gives no health, allergy or nutrition advice.
// Such messages get a fixed reply before any model call, so the rule does not
// depend on the model obeying its prompt.

import { SERVER_MESSAGES } from './messages';

const HEALTH_TOPICS =
  /\b(allerg\w*|anaphyla\w*|diabet\w*|calori\w*|nutrition\w*|nutrient\w*|protein intake|gluten|lactose|cholesterol|blood pressure|hypertension|pregnan\w*|weight loss|lose weight|diet plan|keto|healthy|healthier|ulcer)\b/i;

/** The English refusal; every language is in messages.ts (healthRefusal). */
export const HEALTH_REFUSAL = SERVER_MESSAGES.en.healthRefusal;

export function isHealthAdviceRequest(text: string): boolean {
  return HEALTH_TOPICS.test(text);
}
