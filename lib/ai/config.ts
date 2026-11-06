/**
 * AI 解读的运行期配置。
 *
 * 全部来自环境变量，密钥不进镜像、不进仓库。
 * 未配置 AI_BASE_URL / AI_API_KEY 时返回 null，接口会给前端一个明确的可读错误。
 */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  perMinute: number;
  perDay: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAiConfig(): AiConfig | null {
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  if (!baseUrl || !apiKey) return null;

  return {
    baseUrl,
    apiKey,
    model: process.env.AI_MODEL || 'deepseek-chat',
    maxTokens: num(process.env.AI_MAX_TOKENS, 1600),
    temperature: Number(process.env.AI_TEMPERATURE ?? '0.7'),
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 90_000),
    perMinute: num(process.env.AI_RATE_LIMIT_PER_MIN, 6),
    perDay: num(process.env.AI_DAILY_LIMIT, 200),
  };
}
