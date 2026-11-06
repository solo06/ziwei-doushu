/**
 * 进程内限流：公开部署时防止别人刷走你的 API 额度。
 *
 * 单实例内存计数，够用 —— 这个应用只有一个容器、没有横向扩展。
 * 重启后计数归零属于可接受行为。
 */
interface Bucket {
  /** 最近一分钟内的请求时间戳 */
  hits: number[];
  /** yyyy-mm-dd */
  day: string;
  dayCount: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 4096;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface RateResult {
  ok: boolean;
  message?: string;
  retryAfter?: number;
}

export function checkRateLimit(
  key: string,
  perMinute: number,
  perDay: number,
): RateResult {
  const now = Date.now();
  const day = today();

  let b = buckets.get(key);
  if (!b) {
    // 简单防膨胀：超过上限直接清空，宁可漏放也不撑爆内存
    if (buckets.size > MAX_KEYS) buckets.clear();
    b = { hits: [], day, dayCount: 0 };
    buckets.set(key, b);
  }

  if (b.day !== day) {
    b.day = day;
    b.dayCount = 0;
  }

  // 滑动窗口：只保留最近 60 秒
  b.hits = b.hits.filter((t) => now - t < 60_000);

  if (b.dayCount >= perDay) {
    return { ok: false, message: '今日解读次数已用完，明天再来。' };
  }

  if (b.hits.length >= perMinute) {
    const retryAfter = Math.max(1, Math.ceil((60_000 - (now - b.hits[0])) / 1000));
    return { ok: false, message: `请求太频繁，请 ${retryAfter} 秒后重试。`, retryAfter };
  }

  b.hits.push(now);
  b.dayCount += 1;
  return { ok: true };
}

/** 从常见反代头里取客户端 IP；取不到就当作同一来源 */
export function clientKey(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    h.get('x-client-ip') ||
    'unknown'
  );
}
