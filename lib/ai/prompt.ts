/**
 * 提示词组装。
 *
 * 设计原则：
 * 1. 盘面事实由引擎给出，模型只做解释，不允许编造星曜；
 * 2. 输出有固定骨架，避免大段玄学空话；
 * 3. 明确边界（不预测生死、不做医疗/投资建议）。
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { renderChart, palaceStarNames } from './chart-context';
import {
  HEMING_METHODOLOGY,
  STAR_IN_FUQI_GU,
  MARRIAGE_STARS_BRIEF,
  SIHUA_IN_FUQI_GU,
  HEMING_SCORE_CRITERIA,
} from '@/lib/ziwei/heming-knowledge';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const STYLE = `你是紫微斗数解读师，专精倪海厦《天纪》体系，兼采《紫微斗数全书》《骨髓赋》等古籍。

【必须遵守】
1. 只依据下方「盘面事实」中出现的星曜、宫位、四化、格局作判断。盘上没有的星，不许说「命带某某」。
2. 引用古籍或格局时，用盘面事实里已给出的出处；没有出处就不要伪造书名与原文。
3. 先给结论，再给依据，最后给可执行建议。不要用「可能」「也许」堆砌模糊表述。
4. 中文输出，术语用紫微斗数标准名（命宫、夫妻宫、化忌、大限…）。
5. 不做生死预言、不诊断疾病、不给投资与法律结论；涉及健康、婚姻重大决策时提醒「这是参考，不替代专业意见」。
6. 答复长度控制在 400–700 字，除非用户明确要求展开。

【输出骨架】
**一句话定调**：……
**命盘依据**：逐条列出用到的宫位/星曜/四化
**展开分析**：按问题维度分点
**可执行建议**：2–3 条具体做法`;

export function buildInterpretMessages(
  chart: ZiweiChart,
  history: ChatMessage[],
): ChatMessage[] {
  const context = renderChart(chart, '命主命盘');
  const system = `${STYLE}\n\n---\n\n# 盘面事实\n\n${context}\n\n---\n\n以上盘面事实由排盘引擎生成，是唯一可信来源。`;
  return [{ role: 'system', content: system }, ...history];
}

function spouseKnowledge(chart: ZiweiChart, label: string): string {
  const names = palaceStarNames(chart, '夫妻');
  const lines: string[] = [`### ${label} 夫妻宫星曜资料`];
  if (names.length === 0) {
    lines.push('- 夫妻宫无主星');
    return lines.join('\n');
  }
  for (const n of names) {
    const k = STAR_IN_FUQI_GU[n];
    if (k) {
      lines.push(`- ${n}：${k.summary}`);
      lines.push(`  · 吉象：${k.good}`);
      lines.push(`  · 凶象：${k.bad}`);
      lines.push(`  · 配偶特质：${k.spouse_traits}`);
      lines.push(`  · 婚期：${k.timing}`);
      if (k.ni_quote) lines.push(`  · 倪师原话：${k.ni_quote}`);
      continue;
    }
    const brief = MARRIAGE_STARS_BRIEF[n];
    if (brief) lines.push(`- ${n}：${brief}`);
  }
  return lines.join('\n');
}

function sihuaKnowledge(chart: ZiweiChart, label: string): string {
  const palace = chart.palaces.find((p) => p.name === '夫妻');
  const lines: string[] = [];
  const hits: string[] = [];
  if (palace) {
    for (const s of palace.stars) {
      if (s.siHua) hits.push(`${s.name}化${s.siHua}`);
    }
    for (const s of palace.selfSihua ?? []) {
      hits.push(`${s.starName}自化${s.siHua}`);
    }
  }
  if (hits.length === 0) return '';
  lines.push(`### ${label} 夫妻宫四化`);
  for (const h of hits) {
    const key = h.includes('自化') ? `化${h.slice(-1)}` : `化${h.slice(-1)}`;
    const note = SIHUA_IN_FUQI_GU[key as keyof typeof SIHUA_IN_FUQI_GU];
    if (note) lines.push(`- ${h}：${note}`);
    else lines.push(`- ${h}`);
  }
  return lines.join('\n');
}

export function buildHemingMessages(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  question?: string,
): ChatMessage[] {
  const criteria = Object.entries(HEMING_SCORE_CRITERIA)
    .map(([k, v]) => `- ${k}：${v}`)
    .join('\n');

  const system = `${STYLE}

---

# 合盘方法论（必须遵循）

${HEMING_METHODOLOGY}

---

# 评分标准（用 1–5 星给出结论）

${criteria}

---

# 盘面事实

${renderChart(chartA, '甲方命盘')}

${renderChart(chartB, '乙方命盘')}

---

${spouseKnowledge(chartA, '甲方')}

${spouseKnowledge(chartB, '乙方')}

${sihuaKnowledge(chartA, '甲方')}

${sihuaKnowledge(chartB, '乙方')}

---

# 输出要求

1. 先给 **匹配星级（★1–5）+ 一句话定调**；
2. 按方法论逐项对照：双宫联参（夫妻宫 + 福德宫）、天作之合判定、四化互动、大限节奏；
3. 指出 **1–2 个必须注意的风险点**，不要只讲好话；
4. 最后给 2–3 条相处建议；
5. 以「命理为参考，婚姻成败在人」收尾。`;

  const user = question?.trim()
    ? question.trim()
    : '请按方法论做一次完整合盘分析。';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
