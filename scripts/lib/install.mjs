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
export const ruleSource = join(projectRoot, ".cursor", "rules", "frustration-tracker.mdc");

export function toPosixPath(p) {
  return p.replace(/\\/g, "/");
}

export function getDefaultSkillDir() {
  return join(homedir(), ".cursor", "skills", SKILL_FOLDER);
}

export function getProjectSkillDir(projectPath) {
  return join(projectPath, ".cursor", "skills", SKILL_FOLDER);
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
  ides = ALL_IDE_IDS,
  skipBuild = false,
  onLog,
}) {
  const log = onLog ?? (() => {});

  if (!ides.length) {
    throw new Error("请至少选择一个 IDE");
  }

  if (scope === "project" && !projectPath) {
    throw new Error("项目级配置需要填写项目路径");
  }

  if (!skipBuild || !isBuilt()) {
    runBuild(log);
  }

  mkdirSync(skillDir, { recursive: true });

  const skillDirPosix = toPosixPath(skillDir);
  const results = [];
  const rules = [];

  for (const ideId of ides) {
    const profile = IDE_PROFILES[ideId];
    if (!profile) continue;

    const configPaths = resolveAllMcpPaths(ideId, scope, projectPath);

    if (configPaths.length === 0) {
      results.push({
        ide: ideId,
        label: profile.label,
        ok: false,
        skipped: true,
        reason: scope === "project" ? "不支持项目级" : "不支持全局",
      });
      continue;
    }

    try {
      for (const configPath of configPaths) {
        writeIdeMcpConfig({
          ideId,
          configPath,
          serverPath,
          skillDirPosix,
        });
        log(`[${profile.label}] → ${configPath}`);
      }

      const rulePath = installIdeRule({
        ideId,
        scope,
        projectPath,
        ruleSourcePath: ruleSource,
      });
      if (rulePath) rules.push({ ide: ideId, path: rulePath });

      results.push({
        ide: ideId,
        label: profile.label,
        ok: true,
        mcpPath: configPaths[0],
        mcpPaths: configPaths,
        skillAutoLoad: profile.skillAutoLoad,
        note: profile.note,
        docUrl: profile.docUrl,
      });
    } catch (err) {
      results.push({
        ide: ideId,
        label: profile.label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let gitignore = null;
  if (scope === "project" && projectPath) {
    gitignore = updateProjectGitignore(projectPath, skillDir, ides);
    if (gitignore.added.length > 0) {
      log(`已更新 .gitignore: ${gitignore.added.join(", ")}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    throw new Error("所有 IDE 配置均失败，请检查所选 IDE 是否支持当前配置范围");
  }

  return {
    skillDir,
    results,
    rules,
    gitignore,
  };
}

export { ALL_IDE_IDS, IDE_PROFILES };
