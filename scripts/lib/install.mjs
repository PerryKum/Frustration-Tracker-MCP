import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_IDE_IDS,
  IDE_PROFILES,
  resolveMcpPath,
  resolveAllMcpPaths,
  writeIdeMcpConfig,
  installIdeRule,
} from "./ide-profiles.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(__dirname, "..", "..");
const serverPath = join(projectRoot, "dist", "index.js").replace(/\\/g, "/");
export const SKILL_FOLDER = "user-frustration-patterns";

const RULE_SOURCE_CANDIDATES = [
  join(projectRoot, "templates", "frustration-tracker.mdc"),
  join(projectRoot, ".cursor", "rules", "frustration-tracker.mdc"),
];

export function expandUserPath(input) {
  if (!input?.trim()) return input;
  let p = input.trim();
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = join(homedir(), p.slice(2));
  }
  return resolve(p);
}

export function resolveRuleSource() {
  for (const candidate of RULE_SOURCE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `未找到规则模板 frustration-tracker.mdc，请确认在 MCP 项目根目录运行安装（${projectRoot}）`
  );
}

/** 只保留用户勾选的 IDE，去重；非法 id 单独报错，不静默跳过 */
export function normalizeSelectedIdes(ides) {
  if (Array.isArray(ides)) {
    return [...new Set(ides.map((id) => String(id).trim()).filter(Boolean))];
  }
  if (typeof ides === "string" && ides.trim()) {
    return [ides.trim()];
  }
  return [];
}

function installSingleIde({
  ideId,
  scope,
  resolvedProjectPath,
  skillDirPosix,
  onLog,
}) {
  const profile = IDE_PROFILES[ideId];
  if (!profile) {
    return {
      ide: ideId,
      label: ideId,
      ok: false,
      error: `未知 IDE: ${ideId}`,
    };
  }

  const log = onLog ?? (() => {});
  const configPaths = resolveAllMcpPaths(ideId, scope, resolvedProjectPath);

  if (configPaths.length === 0) {
    return {
      ide: ideId,
      label: profile.label,
      ok: false,
      skipped: true,
      reason: scope === "project" ? "不支持项目级" : "不支持全局",
    };
  }

  try {
    for (const configPath of configPaths) {
      writeIdeMcpConfig({
        ideId,
        configPath,
        serverPath,
        skillDirPosix,
      });
      if (!existsSync(configPath)) {
        throw new Error(`MCP 配置写入失败: ${configPath}`);
      }
      log(`[${profile.label}] → ${configPath}`);
    }

    let rulePath = null;
    if (profile.ruleCopy !== "none") {
      const ruleSource = resolveRuleSource();
      rulePath = installIdeRule({
        ideId,
        scope,
        projectPath: resolvedProjectPath,
        ruleSourcePath: ruleSource,
      });
      if (profile.ruleCopy === "file" && !rulePath) {
        throw new Error(`Rule 安装失败（${profile.label}）`);
      }
      if (rulePath && !existsSync(rulePath)) {
        throw new Error(`Rule 文件写入失败: ${rulePath}`);
      }
    }

    return {
      ide: ideId,
      label: profile.label,
      ok: true,
      mcpPath: configPaths[0],
      mcpPaths: configPaths,
      rulePath: rulePath ?? undefined,
      skillAutoLoad: profile.skillAutoLoad,
      note: profile.note,
      docUrl: profile.docUrl,
    };
  } catch (err) {
    return {
      ide: ideId,
      label: profile.label,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function toPosixPath(p) {
  return p.replace(/\\/g, "/");
}

export function getDefaultSkillDir() {
  return join(homedir(), ".cursor", "skills", SKILL_FOLDER);
}

export function getProjectSkillDir(projectPath) {
  return join(expandUserPath(projectPath), ".cursor", "skills", SKILL_FOLDER);
}

export function isBuilt() {
  return existsSync(join(projectRoot, "dist", "index.js"));
}

export function runBuild(onLog) {
  const log = onLog ?? ((msg) => console.log(msg));

  log("安装依赖...");
  let result = spawnSync("npm", ["install"], {
    cwd: projectRoot,
    stdio: "pipe",
    shell: true,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "npm install 失败");
  }

  log("编译 TypeScript...");
  result = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    stdio: "pipe",
    shell: true,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "npm run build 失败");
  }

  if (!isBuilt()) {
    throw new Error("编译完成但未找到 dist/index.js");
  }
}

export function readCurrentConfig() {
  const globalMcp = join(homedir(), ".cursor", "mcp.json");
  let skillDir = getDefaultSkillDir();
  let configured = false;

  if (existsSync(globalMcp)) {
    try {
      const config = JSON.parse(readFileSync(globalMcp, "utf-8"));
      const entry = config.mcpServers?.["frustration-tracker"];
      if (entry) {
        configured = true;
        skillDir = entry.env?.FRUSTRATION_SKILL_DIR ?? skillDir;
      }
    } catch {
      /* ignore */
    }
  }

  return { configured, skillDir };
}

export function browseFolder() {
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = '选择目录'",
      "$d.ShowNewFolderButton = $true",
      "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
    ].join("; ");

    const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      encoding: "utf-8",
      shell: true,
    });
    return result.stdout?.trim() || null;
  }

  if (process.platform === "darwin") {
    const script = 'POSIX path of (choose folder with prompt "选择目录")';
    const result = spawnSync("osascript", ["-e", script], {
      encoding: "utf-8",
    });
    if (result.status !== 0) return null;
    const picked = result.stdout?.trim();
    return picked ? picked.replace(/\/$/, "") : null;
  }

  return null;
}

