import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type FrustrationCategory,
  createCategory,
} from "./categories.js";
import {
  matchCategory,
  enrichCategoryKeywords,
  type CategoryMatchResult,
} from "./categoryMatcher.js";
import {
  type RuleConflict,
  type ConflictResolution,
  findConflictsWithRules,
  findCrossScopeConflicts,
  createConflict,
} from "./ruleConflict.js";

export interface FrustrationRecord {
  id: string;
  timestamp: string;
  userMessage: string;
  summary: string;
  category: string;
  suggestedRule: string;
  context?: string;
  detectionScore?: number;
  detectionSignals?: string[];
}

export interface FrustrationStore {
  version: 3;
  categories: FrustrationCategory[];
  records: FrustrationRecord[];
  /** 待用户裁决的规则冲突 */
  conflicts: RuleConflict[];
  /** 用户选择废弃的规则文本，不再写入 skill */
  suppressedRules: string[];
}

const SKILL_DIR_NAME = "user-frustration-patterns";
const CATEGORIES_DIR = "categories";

export function getSkillDir(customPath?: string): string {
  if (customPath) return customPath;
  return join(homedir(), ".cursor", "skills", SKILL_DIR_NAME);
}

function getSkillPath(customPath?: string): string {
  return join(getSkillDir(customPath), "SKILL.md");
}

function getCategorySkillDir(skillDir: string, categoryId: string): string {
  return join(skillDir, CATEGORIES_DIR, categoryId);
}

function getCategorySkillPath(skillDir: string, categoryId: string): string {
  return join(getCategorySkillDir(skillDir, categoryId), "SKILL.md");
}

async function ensureSkillDir(skillDir: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
}

function emptyStore(): FrustrationStore {
  return { version: 3, categories: [], records: [], conflicts: [], suppressedRules: [] };
}

export async function loadStore(skillDir: string): Promise<FrustrationStore> {
  const historyPath = join(skillDir, "history.json");
  try {
    const raw = await readFile(historyPath, "utf-8");
    const parsed = JSON.parse(raw);
    return migrateStore(parsed);
  } catch {
    return emptyStore();
  }
}

function migrateStore(data: unknown): FrustrationStore {
  if (!data || typeof data !== "object") {
    return emptyStore();
  }

  const obj = data as Record<string, unknown>;

  if (obj.version === 3 && Array.isArray(obj.categories) && Array.isArray(obj.records)) {
    return {
      version: 3,
      categories: obj.categories as FrustrationCategory[],
      records: obj.records as FrustrationRecord[],
      conflicts: (obj.conflicts as RuleConflict[]) ?? [],
      suppressedRules: (obj.suppressedRules as string[]) ?? [],
    };
  }

  if (obj.version === 2 && Array.isArray(obj.categories) && Array.isArray(obj.records)) {
    return {
      version: 3,
      categories: obj.categories as FrustrationCategory[],
      records: obj.records as FrustrationRecord[],
      conflicts: [],
      suppressedRules: [],
    };
  }

  const records = (obj.records as FrustrationRecord[]) ?? [];
  const legacyLabels: Record<string, string> = {
    misunderstanding: "理解偏差",
    "scope-creep": "改动越界",
    repetition: "重复犯错",
    "ignored-context": "忽略上下文",
    "code-quality": "代码质量",
    verbosity: "啰嗦低效",
    "slow-progress": "进展太慢",
    "language-style": "语言风格",
    "wrong-approach": "方法错误",
    other: "其他",
  };

  const categoryMap = new Map<string, FrustrationCategory>();
  for (const r of records) {
    if (!categoryMap.has(r.category)) {
      const label = legacyLabels[r.category] ?? r.category;
      categoryMap.set(r.category, createCategory(label, `从历次记录归纳：${label}`));
    }
  }

  return { version: 3, categories: [...categoryMap.values()], records, conflicts: [], suppressedRules: [] };
}

async function saveStore(skillDir: string, store: FrustrationStore): Promise<void> {
  await writeFile(join(skillDir, "history.json"), JSON.stringify(store, null, 2), "utf-8");
}

function groupRecordsByCategory(records: FrustrationRecord[]): Map<string, FrustrationRecord[]> {
  const byCategory = new Map<string, FrustrationRecord[]>();
  for (const record of records) {
    const list = byCategory.get(record.category) ?? [];
    list.push(record);
    byCategory.set(record.category, list);
  }
  return byCategory;
}

