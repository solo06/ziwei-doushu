/**
 * 把任意 OpenAI 兼容接口的流式输出，转换成前端约定的 SSE 格式：
 *
 *   data: {"delta":{"text":"..."}}
 *   data: [DONE]
 *
 * 前端（ChatPanel / InsightPanel / heming page）只认这个格式。
 */
import type { AiConfig } from './config';
import type { ChatMessage } from './prompt';

export interface StreamOptions {
  config: AiConfig;
  messages: ChatMessage[];
}

function sse(body: string): string {
  return `data: ${body}\n\n`;
}

export async function streamChat({ config, messages }: StreamOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error && err.name === 'AbortError' ? '上游超时' : '上游连接失败';
    return new Response(JSON.stringify({ error: reason }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    const detail = await upstream.text().catch(() => '');
    console.error('[ai] upstream error', upstream.status, detail.slice(0, 300));
    return new Response(
      JSON.stringify({
        error: '模型服务返回错误',
        status: upstream.status,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.replace(/\r$/, '');
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              ctrl.enqueue(encoder.encode(sse('[DONE]')));
              continue;
            }
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const text = parsed.choices?.[0]?.delta?.content ?? '';
              if (text) {
                ctrl.enqueue(encoder.encode(sse(JSON.stringify({ delta: { text } }))));
              }
            } catch {
              // 上游偶发分片不完整，跳过即可
            }
          }
        }
      } catch {
        ctrl.enqueue(
          encoder.encode(sse(JSON.stringify({ delta: { text: '\n\n（输出中断，请重试）' } }))),
        );
      } finally {
        clearTimeout(timer);
        try {
          ctrl.enqueue(encoder.encode(sse('[DONE]')));
        } catch {
          // 已经关闭
        }
        try {
          ctrl.close();
        } catch {
          // 已经关闭
        }
        reader.cancel().catch(() => {});
      }
    },
    cancel() {
      clearTimeout(timer);
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
