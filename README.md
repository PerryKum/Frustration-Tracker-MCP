# Frustration Tracker MCP

检测你在 IDE 里的挫败/生气信号，总结原因，自动分类写入个人 Skill，让 Agent 以后少踩同样的坑。

## 支持的 IDE

配置界面可一次勾选多个 IDE，自动写入对应 MCP 配置：

| IDE | 全局配置 | 项目配置 | Skill 自动加载 | 说明 |
|-----|---------|---------|---------------|------|
| **Cursor** | `~/.cursor/mcp.json` | `.cursor/mcp.json` | ✓ | 含 Rule + Skill |
| **VS Code (Copilot)** | — | `.vscode/mcp.json` | — | `servers` + `type:stdio` |
| **Claude Desktop** | 系统 Claude 配置目录 | — | — | 仅全局 |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | — | — | 修改后需重启 |
| **Trae** | Trae User 目录 | `.trae/mcp.json` | — | 规则写入 `.trae/project_rules.md` |
| **Claude Code** | `~/.claude.json` | `.mcp.json` | — | 项目级优先 |

选「项目级」时，不支持项目配置的 IDE 会写入全局配置。

## 工作原理

Agent 在对话中主动调用 MCP 工具：

```
用户消息 → check_user_frustration
         → 若检测到挫败 → match_frustration_category → record_frustration
         → 写入 ~/.cursor/skills/user-frustration-patterns/
```

之后可通过 `get_frustration_patterns` 读取历史规则；Cursor 还会自动加载 Skill。

## 工具

| 工具 | 用途 |
|------|------|
| `check_user_frustration` | 检测用户消息是否带有生气信号 |
| `match_frustration_category` | 匹配已有分类或建议新建 |
| `record_frustration` | 记录原因、分类、规则，写入 Skill |
| `get_frustration_patterns` | 读取已积累的挫败模式 |
| `list_frustration_categories` | 列出已有分类 |
| `list_rule_conflicts` | 列出待裁决的规则冲突 |
| `resolve_rule_conflict` | 用户选择保留哪条规则 |
| `check_scope_conflicts` | 检测全局与项目 Skill 之间的冲突 |

## 安装

**Windows**：双击 `configure.bat`

**macOS / Linux**：

```bash
chmod +x configure.sh   # 首次需要
./configure.sh
```

或任意平台：

```bash
npm run configure
```

配置页面中可勾选 IDE、选择全局/项目范围、指定 Skill 输出路径，一键完成编译与写入。项目级配置会自动更新 `.gitignore`。

## 手动配置

编辑对应 IDE 的 MCP 配置，加入：

```json
{
  "mcpServers": {
    "frustration-tracker": {
      "command": "node",
      "args": ["/path/to/frustration-tracker-mcp/dist/index.js"],
      "env": {
        "FRUSTRATION_SKILL_DIR": "/path/to/user-frustration-patterns"
      }
    }
  }
}
```

`FRUSTRATION_SKILL_DIR` 可省略，默认 `~/.cursor/skills/user-frustration-patterns`。

## Skill 结构

```
user-frustration-patterns/
├── SKILL.md              # 分类索引
├── history.json
└── categories/
    └── 擅自改动/
        └── SKILL.md      # 该分类的规则与案例
```

**索引示例**：

```markdown
## 分类索引
- **[擅自改动](categories/擅自改动/SKILL.md)** (2 次): 未经用户同意修改不该动的文件、配置或代码
```

**子 skill 示例**：

```markdown
# 擅自改动

## 应遵守的规则
- 未经同意不修改 .gitignore
- 只改用户明确点名的文件

## 近期案例
- **2026-06-09**: 清理时擅自改 .gitignore → 未经同意不修改 .gitignore
```

## 开发

```bash
npm install
npm run build       # 仅编译
npm run configure   # 打开配置界面
```