function isRuleSuppressed(store: FrustrationStore, rule: string): boolean {
  const n = rule.trim();
  return store.suppressedRules.some((s) => s.trim() === n);
}

function getPendingConflictRules(store: FrustrationStore): Set<string> {
  const pending = new Set<string>();
  for (const c of store.conflicts) {
    if (c.status !== "pending") continue;
    pending.add(c.ruleA.trim());
    pending.add(c.ruleB.trim());
  }
  return pending;
}

function aggregateRules(store: FrustrationStore, records: FrustrationRecord[], limit = 12): string[] {
  const pending = getPendingConflictRules(store);
  const ruleCounts = new Map<string, number>();
  for (const r of records) {
    if (!r.suggestedRule?.trim()) continue;
    const key = r.suggestedRule.trim();
    if (isRuleSuppressed(store, key)) continue;
    if (pending.has(key)) continue;
    ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + 1);
  }
  return [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule]) => rule)
    .slice(0, limit);
}

function buildPendingConflictsSection(store: FrustrationStore): string {
  const pending = store.conflicts.filter((c) => c.status === "pending");
  if (pending.length === 0) return "";

  const lines = pending.map(
    (c, i) =>
      `${i + 1}. **${c.type === "cross_scope" ? "全局↔项目" : c.categoryLabel ?? "同分类"}** (${c.reason})\n` +
      `   - A [${c.ruleALabel}]: ${c.ruleA}\n` +
      `   - B [${c.ruleBLabel}]: ${c.ruleB}\n` +
      `   - 裁决: \`resolve_rule_conflict\` conflict_id="${c.id}" resolution=keep_a|keep_b|keep_both`
  );

  return `

## ⚠️ 待裁决的规则冲突

以下规则互相矛盾，**在用户裁决前不会写入生效规则**。请列出给用户选择：

${lines.join("\n\n")}
`;
}

function buildIndexSkillMarkdown(store: FrustrationStore): string {
  const { categories, records } = store;
  const byCategory = groupRecordsByCategory(records);

  const sortedCategories = [...categories].sort((a, b) => {
    const countA = byCategory.get(a.id)?.length ?? 0;
    const countB = byCategory.get(b.id)?.length ?? 0;
    return countB - countA;
  });

  const lastUpdated =
    records.length > 0 ? records[records.length - 1].timestamp : new Date().toISOString();

  const categoryIndex =
    sortedCategories.length > 0
      ? sortedCategories
          .map((c) => {
            const count = byCategory.get(c.id)?.length ?? 0;
            const relPath = `${CATEGORIES_DIR}/${c.id}/SKILL.md`;
            return `- **[${c.label}](${relPath})** (\`${c.id}\`, ${count} 次): ${c.description}`;
          })
          .join("\n")
      : "_暂无分类，第一次记录后会自动创建子 skill。_";

  return `---
name: user-frustration-patterns
description: >-
  用户挫败模式索引 skill。当用户表现出不耐烦、否定、重复强调或强烈负面情绪时，
  先阅读本索引，再按需打开对应分类子 skill（categories/*/SKILL.md）。
  Use when the user seems frustrated, angry, repeats prior feedback,
  or when reviewing how to interact with this user.
---

# 用户挫败模式 · 索引

> 由 frustration-tracker MCP 自动维护。详情在各分类子 skill，本文件仅作索引。
> 最后更新: ${lastUpdated.slice(0, 19).replace("T", " ")} | 共 ${records.length} 条 | ${categories.length} 个分类

## 怎么用

1. 用户表现出不满 → 先看下方分类索引，找到最相关的子 skill
2. 打开 \`categories/{分类id}/SKILL.md\` 阅读该类的规则和案例
3. 新记录写入后，只需更新对应子 skill，本索引同步刷新

## 分类索引

> 宽泛主题分类，同一类问题归一个子 skill。详情见各子 skill。

${categoryIndex}
${buildPendingConflictsSection(store)}
`;
}

function shortenForDisplay(text: string, maxLen = 48): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "…";
}