const GITIGNORE_MARKER = "# frustration-tracker MCP";

function toGitignoreEntry(projectPath, targetPath) {
  const rel = toPosixPath(relative(resolve(projectPath), resolve(targetPath)));
  if (rel.startsWith("..")) return null;
  const dir = rel.endsWith("/") ? rel : `${rel}/`;
  return dir === "./" ? null : dir;
}

export function updateProjectGitignore(projectPath, skillDir, ides = ["cursor"]) {
  const gitignorePath = join(projectPath, ".gitignore");
  const entries = new Set();

  if (ides.includes("cursor")) entries.add(".cursor/skills/user-frustration-patterns/");
  const skillEntry = toGitignoreEntry(projectPath, skillDir);
  if (skillEntry) entries.add(skillEntry);

  const existedBefore = existsSync(gitignorePath);
  let content = existedBefore ? readFileSync(gitignorePath, "utf-8") : "";
  const missing = [...entries].filter((e) => !content.includes(e));

  if (missing.length === 0) {
    return { gitignorePath, added: [], created: !existedBefore };
  }

  const block = ["", GITIGNORE_MARKER, ...missing, ""].join("\n");
  const newContent =
    content === "" ? block.trimStart() + "\n" : content.replace(/\s*$/, "") + block;

  writeFileSync(gitignorePath, newContent.endsWith("\n") ? newContent : newContent + "\n", "utf-8");

  return { gitignorePath, added: missing, created: !existedBefore };
}

export function installAndConfigure({
  scope,
  projectPath,
  skillDir,
  ides,
  skipBuild = false,
  onLog,
}) {
  const log = onLog ?? (() => {});

  const selectedIdes = normalizeSelectedIdes(ides);
  if (!selectedIdes.length) {
    throw new Error("请至少选择一个 IDE");
  }

  const resolvedProjectPath = projectPath ? expandUserPath(projectPath) : undefined;
  const resolvedSkillDir = expandUserPath(skillDir);

  if (scope === "project" && !resolvedProjectPath) {
    throw new Error("项目级配置需要填写项目路径");
  }

  if (!skipBuild || !isBuilt()) {
    runBuild(log);
  }

  mkdirSync(resolvedSkillDir, { recursive: true });

  const skillDirPosix = toPosixPath(resolvedSkillDir);
  const results = [];
  const rules = [];

  for (const ideId of selectedIdes) {
    const result = installSingleIde({
      ideId,
      scope,
      resolvedProjectPath,
      skillDirPosix,
      onLog: log,
    });
    results.push(result);
    if (result.ok && result.rulePath) {
      rules.push({ ide: ideId, path: result.rulePath });
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // 仅当全部失败时抛错；部分成功照常返回，各 IDE 结果在 results 里各自独立
  if (succeeded.length === 0) {
    const detail = failed
      .map((r) => `[${r.label}] ${r.error ?? r.reason ?? "失败"}`)
      .join("\n");
    throw new Error(detail);
  }

  const succeededIdes = succeeded.map((r) => r.ide);
  let gitignore = null;
  if (scope === "project" && resolvedProjectPath) {
    gitignore = updateProjectGitignore(resolvedProjectPath, resolvedSkillDir, succeededIdes);
    if (gitignore.added.length > 0) {
      log(`已更新 .gitignore: ${gitignore.added.join(", ")}`);
    }
  }

  return {
    skillDir: resolvedSkillDir,
    scope,
    projectPath: resolvedProjectPath ?? null,
    selectedIdes,
    allOk: failed.length === 0,
    results,
    rules,
    gitignore,
  };
}

export { ALL_IDE_IDS, IDE_PROFILES };
