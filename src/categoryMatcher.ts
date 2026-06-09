import {
  type FrustrationCategory,
  createCategory,
  extractKeywords,
  slugifyCategoryId,
  tokenize,
} from "./categories.js";
import type { FrustrationRecord } from "./skillWriter.js";

export interface CategoryMatchResult {
  action: "match" | "create";
  category: FrustrationCategory;
  score: number;
  matchSource: "explicit_id" | "explicit_label" | "summary" | "create";
  alternatives: Array<{ category: FrustrationCategory; score: number }>;
  labelWarning?: string;
}

const SUMMARY_MATCH_THRESHOLD = 0.28;

const THEME_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /擅自|未经|没问|没同意|私自|乱改|别改|不要改/, label: "擅自改动" },
  { pattern: /gitignore|配置|config|\.env|yaml|yml/, label: "擅自改动" },
  { pattern: /ui|界面|样式|css|布局/, label: "擅自改UI" },
  { pattern: /又|重复|几遍|再次|怎么还/, label: "重复犯错" },
  { pattern: /听不懂|理解错|理解偏|答非所问|方向错|没理解/, label: "理解偏差" },
  { pattern: /没看|没读|上下文|代码都不/, label: "忽略上下文" },
  { pattern: /废话|啰嗦|太长|简洁/, label: "啰嗦低效" },
  { pattern: /太慢|磨叽|赶紧/, label: "进展太慢" },
  { pattern: /中文|英文|语言/, label: "语言风格" },
];

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreCategoryBySummary(
  summary: string,
  category: FrustrationCategory,
  recordsInCategory: FrustrationRecord[]
): number {
  const summaryTokens = new Set(tokenize(summary));
  const labelTokens = new Set(tokenize(category.label));
  const keywordTokens = new Set(category.keywords);

  const labelScore = jaccard(summaryTokens, labelTokens);
  const keywordScore = jaccard(summaryTokens, keywordTokens);

  const rulesText = recordsInCategory.map((r) => r.suggestedRule).join(" ");
  const ruleTokens = new Set(tokenize(rulesText));
  const ruleScore = rulesText ? jaccard(summaryTokens, ruleTokens) : 0;

  let themeBonus = 0;
  const summaryTheme = inferThemeFromText(summary);
  if (summaryTheme === category.label) themeBonus = 0.35;
  else if (category.label.includes(summaryTheme) || summaryTheme.includes(category.label)) {
    themeBonus = 0.15;
  }

  return labelScore * 0.35 + keywordScore * 0.2 + ruleScore * 0.25 + themeBonus;
}

/** 规范化 Agent 传入的宽泛主题（仅用于 label，不用 summary 覆盖） */
function normalizeCategoryLabel(text: string): string {
  const cleaned = text
    .replace(/^(用户|因为|由于|agent|AI|助手)/i, "")
    .replace(/[，。！？,.!?]/g, "")
    .trim();

  // 已是短标签且不含文件名 → 直接采用（仅做轻度主题映射）
  if (cleaned.length <= 10 && !/\.\w{2,5}/.test(cleaned)) {
    for (const { pattern, label } of THEME_PATTERNS) {
      if (pattern.test(cleaned) && cleaned.length > 6) return label;
    }
    if (cleaned.length <= 8) return cleaned;
  }

  return inferThemeFromText(cleaned);
}

function inferThemeFromText(text: string): string {
  const cleaned = text
    .replace(/^(用户|因为|由于|agent|AI|助手)/i, "")
    .replace(/[，。！？,.!?]/g, "")
    .trim();

  for (const { pattern, label } of THEME_PATTERNS) {
    if (pattern.test(cleaned)) return label;
  }

  const stripped = cleaned
    .replace(/\S+\.\w+/g, "")
    .replace(/[a-zA-Z0-9_/-]+/g, "")
    .trim();

  if (stripped.length <= 8) return stripped || "其他";
  return stripped.slice(0, 6);
}

function validateCategoryLabel(label: string): string | undefined {
  if (/\.\w{2,5}/.test(label)) {
    return "分类名过细（含文件名），请用宽泛主题如「擅自改动」";
  }
  if (label.length > 10) {
    return "分类名过长，请压缩为 2~8 字的宽泛主题";
  }
  return undefined;
}

