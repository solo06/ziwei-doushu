/**
 * POST /api/heming —— 双人合盘 AI 分析（流式）
 *
 * 请求：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 返回：text/event-stream，格式与 /api/interpret 一致
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { getAiConfig } from '@/lib/ai/config';
import { checkRateLimit, clientKey } from '@/lib/ai/rate-limit';
import { buildHemingMessages } from '@/lib/ai/prompt';
import { streamChat } from '@/lib/ai/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUESTION = 300;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isChart(value: unknown): value is ZiweiChart {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.palaces) && c.palaces.length === 12 && typeof c.mingGongBranch === 'number';
}

export async function POST(req: Request) {
  const config = getAiConfig();
  if (!config) {
    return jsonError('服务端未配置 AI_BASE_URL / AI_API_KEY', 503);
  }

  // 合盘一次要喂两张盘，成本更高，限流按 2 次普通请求计
  const limited = checkRateLimit(clientKey(req), config.perMinute, config.perDay);
  if (!limited.ok) {
    return jsonError(limited.message ?? '请求过于频繁', 429, {
      retryAfter: limited.retryAfter,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  if (!isChart(body.chartA) || !isChart(body.chartB)) {
    return jsonError('chartA / chartB 缺失或格式不正确', 400);
  }

  const question =
    typeof body.question === 'string' ? body.question.slice(0, MAX_QUESTION) : undefined;

  const messages = buildHemingMessages(body.chartA, body.chartB, question);
  return streamChat({ config, messages });
}
