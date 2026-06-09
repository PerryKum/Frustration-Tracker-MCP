export type ConflictType = "within_category" | "cross_scope";
export type ConflictStatus = "pending" | "resolved";
export type ConflictResolution = "keep_a" | "keep_b" | "keep_both";

export interface RuleConflict {
  id: string;
  timestamp: string;
  type: ConflictType;
  categoryId?: string;
  categoryLabel?: string;
  ruleA: string;
  ruleB: string;
  ruleALabel: string;
  ruleBLabel: string;
  reason: string;
  status: ConflictStatus;
  resolution?: ConflictResolution;
  newRecordId?: string;
}

const OPPOSITE_PAIRS: Array<{
  negative: RegExp;
  positive: RegExp;
  label: string;
}> = [
  {
    negative: /别问|不要问|别老问|少问|别确认/,
    positive: /先问|问我|确认|征求意见|先确认/,
    label: "是否需先询问用户",
  },
  {
    negative: /别改|不要改|别动|未经|不要动|别乱改/,
    positive: /直接改|随便改|主动改|自行改/,
    label: "是否可直接修改",
  },
  {
    negative: /简洁|少说|废话|啰嗦|别解释/,
    positive: /详细|解释|多说|说明清楚|展开/,
    label: "回复详细程度",
  },
  {
    negative: /中文|简体/,
    positive: /英文|english/i,
    label: "使用语言",
  },
  {
    negative: /别提交|不要提交|别commit/,
    positive: /直接提交|自动提交|帮我提交/,
    label: "是否自动提交",
  },
];

function normalizeRule(rule: string): string {
  return rule.replace(/\s+/g, " ").trim();
}

function rulePolarity(rule: string): { negative: boolean; positive: boolean; topics: string[] } {
  const topics: string[] = [];
  let negative = false;
  let positive = false;
  for (const { negative: neg, positive: pos, label } of OPPOSITE_PAIRS) {
    if (neg.test(rule)) {
      negative = true;
      topics.push(label);
    }
    if (pos.test(rule)) {
      positive = true;
      topics.push(label);
    }
  }
  return { negative, positive, topics };
}

function detectRulePairConflict(
  ruleA: string,
  ruleB: string
): { conflict: boolean; reason: string } | null {
  const a = normalizeRule(ruleA);
  const b = normalizeRule(ruleB);
  if (!a || !b || a === b) return null;

  const polA = rulePolarity(a);
  const polB = rulePolarity(b);

  const sharedTopics = polA.topics.filter((t) => polB.topics.includes(t));
  if (sharedTopics.length > 0) {
    if ((polA.negative && polB.positive) || (polA.positive && polB.negative)) {
      return { conflict: true, reason: `同一主题「${sharedTopics[0]}」存在相反约束` };
    }
  }

  for (const { negative, positive, label } of OPPOSITE_PAIRS) {
    const aHitNeg = negative.test(a);
    const aHitPos = positive.test(a);
    const bHitNeg = negative.test(b);
    const bHitPos = positive.test(b);
    if ((aHitNeg && bHitPos) || (aHitPos && bHitNeg)) {
      return { conflict: true, reason: `主题「${label}」存在相反约束` };
    }
  }

  return null;
}

export function findConflictsWithRules(
  newRule: string,
  existingRules: string[],
  options?: { skipRules?: Set<string> }
): Array<{ existingRule: string; reason: string }> {
  const skip = options?.skipRules ?? new Set();
  const results: Array<{ existingRule: string; reason: string }> = [];
  for (const existing of existingRules) {
    if (skip.has(existing)) continue;
    const hit = detectRulePairConflict(newRule, existing);
    if (hit) results.push({ existingRule: existing, reason: hit.reason });
  }
  return results;
}

export function findCrossScopeConflicts(
  projectRules: Array<{ categoryId: string; categoryLabel: string; rule: string }>,
  globalRules: Array<{ categoryId: string; categoryLabel: string; rule: string }>
): Array<{
  categoryLabel: string;
  categoryId: string;
  projectRule: string;
  globalRule: string;
  reason: string;
}> {
  const results: Array<{
    categoryLabel: string;
    categoryId: string;
    projectRule: string;
    globalRule: string;
    reason: string;
  }> = [];

  for (const pr of projectRules) {
    for (const gr of globalRules) {
      const sameCat =
        pr.categoryId === gr.categoryId ||
        pr.categoryLabel === gr.categoryLabel ||
        pr.categoryLabel.includes(gr.categoryLabel) ||
        gr.categoryLabel.includes(pr.categoryLabel);

      if (!sameCat) continue;

      const hit = detectRulePairConflict(pr.rule, gr.rule);
      if (hit) {
        results.push({
          categoryId: pr.categoryId,
          categoryLabel: pr.categoryLabel,
          projectRule: pr.rule,
          globalRule: gr.rule,
          reason: hit.reason,
        });
      }
    }
  }
  return results;
}

export function createConflict(input: {
  type: ConflictType;
  ruleA: string;
  ruleB: string;
  ruleALabel: string;
  ruleBLabel: string;
  reason: string;
  categoryId?: string;
  categoryLabel?: string;
  newRecordId?: string;
}): RuleConflict {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    status: "pending",
    ...input,
  };
}