function buildCategorySkillMarkdown(
  store: FrustrationStore,
  category: FrustrationCategory,
  records: FrustrationRecord[]
): string {
  const rules = aggregateRules(store, records, 12);
  const examples = records
    .slice(-6)
    .map((r) => {
      const brief = shortenForDisplay(r.summary, 40);
      const rule = r.suggestedRule ? shortenForDisplay(r.suggestedRule, 56) : "";
      return rule
        ? `- **${r.timestamp.slice(0, 10)}**: ${brief} → ${rule}`
        : `- **${r.timestamp.slice(0, 10)}**: ${brief}`;
    })
    .join("\n");

  const lastUpdated =
    records.length > 0 ? records[records.length - 1].timestamp : category.createdAt;

  return `---
name: frustration-${category.id}
description: >-
  用户挫败模式 · ${category.label}。${category.description}
  当用户因${category.label}类问题不满时阅读本 skill。Part of user-frustration-patterns index.
---

# ${category.label}

> 子 skill · 索引见 [../SKILL.md](../SKILL.md)
> 累计 ${records.length} 次 | 最后更新: ${lastUpdated.slice(0, 19).replace("T", " ")}

## 分类说明

${category.description}

## 应遵守的规则

${rules.length > 0 ? rules.map((r) => `- ${r}`).join("\n") : "- （暂无，等待记录）"}

## 近期案例

${examples || "- （暂无）"}
${buildCategoryPendingConflicts(store, category.id)}
`;
}

function buildCategoryPendingConflicts(store: FrustrationStore, categoryId: string): string {
  const pending = store.conflicts.filter(
    (c) => c.status === "pending" && c.categoryId === categoryId
  );
  if (pending.length === 0) return "";

  const lines = pending.map(
    (c) =>
      `- [${c.ruleALabel}] ${c.ruleA}\n  **↕ 冲突**\n  [${c.ruleBLabel}] ${c.ruleB}\n  _${c.reason} — 待用户裁决_`
  );
  return `\n## ⚠️ 待裁决冲突\n\n${lines.join("\n\n")}\n`;
}

async function writeAllSkills(skillDir: string, store: FrustrationStore): Promise<void> {
  await ensureSkillDir(skillDir);
  await mkdir(join(skillDir, CATEGORIES_DIR), { recursive: true });

  const byCategory = groupRecordsByCategory(store.records);

  await writeFile(join(skillDir, "SKILL.md"), buildIndexSkillMarkdown(store), "utf-8");

  for (const category of store.categories) {
    const catDir = getCategorySkillDir(skillDir, category.id);
    await mkdir(catDir, { recursive: true });
    const records = byCategory.get(category.id) ?? [];
    await writeFile(
      join(catDir, "SKILL.md"),
      buildCategorySkillMarkdown(store, category, records),
      "utf-8"
    );
  }
}

function getCategoryLabel(store: FrustrationStore, id: string): string {
  return store.categories.find((c) => c.id === id)?.label ?? id;
}

export interface RecordFrustrationInput {
  userMessage: string;
  summary: string;
  suggestedRule: string;
  context?: string;
  detectionScore?: number;
  detectionSignals?: string[];
  categoryId?: string;
  categoryLabel?: string;
}

export interface RecordFrustrationResult {
  record: FrustrationRecord;
  skillPath: string;
  categorySkillPath: string;
  matchResult: CategoryMatchResult;
  isNewCategory: boolean;
  newConflicts: RuleConflict[];
}

function collectRulesInCategory(
  store: FrustrationStore,
  categoryId: string
): string[] {
  const rules = new Set<string>();
  for (const r of store.records) {
    if (r.category !== categoryId || !r.suggestedRule?.trim()) continue;
    if (!isRuleSuppressed(store, r.suggestedRule)) rules.add(r.suggestedRule.trim());
  }
  return [...rules];
}

function extractRulesFromStore(store: FrustrationStore): Array<{
  categoryId: string;
  categoryLabel: string;
  rule: string;
}> {
  const out: Array<{ categoryId: string; categoryLabel: string; rule: string }> = [];
  for (const r of store.records) {
    if (!r.suggestedRule?.trim() || isRuleSuppressed(store, r.suggestedRule)) continue;
    out.push({
      categoryId: r.category,
      categoryLabel: getCategoryLabel(store, r.category),
      rule: r.suggestedRule.trim(),
    });
  }
  return out;
}

function conflictExists(store: FrustrationStore, ruleA: string, ruleB: string): boolean {
  const a = ruleA.trim();
  const b = ruleB.trim();
  return store.conflicts.some(
    (c) =>
      c.status === "pending" &&
      ((c.ruleA.trim() === a && c.ruleB.trim() === b) ||
        (c.ruleA.trim() === b && c.ruleB.trim() === a))
  );
}

