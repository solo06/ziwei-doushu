/**
 * POST /api/interpret —— 命盘 AI 解读（流式）
 *
 * 请求：{ chart: ZiweiChart, messages: [{role, content}] }
 * 返回：text/event-stream
 *       每帧 data: {"delta":{"text":"..."}}
 *       结束 data: [DONE]
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { getAiConfig } from '@/lib/ai/config';
import { checkRateLimit, clientKey } from '@/lib/ai/rate-limit';
import { buildInterpretMessages, type ChatMessage } from '@/lib/ai/prompt';
import { streamChat } from '@/lib/ai/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 12;
const MAX_CHARS = 4000;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sanitize(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const item of input.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : null;
    const content = typeof rec.content === 'string' ? rec.content.slice(0, MAX_CHARS) : '';
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
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

  if (!isChart(body.chart)) {
    return jsonError('chart 缺失或格式不正确', 400);
  }

  const history = sanitize(body.messages);
  if (history.length === 0) {
    return jsonError('messages 为空', 400);
  }

  const messages = buildInterpretMessages(body.chart, history);
  return streamChat({ config, messages });
}
