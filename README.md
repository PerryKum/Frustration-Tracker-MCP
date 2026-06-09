# Frustration Tracker MCP

检测你在 IDE 里的挫败/生气信号，总结原因，自动分类写入个人 Skill，让 Agent 以后少踩同样的坑。

## 支持的 IDE

路径与格式定义见 [`scripts/lib/ide-profiles.mjs`](scripts/lib/ide-profiles.mjs)，安装脚本按当前操作系统写入对应文件。

| IDE | 项目配置 | Skill | 文档 |
|-----|---------|-------|------|
| **Cursor** | `.cursor/mcp.json` | ✓ 自动加载 | [MCP](https://docs.cursor.com/context/mcp) |
| **VS Code (Copilot)** | `.vscode/mcp.json` | — | [MCP](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) |
| **Claude Desktop** | — | — | [MCP](https://support.claude.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop) |
| **Windsurf** | `.windsurf/mcp.json` | — | [MCP](https://docs.windsurf.com/windsurf/cascade/mcp) |
| **Trae** | `.trae/mcp.json` | — | [MCP](https://www.volcengine.com/docs/86677/2137601) |
| **Claude Code** | `.mcp.json` | — | [MCP](https://code.claude.com/docs/en/mcp) |

### 全局配置路径

| IDE | macOS | Windows | Linux |
|-----|-------|---------|-------|
| Cursor | `~/.cursor/mcp.json` | `%APPDATA%\Cursor\mcp.json` | `~/.config/cursor/mcp.json` |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` | `~/.config/Code/User/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` | `~/.config/Claude/claude_desktop_config.json` |
| Windsurf | `~/.windsurf/mcp.json` | `%APPDATA%\Windsurf\mcp.json` | `~/.config/windsurf/mcp.json` |
| Trae | `~/.trae/mcp.json` | `%USERPROFILE%\.trae\mcp.json` | `~/.trae/mcp.json` |
| Claude Code | `~/.claude.json` | `%USERPROFILE%\.claude.json` | `~/.claude.json` |

Windsurf 全局安装时会**同时写入**旧版路径 `~/.codeium/windsurf/mcp_config.json` 以兼容旧版本。

### 格式差异

| IDE | JSON 根键 | stdio 需 `type` |
|-----|----------|----------------|
| Cursor / Claude / Windsurf / Trae / Claude Code | `mcpServers` | Claude Code 项目级需要 |
| VS Code | `servers` | 需要 `type: "stdio"` |

Claude Code 的 MCP **只能**写在 `~/.claude.json` 或项目 `.mcp.json`，写入 `~/.claude/settings.json` 会被静默忽略。

选「项目级」时，不支持项目配置的 IDE（Claude Desktop）仍会写入全局配置。

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

### Windows

双击 `configure.bat`

### macOS

```bash
chmod +x configure.sh   # 首次需要
./configure.sh
```

浏览器会自动打开配置页。macOS 上「浏览」按钮可用（系统文件夹选择器）。

全局 MCP 写入路径（安装脚本自动解析）：

| IDE | macOS 全局路径 |
|-----|---------------|
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windsurf | `~/.windsurf/mcp.json`（并同步 `~/.codeium/windsurf/mcp_config.json`） |
| Trae | `~/.trae/mcp.json` |
| Claude Code | `~/.claude.json` |

未安装 Node.js 时：`brew install node`

### Linux

```bash
chmod +x configure.sh
./configure.sh
```

Linux 需手动输入项目路径（暂无文件夹选择器）。

### 通用

```bash
npm run configure
```

配置页面中可勾选 IDE、选择全局/项目范围、指定 Skill 输出路径，一键完成编译与写入。项目级配置会自动更新 `.gitignore`。

## 手动配置

多数 IDE 使用 `mcpServers` 根键：

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

VS Code 使用 `servers` 根键，并需 `"type": "stdio"`：

```json
{
  "servers": {
    "frustration-tracker": {
      "type": "stdio",
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