function detectConflictsForRecord(
  store: FrustrationStore,
  category: FrustrationCategory,
  newRule: string,
  recordId: string,
  customSkillDir?: string
): RuleConflict[] {
  const added: RuleConflict[] = [];
  const skip = new Set(store.suppressedRules.map((s) => s.trim()));

  const within = findConflictsWithRules(newRule, collectRulesInCategory(store, category.id), {
    skipRules: skip,
  });
  for (const hit of within) {
    if (conflictExists(store, newRule, hit.existingRule)) continue;
    added.push(
      createConflict({
        type: "within_category",
        categoryId: category.id,
        categoryLabel: category.label,
        ruleA: newRule.trim(),
        ruleB: hit.existingRule,
        ruleALabel: "新规则",
        ruleBLabel: "已有规则",
        reason: hit.reason,
        newRecordId: recordId,
      })
    );
  }

  return added;
}

async function detectCrossScopeConflictsAsync(
  store: FrustrationStore,
  customSkillDir?: string
): Promise<RuleConflict[]> {
  const projectDir = resolve(getSkillDir(customSkillDir));
  const globalDir = resolve(getDefaultSkillDir());
  if (projectDir === globalDir) return [];

  let globalStore: FrustrationStore;
  try {
    globalStore = await loadStore(globalDir);
  } catch {
    return [];
  }

  const projectRules = extractRulesFromStore(store);
  const globalRules = extractRulesFromStore(globalStore);
  const hits = findCrossScopeConflicts(projectRules, globalRules);
  const added: RuleConflict[] = [];

  for (const hit of hits) {
    if (conflictExists(store, hit.projectRule, hit.globalRule)) continue;
    added.push(
      createConflict({
        type: "cross_scope",
        categoryId: hit.categoryId,
        categoryLabel: hit.categoryLabel,
        ruleA: hit.projectRule,
        ruleB: hit.globalRule,
        ruleALabel: "项目规则",
        ruleBLabel: "全局规则",
        reason: hit.reason,
      })
    );
  }
  return added;
}

function getDefaultSkillDir(): string {
  return join(homedir(), ".cursor", "skills", SKILL_DIR_NAME);
}

async function resolveCategory(
  store: FrustrationStore,
  summary: string,
  categoryId?: string,
  categoryLabel?: string
): Promise<{ category: FrustrationCategory; matchResult: CategoryMatchResult; isNewCategory: boolean }> {
  if (categoryId) {
    const existing = store.categories.find((c) => c.id === categoryId);
    if (existing) {
      return {
        category: existing,
        matchResult: {
          action: "match",
          category: existing,
          score: 1,
          matchSource: "explicit_id",
          alternatives: [],
        },
        isNewCategory: false,
      };
    }
  }

  // category_id 无效但传了 category_label → 仍走 label 优先逻辑
  const matchResult = matchCategory(summary, store.categories, store.records, categoryLabel);
  return {
    category: matchResult.category,
    matchResult,
    isNewCategory: matchResult.action === "create",
  };
}

export async function addFrustrationRecord(
  input: RecordFrustrationInput,
  customSkillDir?: string
): Promise<RecordFrustrationResult> {
  const skillDir = getSkillDir(customSkillDir);
  await ensureSkillDir(skillDir);

  const store = await loadStore(skillDir);
  const { category, matchResult, isNewCategory } = await resolveCategory(
    store,
    input.summary,
    input.categoryId,
    input.categoryLabel
  );

  let finalCategory = category;
  if (isNewCategory) {
    if (store.categories.some((c) => c.id === category.id)) {
      finalCategory = { ...category, id: `${category.id}-${Date.now().toString(36)}` };
    }
    store.categories.push(finalCategory);
  } else {
    const idx = store.categories.findIndex((c) => c.id === finalCategory.id);
    if (idx >= 0) {
      store.categories[idx] = enrichCategoryKeywords(store.categories[idx], input.summary);
      finalCategory = store.categories[idx];
    }
  }

  const fullRecord: FrustrationRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userMessage: input.userMessage,
    summary: input.summary,
    category: finalCategory.id,
    suggestedRule: input.suggestedRule,
    context: input.context,
    detectionScore: input.detectionScore,
    detectionSignals: input.detectionSignals,
  };

  store.records.push(fullRecord);

  const withinConflicts = detectConflictsForRecord(
    store,
    finalCategory,
    input.suggestedRule,
    fullRecord.id,
    customSkillDir
  );
  const crossConflicts = await detectCrossScopeConflictsAsync(store, customSkillDir);
  const newConflicts = [...withinConflicts, ...crossConflicts];
  store.conflicts.push(...newConflicts);

  await saveStore(skillDir, store);
  await writeAllSkills(skillDir, store);

  const skillPath = join(skillDir, "SKILL.md");
  const categorySkillPath = getCategorySkillPath(skillDir, finalCategory.id);

  return {
    record: fullRecord,
    skillPath,
    categorySkillPath,
    matchResult,
    isNewCategory,
    newConflicts,
  };
}

