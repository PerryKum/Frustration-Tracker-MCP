#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectFrustration } from "./detector.js";
import {
  addFrustrationRecord,
  getStats,
  readSkillContent,
  getSkillDir,
  listCategories,
  previewCategoryMatch,
  loadStore,
  listPendingConflicts,
  resolveRuleConflict,
  checkScopeConflicts,
} from "./skillWriter.js";

const SKILL_DIR = process.env.FRUSTRATION_SKILL_DIR;

const server = new McpServer({
  name: "frustration-tracker",
  version: "1.1.0",
});

server.tool(
  "check_user_frustration",
  `检测用户消息是否带有生气/挫败情绪。当用户语气变冲、重复强调、明确否定、或使用强烈负面词时调用。
返回检测结果；若 is_frustrated 为 true，应继续调用 match_frustration_category 匹配分类，再 record_frustration。`,
  {
    user_message: z.string().describe("用户最新一条消息原文"),
    conversation_context: z
      .string()
      .optional()
      .describe("可选：最近几轮对话摘要，帮助判断是否在重复犯错"),
  },
  async ({ user_message, conversation_context }) => {
    const combined = conversation_context
      ? `${user_message}\n${conversation_context}`
      : user_message;
    const result = detectFrustration(combined);
    const store = await loadStore(getSkillDir(SKILL_DIR));
    const existingCategories = store.categories.map(
      (c) => `${c.id}: ${c.label} — ${c.description}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              is_frustrated: result.isFrustrated,
              score: result.score,
              signals: result.signals,
              existing_categories: existingCategories,
              next_step: result.isFrustrated
                ? "1. 总结生气原因 → 2. 调用 match_frustration_category 匹配已有分类 → 3. 调用 record_frustration 写入"
                : "暂未检测到明显挫败信号，继续正常对话",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "match_frustration_category",
  `根据生气原因匹配已有宽泛分类，匹配不上才新建。
category_label 一旦传入，将严格按该主题归类，不会被 summary 内容带偏。
record_frustration 时必须传返回的 category_id，确保与 match 结果一致。`,
  {
    summary: z.string().describe("一句话总结：用户为什么生气"),
    category_label: z
      .string()
      .optional()
      .describe("宽泛主题，2~6 字，如「擅自改动」「理解偏差」。禁止含文件名或具体路径"),
  },
  async ({ summary, category_label }) => {
    const result = await previewCategoryMatch(summary, category_label, SKILL_DIR);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              action: result.action,
              recommended_category: {
                id: result.category.id,
                label: result.category.label,
                description: result.category.description,
              },
              match_source: result.matchSource,
              match_score: Math.round(result.score * 100) / 100,
              alternatives: result.alternatives.map((a) => ({
                id: a.category.id,
                label: a.category.label,
                score: Math.round(a.score * 100) / 100,
              })),
              label_warning: result.labelWarning ?? null,
              hint:
                result.action === "match"
                  ? `归入「${result.category.label}」。record_frustration 必须传 category_id="${result.category.id}"（不要改传别的 label）`
                  : `将新建「${result.category.label}」。record_frustration 传 category_label="${result.category.label}"`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "record_frustration",
  `记录挫败事件。必须先 match_frustration_category，再原样传入返回的 category_id。
禁止自行改分类：match 说归入 A 就不能记到 B。具体约束写 suggested_rule。`,
  {
    user_message: z.string().describe("触发挫败感的用户原话"),
    summary: z.string().describe("内部用，一句话总结原因（不写入 skill 正文）"),
    suggested_rule: z
      .string()
      .describe("写入子 skill 的具体规则"),
    category_id: z
      .string()
      .optional()
      .describe("【必传】match_frustration_category 返回的 category id，不要自行编造或改传"),
    category_label: z
      .string()
      .optional()
      .describe("宽泛主题 2~6 字，如「擅自改动」。禁止用具体事件名作分类名"),
    context: z
      .string()
      .optional()
      .describe("可选：当时正在做什么任务、Agent 做了什么导致用户不满"),
  },
  async ({ user_message, summary, suggested_rule, category_id, category_label, context }) => {
    const detection = detectFrustration(user_message);

    const { record, skillPath, categorySkillPath, matchResult, isNewCategory, newConflicts } =
      await addFrustrationRecord(
      {
        userMessage: user_message,
        summary,
        suggestedRule: suggested_rule,
        context,
        categoryId: category_id,
        categoryLabel: category_label,
        detectionScore: detection.score,
        detectionSignals: detection.signals,
      },
      SKILL_DIR
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              record_id: record.id,
              category: {
                id: record.category,
                label: matchResult.category.label,
                is_new: isNewCategory,
              },
              match_source: matchResult.matchSource,
              match_action: matchResult.action,
              match_score: Math.round(matchResult.score * 100) / 100,
              index_skill: skillPath,
              category_skill: categorySkillPath,
              message: isNewCategory
                ? `已新建分类子 skill「${matchResult.category.label}」并记录`
                : `已更新分类子 skill「${matchResult.category.label}」`,
              conflicts_detected: newConflicts.map((c) => ({
                conflict_id: c.id,
                type: c.type,
                reason: c.reason,
                rule_a: { label: c.ruleALabel, text: c.ruleA },
                rule_b: { label: c.ruleBLabel, text: c.ruleB },
              })),
              user_action_required:
                newConflicts.length > 0
                  ? "发现规则冲突！请向用户列出冲突项，让用户选择后调用 resolve_rule_conflict"
                  : null,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_frustration_patterns",
  "读取已积累的用户挫败模式 skill 内容。开始复杂任务前或用户再次表现出不满时调用，避免重复踩坑。",
  {},
  async () => {
    const content = await readSkillContent(SKILL_DIR);
    const stats = await getStats(SKILL_DIR);

    return {
      content: [
        {
          type: "text" as const,
          text: `## 统计\n- 总记录: ${stats.total}\n- 分类数: ${stats.categoryCount}\n- 索引 Skill: ${stats.skillPath}\n- 子 Skill 目录: ${stats.categoriesDir}\n- 分类计数: ${JSON.stringify(stats.byCategory, null, 2)}\n\n## Skill 内容\n\n${content}`,
        },
      ],
    };
  }
);

