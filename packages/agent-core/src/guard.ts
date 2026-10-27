// Topic guard: the assistant gives no health, allergy or nutrition advice.
// Such messages get a fixed reply before any model call, so the rule does not
// depend on the model obeying its prompt.

const HEALTH_TOPICS =
  /\b(allerg\w*|anaphyla\w*|diabet\w*|calori\w*|nutrition\w*|nutrient\w*|protein intake|gluten|lactose|cholesterol|blood pressure|hypertension|pregnan\w*|weight loss|lose weight|diet plan|keto|healthy|healthier|ulcer)\b/i;

export const HEALTH_REFUSAL =
  "I can't give health, allergy or nutrition advice. Please ask the restaurant about ingredients, or a health professional about your diet. I can still help you find and order food.";

export function isHealthAdviceRequest(text: string): boolean {
  return HEALTH_TOPICS.test(text);
}
