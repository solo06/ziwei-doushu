/**
 * 把排盘结果序列化成给 LLM 读的结构化中文。
 *
 * 目的：让模型基于「盘面上真实存在的星曜」说话，而不是自由发挥。
 * 所有字段都来自 lib/ziwei/types 的 ZiweiChart，不引入任何额外推断。
 */
import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { detectPatterns, getMingGongSummary } from '@/lib/ziwei/patterns';

const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

function starText(stars: Star[]): string {
  if (stars.length === 0) return '无';
  return stars
    .map((s) => {
      const brightness = s.brightnessRaw ? `(${s.brightnessRaw})` : '';
      const sihua = s.siHua ? `[化${s.siHua}]` : '';
      return `${s.name}${brightness}${sihua}`;
    })
    .join('、');
}

function pick(palace: Palace, type: Star['type']): Star[] {
  return palace.stars.filter((s) => s.type === type);
}

function palaceLine(p: Palace): string {
  const branch = BRANCHES[p.branch] ?? '?';
  const stem = STEMS[p.stem] ?? '?';
  const flags: string[] = [];
  if (p.isMingGong) flags.push('命宫');
  if (p.isShenGong) flags.push('身宫');

  const major = pick(p, 'major');
  const lucky = pick(p, 'lucky');
  const minor = pick(p, 'minor');
  const sha = pick(p, 'sha');

  const parts: string[] = [];
  parts.push(`${p.name}${flags.length ? `【${flags.join('/')}】` : ''}（${branch}宫·${stem}干）`);

  if (p.isEmpty) {
    const borrowed = p.borrowedStars?.length
      ? `借对宫${p.borrowedFromName ?? ''}：${p.borrowedStars.join('、')}`
      : '空宫';
    parts.push(`主星：${borrowed}`);
  } else {
    parts.push(`主星：${starText(major)}`);
  }
  if (lucky.length) parts.push(`吉星：${starText(lucky)}`);
  if (minor.length) parts.push(`辅星：${starText(minor)}`);
  if (sha.length) parts.push(`煞星：${starText(sha)}`);

  if (p.selfSihua?.length) {
    parts.push(
      `宫干自化：${p.selfSihua.map((s) => `化${s.siHua}→${s.starName}`).join('、')}`,
    );
  }
  if (p.daXianAge) {
    parts.push(`大限 ${p.daXianAge[0]}-${p.daXianAge[1]} 岁`);
  }

  return '- ' + parts.join('｜');
}

/** 取某一宫的所有星曜名，供知识库查表使用 */
export function palaceStarNames(chart: ZiweiChart, palaceName: string): string[] {
  const p = chart.palaces.find((x) => x.name === palaceName);
  if (!p) return [];
  const names = p.stars.map((s) => s.name);
  if (p.isEmpty && p.borrowedStars) names.push(...p.borrowedStars);
  return Array.from(new Set(names));
}

export function renderChart(chart: ZiweiChart, label: string): string {
  const b = chart.birthInfo;
  const lunar = chart.lunarInfo;
  const lines: string[] = [];

  const lunarMonth = `${lunar.lunarMonth < 0 ? '闰' : ''}${Math.abs(lunar.lunarMonth)}月`;
  lines.push(`## ${label}`);
  lines.push(
    `- 公历：${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')} ` +
      `${BRANCHES[b.hour] ?? '?'}时｜性别：${b.gender === 'male' ? '男' : '女'}` +
      `${chart.yinYangGender ? `（${chart.yinYangGender}）` : ''}`,
  );
  lines.push(`- 农历：${lunar.lunarYear}年 ${lunarMonth}${lunar.lunarDay}日 生肖${BRANCHES[lunar.yearBranch] ?? '?'}`);
  if (lunar.fourPillars?.length === 4) {
    lines.push(`- 四柱（节气口径）：${lunar.fourPillars.join(' ')}`);
  }
  lines.push(
    `- 五行局：${chart.wuxingJuName}｜命主：${chart.mingZhu ?? '—'}｜身主：${chart.shenZhu ?? '—'}`,
  );
  lines.push(
    `- 命宫在${BRANCHES[chart.mingGongBranch] ?? '?'}，身宫在${BRANCHES[chart.shenGongBranch] ?? '?'}，当前 ${chart.currentAge} 岁`,
  );

  const summary = getMingGongSummary(chart);
  if (summary.stars.length) {
    lines.push(
      `- 命宫主星：${summary.stars.join('、')}（${summary.nature}）｜关键词：${summary.keywords.join('、')}`,
    );
  }

  lines.push('', '### 十二宫');
  const sorted = [...chart.palaces].sort((a, b2) => a.branch - b2.branch);
  for (const p of sorted) lines.push(palaceLine(p));

  if (chart.daXians?.length) {
    lines.push('', '### 大限');
    for (const d of chart.daXians) {
      const sihua = d.siHua
        ? `｜四化：禄${d.siHua.lu} 权${d.siHua.quan} 科${d.siHua.ke} 忌${d.siHua.ji}`
        : '';
      const mark = d.palaceBranch === chart.palaces[chart.currentDaXianIndex ?? -1]?.branch ? '（当前）' : '';
      lines.push(`- ${d.startAge}-${d.endAge} 岁｜${d.palaceName}${sihua}${mark}`);
    }
  }

  const patterns = detectPatterns(chart);
  if (patterns.length) {
    lines.push('', '### 已识别格局（引擎判定，可直接引用）');
    for (const pt of patterns) {
      const src = pt.source ? `｜出处：${pt.source}` : '';
      lines.push(`- ${pt.name}（${pt.level}）：${pt.description}${src}`);
    }
  } else {
    lines.push('', '### 已识别格局', '- 无成格（引擎未命中既定格局库）');
  }

  return lines.join('\n');
}