/** 按 label 在已有分类中查找（Agent 指定分类时优先） */
function findCategoryByLabel(
  label: string,
  categories: FrustrationCategory[]
): FrustrationCategory | undefined {
  if (!label.trim() || categories.length === 0) return undefined;

  const raw = label.trim();
  const normalized = normalizeCategoryLabel(raw);
  const slug = slugifyCategoryId(normalized);

  // 1. 完全一致
  let found = categories.find((c) => c.label === raw || c.label === normalized);
  if (found) return found;

  // 2. id 一致
  found = categories.find((c) => c.id === slug || c.id === slugifyCategoryId(raw));
  if (found) return found;

  // 3. 包含关系（「理解偏差」↔「理解」类）
  found = categories.find(
    (c) =>
      c.label.includes(normalized) ||
      normalized.includes(c.label) ||
      c.label.includes(raw) ||
      raw.includes(c.label)
  );
  if (found) return found;

  // 4. token 重叠
  const inputTokens = new Set(tokenize(normalized));
  let best: FrustrationCategory | undefined;
  let bestScore = 0;
  for (const c of categories) {
    const score = jaccard(inputTokens, new Set(tokenize(c.label)));
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function matchCategory(
  summary: string,
  categories: FrustrationCategory[],
  records: FrustrationRecord[],
  explicitLabel?: string
): CategoryMatchResult {
  const rawLabel = explicitLabel?.trim();
  const labelWarning = rawLabel ? validateCategoryLabel(rawLabel) : undefined;

  // ── 优先级 1：Agent 明确指定 category_label ──
  if (rawLabel) {
    const normalized = normalizeCategoryLabel(rawLabel);
    const byLabel = findCategoryByLabel(rawLabel, categories);

    if (byLabel) {
      return {
        action: "match",
        category: byLabel,
        score: 1,
        matchSource: "explicit_label",
        alternatives: [],
        labelWarning,
      };
    }

    // 指定了 label 但没找到 → 新建该分类，绝不用 summary 塞到别的类
    return {
      action: "create",
      category: createCategory(normalized, broadDescription(normalized)),
      score: 0,
      matchSource: "create",
      alternatives: [],
      labelWarning,
    };
  }

  // ── 优先级 2：无 label，按 summary 匹配 ──
  if (categories.length === 0) {
    const label = inferThemeFromText(summary);
    return {
      action: "create",
      category: createCategory(label, broadDescription(label)),
      score: 0,
      matchSource: "create",
      alternatives: [],
    };
  }

  const scored = categories
    .map((category) => {
      const recordsInCategory = records.filter((r) => r.category === category.id);
      return {
        category,
        score: scoreCategoryBySummary(summary, category, recordsInCategory),
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= SUMMARY_MATCH_THRESHOLD) {
    return {
      action: "match",
      category: best.category,
      score: best.score,
      matchSource: "summary",
      alternatives: scored.slice(1, 4),
    };
  }

  const label = inferThemeFromText(summary);
  const existingByTheme = findCategoryByLabel(label, categories);
  if (existingByTheme) {
    return {
      action: "match",
      category: existingByTheme,
      score: best?.score ?? 0,
      matchSource: "summary",
      alternatives: scored.slice(0, 3),
    };
  }

  return {
    action: "create",
    category: createCategory(label, broadDescription(label)),
    score: best?.score ?? 0,
    matchSource: "create",
    alternatives: scored.slice(0, 3),
  };
}

function broadDescription(label: string): string {
  const desc: Record<string, string> = {
    擅自改动: "未经用户同意修改不该动的文件、配置或代码",
    擅自改UI: "未经用户同意修改界面、样式或布局",
    重复犯错: "同样的问题或用户约束被反复违反",
    理解偏差: "没理解需求、答非所问、方向错误",
    忽略上下文: "没读代码、没看历史对话就动手",
    啰嗦低效: "废话太多、解释过长、不直接解决问题",
    进展太慢: "工具调用过多、迟迟不出结果",
    语言风格: "语言、语气或格式不符合用户偏好",
  };
  return desc[label] ?? `${label}类问题`;
}

export function enrichCategoryKeywords(
  category: FrustrationCategory,
  summary: string
): FrustrationCategory {
  const merged = new Set([...category.keywords, ...extractKeywords(summary)]);
  return { ...category, keywords: [...merged].slice(0, 20) };
}