export async function previewCategoryMatch(
  summary: string,
  categoryLabel: string | undefined,
  customSkillDir?: string
): Promise<CategoryMatchResult> {
  const store = await loadStore(getSkillDir(customSkillDir));
  return matchCategory(summary, store.categories, store.records, categoryLabel);
}

export async function readSkillContent(customSkillDir?: string): Promise<string> {
  const skillDir = getSkillDir(customSkillDir);
  try {
    const index = await readFile(getSkillPath(customSkillDir), "utf-8");
    const store = await loadStore(skillDir);

    if (store.categories.length === 0) {
      return index;
    }

    const sections: string[] = ["# 索引 Skill\n", index, "\n---\n# 分类子 Skills\n"];

    for (const cat of store.categories) {
      const catPath = getCategorySkillPath(skillDir, cat.id);
      try {
        const content = await readFile(catPath, "utf-8");
        sections.push(`\n## ${cat.label} (\`${cat.id}\`)\n\n${content}`);
      } catch {
        sections.push(`\n## ${cat.label} (\`${cat.id}\`)\n\n（子 skill 尚未生成）`);
      }
    }

    return sections.join("\n");
  } catch {
    return "（尚未生成 skill，第一次记录后会自动创建）";
  }
}

export async function getStats(customSkillDir?: string): Promise<{
  total: number;
  categoryCount: number;
  byCategory: Record<string, string>;
  skillPath: string;
  categoriesDir: string;
}> {
  const skillDir = getSkillDir(customSkillDir);
  const store = await loadStore(skillDir);
  const byCategory: Record<string, string> = {};
  for (const r of store.records) {
    const label = getCategoryLabel(store, r.category);
    byCategory[label] = String((Number(byCategory[label]) || 0) + 1);
  }
  return {
    total: store.records.length,
    categoryCount: store.categories.length,
    byCategory,
    skillPath: join(skillDir, "SKILL.md"),
    categoriesDir: join(skillDir, CATEGORIES_DIR),
  };
}

export async function listPendingConflicts(customSkillDir?: string): Promise<RuleConflict[]> {
  const store = await loadStore(getSkillDir(customSkillDir));
  return store.conflicts.filter((c) => c.status === "pending");
}

export async function resolveRuleConflict(
  conflictId: string,
  resolution: ConflictResolution,
  customSkillDir?: string
): Promise<{ ok: boolean; message: string }> {
  const skillDir = getSkillDir(customSkillDir);
  const store = await loadStore(skillDir);
  const conflict = store.conflicts.find((c) => c.id === conflictId);

  if (!conflict) return { ok: false, message: `未找到冲突 ${conflictId}` };
  if (conflict.status === "resolved") return { ok: false, message: "该冲突已裁决过" };

  conflict.status = "resolved";
  conflict.resolution = resolution;

  if (resolution === "keep_a") {
    store.suppressedRules.push(conflict.ruleB.trim());
  } else if (resolution === "keep_b") {
    store.suppressedRules.push(conflict.ruleA.trim());
  }
  // keep_both: 都不 suppress

  await saveStore(skillDir, store);
  await writeAllSkills(skillDir, store);

  const labels = { keep_a: conflict.ruleALabel, keep_b: conflict.ruleBLabel, keep_both: "两者都保留" };
  return {
    ok: true,
    message: `已裁决：${labels[resolution]}。skill 已更新。`,
  };
}

export async function checkScopeConflicts(customSkillDir?: string): Promise<RuleConflict[]> {
  const skillDir = getSkillDir(customSkillDir);
  const store = await loadStore(skillDir);
  const fresh = await detectCrossScopeConflictsAsync(store, customSkillDir);

  for (const c of fresh) {
    if (!conflictExists(store, c.ruleA, c.ruleB)) {
      store.conflicts.push(c);
    }
  }

  if (fresh.length > 0) {
    await saveStore(skillDir, store);
    await writeAllSkills(skillDir, store);
  }

  return store.conflicts.filter((x) => x.status === "pending" && x.type === "cross_scope");
}

export async function listCategories(customSkillDir?: string): Promise<FrustrationCategory[]> {
  const store = await loadStore(getSkillDir(customSkillDir));
  return store.categories;
}

export { type RuleConflict, type ConflictResolution };
