import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export const IDE_PROFILES = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    format: "mcpServers",
    skillAutoLoad: true,
    globalPath: () => join(homedir(), ".cursor", "mcp.json"),
    projectPath: (p) => join(p, ".cursor", "mcp.json"),
    rulePath: (scope, p) =>
      scope === "project" && p
        ? join(p, ".cursor", "rules", "frustration-tracker.mdc")
        : join(homedir(), ".cursor", "rules", "frustration-tracker.mdc"),
    ruleCopy: "file",
  },
  vscode: {
    id: "vscode",
    label: "VS Code (Copilot)",
    format: "vscodeServers",
    skillAutoLoad: false,
    globalPath: null,
    projectPath: (p) => join(p, ".vscode", "mcp.json"),
    rulePath: null,
    ruleCopy: "none",
    note: "VS Code 仅支持项目级 .vscode/mcp.json",
  },
  claudeDesktop: {
    id: "claudeDesktop",
    label: "Claude Desktop",
    format: "mcpServers",
    skillAutoLoad: false,
    globalPath: () => claudeDesktopConfigPath(),
    projectPath: null,
    rulePath: null,
    ruleCopy: "none",
    note: "仅全局配置",
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    format: "mcpServers",
    skillAutoLoad: false,
    globalPath: () => join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    projectPath: null,
    rulePath: null,
    ruleCopy: "none",
    note: "仅全局配置，修改后需重启 Windsurf",
  },
  trae: {
    id: "trae",
    label: "Trae",
    format: "mcpServers",
    skillAutoLoad: false,
    globalPath: () => traeGlobalMcpPath(),
    projectPath: (p) => join(p, ".trae", "mcp.json"),
    rulePath: (scope, p) =>
      scope === "project" && p
        ? join(p, ".trae", "project_rules.md")
        : join(homedir(), ".trae", "user_rules.md"),
    ruleCopy: "append",
    note: "规则写入 .trae/project_rules.md",
  },
  claudeCode: {
    id: "claudeCode",
    label: "Claude Code",
    format: "mcpServers",
    skillAutoLoad: false,
    globalPath: () => join(homedir(), ".claude.json"),
    projectPath: (p) => join(p, ".mcp.json"),
    rulePath: null,
    ruleCopy: "none",
    note: "项目级用 .mcp.json；全局写入 ~/.claude.json 的 mcpServers",
  },
};

export const ALL_IDE_IDS = Object.keys(IDE_PROFILES);

function claudeDesktopConfigPath() {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? homedir(), "Claude", "claude_desktop_config.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function traeGlobalMcpPath() {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? homedir(), "Trae", "User", "mcp.json");
  }
  return join(homedir(), ".config", "Trae", "User", "mcp.json");
}

export function resolveMcpPath(ideId, scope, projectPath) {
  const profile = IDE_PROFILES[ideId];
  if (!profile) throw new Error(`未知 IDE: ${ideId}`);

  if (scope === "project" && projectPath && profile.projectPath) {
    return profile.projectPath(projectPath);
  }

  if (profile.globalPath) {
    return profile.globalPath();
  }

  return null;
}

export function buildServerEntry(format, serverPath, skillDirPosix) {
  const env = { FRUSTRATION_SKILL_DIR: skillDirPosix };

  if (format === "vscodeServers") {
    return {
      type: "stdio",
      command: "node",
      args: [serverPath],
      env,
    };
  }

  return {
    command: "node",
    args: [serverPath],
    env,
  };
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function ensureMcpServersRoot(config) {
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  return config;
}

function ensureVscodeServersRoot(config) {
  if (!config.servers || typeof config.servers !== "object") {
    config.servers = {};
  }
  return config;
}

export function writeIdeMcpConfig({ ideId, configPath, serverPath, skillDirPosix }) {
  if (!configPath) {
    return { skipped: true, reason: "该 IDE 不支持此配置范围" };
  }

  const profile = IDE_PROFILES[ideId];
  mkdirSync(dirname(configPath), { recursive: true });

  const entry = buildServerEntry(profile.format, serverPath, skillDirPosix);
  let config = readJsonFile(configPath);

  if (profile.format === "vscodeServers") {
    config = ensureVscodeServersRoot(config);
    config.servers["frustration-tracker"] = entry;
  } else if (ideId === "claudeCode" && configPath.endsWith(".claude.json")) {
    config = ensureMcpServersRoot(config);
    config.mcpServers["frustration-tracker"] = entry;
  } else {
    config = ensureMcpServersRoot(config);
    config.mcpServers["frustration-tracker"] = entry;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { skipped: false, path: configPath };
}

const RULE_MARKER = "<!-- frustration-tracker MCP -->";

export function installIdeRule({ ideId, scope, projectPath, ruleSourcePath }) {
  const profile = IDE_PROFILES[ideId];
  if (profile.ruleCopy === "none" || !existsSync(ruleSourcePath)) return null;

  const rulePath = profile.rulePath?.(scope, projectPath);
  if (!rulePath) return null;

  mkdirSync(dirname(rulePath), { recursive: true });

  if (profile.ruleCopy === "file") {
    copyFileSync(ruleSourcePath, rulePath);
    return rulePath;
  }

  if (profile.ruleCopy === "append") {
    const body = readFileSync(ruleSourcePath, "utf-8");
    const block = `\n\n${RULE_MARKER}\n${stripMdcFrontmatter(body)}\n`;
    let content = existsSync(rulePath) ? readFileSync(rulePath, "utf-8") : "";
    if (content.includes(RULE_MARKER)) {
      content = content.split(RULE_MARKER)[0].trimEnd();
    }
    writeFileSync(rulePath, content + block, "utf-8");
    return rulePath;
  }

  return null;
}

function stripMdcFrontmatter(text) {
  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end > 0) return text.slice(end + 3).trim();
  }
  return text.trim();
}
