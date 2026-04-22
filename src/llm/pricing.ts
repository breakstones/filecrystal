export interface ModelPricing {
  provider: string;
  currency: 'CNY' | 'USD';
  promptPerKTokens: number;
  completionPerKTokens: number;
  imagePerKTokens?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'qwen-plus': { provider: 'dashscope', currency: 'CNY', promptPerKTokens: 0.0008, completionPerKTokens: 0.002 },
  'qwen-turbo': { provider: 'dashscope', currency: 'CNY', promptPerKTokens: 0.0003, completionPerKTokens: 0.0006 },
  'qwen-vl-max': { provider: 'dashscope', currency: 'CNY', promptPerKTokens: 0.02, completionPerKTokens: 0.02, imagePerKTokens: 0.02 },
  'qwen-vl-ocr-latest': { provider: 'dashscope', currency: 'CNY', promptPerKTokens: 0.005, completionPerKTokens: 0.005, imagePerKTokens: 0.005 },
  'gpt-4o': { provider: 'openai', currency: 'USD', promptPerKTokens: 0.0025, completionPerKTokens: 0.01 },
  'gpt-4o-mini': { provider: 'openai', currency: 'USD', promptPerKTokens: 0.00015, completionPerKTokens: 0.0006 },
};

const USD_TO_CNY = 7.2;

export function computeYuan(
  model: string,
  usage: { promptTokens?: number; completionTokens?: number; imageTokens?: number },
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const prompt = (usage.promptTokens ?? 0) / 1000;
  const completion = (usage.completionTokens ?? 0) / 1000;
  const image = (usage.imageTokens ?? 0) / 1000;
  let cost =
    prompt * pricing.promptPerKTokens +
    completion * pricing.completionPerKTokens +
    image * (pricing.imagePerKTokens ?? 0);
  if (pricing.currency === 'USD') cost *= USD_TO_CNY;
  return Math.round(cost * 10000) / 10000;
}
