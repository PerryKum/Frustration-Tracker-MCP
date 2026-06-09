import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

/** @typedef {"mcpServers" | "vscodeServers"} ConfigFormat */

/**
 * @typedef {Object} IdeProfile
 * @property {string} id
 * @property {string} label
 * @property {ConfigFormat} format
 * @property {boolean} includeStdioType
 * @property {boolean} skillAutoLoad
 * @property {(() => string | null) | null} globalPath
 * @property {((projectPath: string) => string | null) | null} projectPath
 * @property {(() => string[]) | null} legacyGlobalPaths
 * @property {((scope: string, projectPath: string | null) => string | null) | null} rulePath
 * @property {"file" | "append" | "none"} ruleCopy
 * @property {string | null} docUrl
 * @property {Record<string, string>} globalPathDisplay
 * @property {string | null} projectPathDisplay
 * @property {string | null} note
 */

function appDataDir() {
  if (platform() === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return join(homedir(), ".config");
}

function cursorGlobalPath() {
  if (platform() === "win32") return join(appDataDir(), "Cursor", "mcp.json");
  if (platform() === "linux") return join(homedir(), ".config", "cursor", "mcp.json");
  return join(homedir(), ".cursor", "mcp.json");
}

function vscodeGlobalPath() {
  if (platform() === "win32") return join(appDataDir(), "Code", "User", "mcp.json");
  if (platform() === "darwin") return join(appDataDir(), "Code", "User", "mcp.json");
  return join(homedir(), ".config", "Code", "User", "mcp.json");
}

function claudeDesktopConfigPath() {
  if (platform() === "win32") {
    return join(appDataDir(), "Claude", "claude_desktop_config.json");
  }
  if (platform() === "darwin") {
    return join(appDataDir(), "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function windsurfGlobalPath() {
  if (platform() === "win32") return join(appDataDir(), "Windsurf", "mcp.json");
  if (platform() === "linux") return join(homedir(), ".config", "windsurf", "mcp.json");
  return join(homedir(), ".windsurf", "mcp.json");
}

function windsurfLegacyGlobalPaths() {
  return [join(homedir(), ".codeium", "windsurf", "mcp_config.json")];
}

function traeGlobalPath() {
  return join(homedir(), ".trae", "mcp.json");
}

/** @type {Record<string, IdeProfile>} */
export const IDE_PROFILES = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    format: "mcpServers",
    includeStdioType: false,
    skillAutoLoad: true,
    globalPath: () => cursorGlobalPath(),
    projectPath: (p) => join(p, ".cursor", "mcp.json"),
    legacyGlobalPaths: null,
    rulePath: (scope, p) =>
      scope === "project" && p
        ? join(p, ".cursor", "rules", "frustration-tracker.mdc")
        : join(homedir(), ".cursor", "rules", "frustration-tracker.mdc"),
    ruleCopy: "file",
    docUrl: "https://docs.cursor.com/context/mcp",
    globalPathDisplay: {
      macOS: "~/.cursor/mcp.json",
      Windows: "%APPDATA%\\Cursor\\mcp.json",
      Linux: "~/.config/cursor/mcp.json",
    },
    projectPathDisplay: ".cursor/mcp.json",
    note: "含 Rule + Skill 自动加载",
  },
  vscode: {
    id: "vscode",
    label: "VS Code (Copilot)",
    format: "vscodeServers",
    includeStdioType: true,
    skillAutoLoad: false,
    globalPath: () => vscodeGlobalPath(),
    projectPath: (p) => join(p, ".vscode", "mcp.json"),
    legacyGlobalPaths: null,
    rulePath: null,
    ruleCopy: "none",
    docUrl: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    globalPathDisplay: {
      macOS: "~/Library/Application Support/Code/User/mcp.json",
      Windows: "%APPDATA%\\Code\\User\\mcp.json",
      Linux: "~/.config/Code/User/mcp.json",
    },
    projectPathDisplay: ".vscode/mcp.json",
    note: "根键为 servers，需 type:stdio",
  },
  claudeDesktop: {
    id: "claudeDesktop",
    label: "Claude Desktop",
    format: "mcpServers",
    includeStdioType: false,
    skillAutoLoad: false,
    globalPath: () => claudeDesktopConfigPath(),
    projectPath: null,
    legacyGlobalPaths: null,
    rulePath: null,
    ruleCopy: "none",
    docUrl: "https://support.claude.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop",
    globalPathDisplay: {
      macOS: "~/Library/Application Support/Claude/claude_desktop_config.json",
      Windows: "%APPDATA%\\Claude\\claude_desktop_config.json",
      Linux: "~/.config/Claude/claude_desktop_config.json",
    },
    projectPathDisplay: null,
    note: "仅全局；根键 mcpServers",
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    format: "mcpServers",
    includeStdioType: false,
    skillAutoLoad: false,
    globalPath: () => windsurfGlobalPath(),
    projectPath: (p) => join(p, ".windsurf", "mcp.json"),
    legacyGlobalPaths: () => windsurfLegacyGlobalPaths(),
    rulePath: null,
    ruleCopy: "none",
    docUrl: "https://docs.windsurf.com/windsurf/cascade/mcp",
    globalPathDisplay: {
      macOS: "~/.windsurf/mcp.json",
      Windows: "%APPDATA%\\Windsurf\\mcp.json",
      Linux: "~/.config/windsurf/mcp.json",
      legacy: "~/.codeium/windsurf/mcp_config.json（旧版，安装时会同步写入）",
    },
    projectPathDisplay: ".windsurf/mcp.json",
    note: "修改后需重启 Windsurf",
  },
  trae: {
    id: "trae",
    label: "Trae",
    format: "mcpServers",
    includeStdioType: false,
    skillAutoLoad: false,
    globalPath: () => traeGlobalPath(),
    projectPath: (p) => join(p, ".trae", "mcp.json"),
    legacyGlobalPaths: null,
    rulePath: (scope, p) =>
      scope === "project" && p
        ? join(p, ".trae", "project_rules.md")
        : join(homedir(), ".trae", "user_rules.md"),
    ruleCopy: "append",
    docUrl: "https://www.volcengine.com/docs/86677/2137601",
    globalPathDisplay: {
      all: "~/.trae/mcp.json",
    },
    projectPathDisplay: ".trae/mcp.json",
    note: "规则追加到 .trae/project_rules.md",
  },
  claudeCode: {
    id: "claudeCode",
    label: "Claude Code",
    format: "mcpServers",
    includeStdioType: true,
    skillAutoLoad: false,
    globalPath: () => join(homedir(), ".claude.json"),
    projectPath: (p) => join(p, ".mcp.json"),
    legacyGlobalPaths: null,
    rulePath: null,
    ruleCopy: "none",
    docUrl: "https://code.claude.com/docs/en/mcp",
    globalPathDisplay: {
      all: "~/.claude.json（mcpServers 键；勿写入 settings.json）",
    },
    projectPathDisplay: ".mcp.json（项目根目录）",
    note: "官方不支持 ~/.claude/settings.json 存 MCP",
  },
};

export const ALL_IDE_IDS = Object.keys(IDE_PROFILES);

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

/** 返回应写入的全部 MCP 配置路径（含兼容旧路径） */
export function resolveAllMcpPaths(ideId, scope, projectPath) {
  const profile = IDE_PROFILES[ideId];
  if (!profile) return [];

  const paths = [];
  const primary = resolveMcpPath(ideId, scope, projectPath);
  if (primary) paths.push(primary);

  if (scope !== "project" && profile.legacyGlobalPaths) {
    for (const legacy of profile.legacyGlobalPaths()) {
      if (legacy && !paths.includes(legacy)) paths.push(legacy);
    }
  }

  return paths;
}

export function buildServerEntry(format, serverPath, skillDirPosix, includeStdioType = false) {
  const env = { FRUSTRATION_SKILL_DIR: skillDirPosix };

  if (format === "vscodeServers") {
    return {
      type: "stdio",
      command: "node",
      args: [serverPath],
      env,
    };
  }

  const entry = {
    command: "node",
    args: [serverPath],
    env,
  };

  if (includeStdioType) {
    entry.type = "stdio";
  }

  return entry;
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

  const entry = buildServerEntry(
    profile.format,
    serverPath,
    skillDirPosix,
    profile.includeStdioType
  );
  let config = readJsonFile(configPath);

  if (profile.format === "vscodeServers") {
    config = ensureVscodeServersRoot(config);
    config.servers["frustration-tracker"] = entry;
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