server.tool(
  "list_frustration_categories",
  "列出从历次记录中归纳出的挫败分类（非预设列表）。记录新事件前可先查看已有分类。",
  {},
  async () => {
    const categories = await listCategories(SKILL_DIR);
    if (categories.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "暂无分类。第一次记录生气原因后会自动创建分类。\n\nSkill 目录: " + getSkillDir(SKILL_DIR),
          },
        ],
      };
    }

    const lines = categories.map(
      (c) => `- \`${c.id}\` **${c.label}**: ${c.description}\n  子 skill: categories/${c.id}/SKILL.md`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `## 已有分类（从记录归纳，共 ${categories.length} 个）\n\n${lines.join("\n")}\n\nSkill 目录: ${getSkillDir(SKILL_DIR)}`,
        },
      ],
    };
  }
);

server.tool(
  "list_rule_conflicts",
  `列出待用户裁决的规则冲突（同分类内矛盾、或全局 skill vs 项目 skill）。
发现冲突后必须展示给用户，让用户选择保留哪条。`,
  {},
  async () => {
    const pending = await listPendingConflicts(SKILL_DIR);
    if (pending.length === 0) {
      return {
        content: [{ type: "text" as const, text: "暂无待裁决的规则冲突。" }],
      };
    }

    const formatted = pending.map((c, i) => ({
      index: i + 1,
      conflict_id: c.id,
      type: c.type === "cross_scope" ? "全局 ↔ 项目" : "同分类",
      category: c.categoryLabel,
      reason: c.reason,
      option_a: { label: c.ruleALabel, rule: c.ruleA },
      option_b: { label: c.ruleBLabel, rule: c.ruleB },
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              count: pending.length,
              conflicts: formatted,
              hint: "请让用户选择：保留 A → resolution=keep_a，保留 B → keep_b，都保留 → keep_both，然后调用 resolve_rule_conflict",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "resolve_rule_conflict",
  `用户裁决规则冲突。keep_a=保留 A 废弃 B，keep_b=保留 B 废弃 A，keep_both=都保留。`,
  {
    conflict_id: z.string().describe("list_rule_conflicts 或 record_frustration 返回的 conflict_id"),
    resolution: z
      .enum(["keep_a", "keep_b", "keep_both"])
      .describe("keep_a 保留 A；keep_b 保留 B；keep_both 两者都保留"),
  },
  async ({ conflict_id, resolution }) => {
    const result = await resolveRuleConflict(conflict_id, resolution, SKILL_DIR);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "check_scope_conflicts",
  "检测当前项目 skill 与全局 skill (~/.cursor/skills/) 之间的规则冲突。打开项目时可主动调用。",
  {},
  async () => {
    const conflicts = await checkScopeConflicts(SKILL_DIR);
    if (conflicts.length === 0) {
      return {
        content: [{ type: "text" as const, text: "未发现全局与项目 skill 之间的规则冲突。" }],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              count: conflicts.length,
              conflicts: conflicts.map((c) => ({
                conflict_id: c.id,
                category: c.categoryLabel,
                reason: c.reason,
                project_rule: c.ruleA,
                global_rule: c.ruleB,
              })),
              hint: "请展示给用户并调用 resolve_rule_conflict 裁决",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("frustration-tracker-mcp failed:", err);
  process.exit(1);
});
