export interface FrustrationCategory {
  id: string;
  label: string;
  description: string;
  createdAt: string;
  /** 从历次 summary 提炼的关键词，用于后续匹配 */
  keywords: string[];
}

export function slugifyCategoryId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  if (slug.length >= 2) return slug;
  return `cat-${hashLabel(label)}`;
}

function hashLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

export function createCategory(label: string, description: string): FrustrationCategory {
  return {
    id: slugifyCategoryId(label),
    label: label.trim(),
    description: description.trim(),
    createdAt: new Date().toISOString(),
    keywords: extractKeywords(description),
  };
}

export function extractKeywords(text: string): string[] {
  const tokens = tokenize(text);
  const stop = new Set([
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "有", "没", "不",
    "要", "就", "都", "也", "还", "又", "把", "被", "让", "给", "和", "与", "或", "但", "而",
    "因为", "所以", "如果", "虽然", "已经", "可以", "应该", "需要", "用户", "agent", "the",
    "a", "an", "is", "are", "was", "were", "to", "of", "in", "for", "on", "with",
  ]);
  return [...new Set(tokens.filter((t) => t.length >= 2 && !stop.has(t)))].slice(0, 12);
}

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const english = lower.match(/[a-z0-9]+/g) ?? [];
  const chinese = lower.match(/[\u4e00-\u9fff]{1,4}/g) ?? [];
  return [...english, ...chinese];
}
