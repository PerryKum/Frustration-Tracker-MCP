#!/usr/bin/env node

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import {
  projectRoot,
  getDefaultSkillDir,
  getProjectSkillDir,
  isBuilt,
  browseFolder,
  installAndConfigure,
  readCurrentConfig,
  toPosixPath,
  ALL_IDE_IDS,
  expandUserPath,
} from "../scripts/lib/install.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3847;
const htmlPath = join(__dirname, "index.html");

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function resolveSkillDir({ skillPreset, customSkillDir, projectPath }) {
  if (skillPreset === "default") return getDefaultSkillDir();
  if (skillPreset === "project") {
    if (!projectPath) throw new Error("请选择项目路径");
    return getProjectSkillDir(projectPath);
  }
  if (!customSkillDir?.trim()) throw new Error("请填写自定义输出路径");
  return expandUserPath(customSkillDir.trim());
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(htmlPath, "utf-8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/defaults") {
    const current = readCurrentConfig();
    sendJson(res, 200, {
      projectRoot,
      defaultSkillDir: getDefaultSkillDir(),
      built: isBuilt(),
      current,
      ides: ALL_IDE_IDS.map((id) => {
        const p = IDE_PROFILES[id];
        return {
          id,
          label: p.label,
          skillAutoLoad: p.skillAutoLoad,
          note: p.note ?? null,
          docUrl: p.docUrl ?? null,
          globalPathDisplay: p.globalPathDisplay,
          projectPathDisplay: p.projectPathDisplay,
        };
      }),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/browse") {
    try {
      await readBody(req);
      const picked = browseFolder();
      if (!picked) {
        sendJson(res, 200, { cancelled: true });
        return;
      }
      sendJson(res, 200, { path: toPosixPath(picked) });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/install") {
    try {
      const body = await readBody(req);
      const logs = [];
      const skillDir = resolveSkillDir(body);
      const ides = Array.isArray(body.ides) && body.ides.length ? body.ides : ALL_IDE_IDS;
      const result = installAndConfigure({
        scope: body.scope ?? "global",
        projectPath: body.projectPath?.trim(),
        skillDir,
        ides,
        skipBuild: body.skipBuild === true,
        onLog: (msg) => logs.push(msg),
      });

      sendJson(res, 200, {
        ok: true,
        logs,
        skillDir: toPosixPath(result.skillDir),
        scope: result.scope,
        projectPath: result.projectPath ? toPosixPath(result.projectPath) : null,
        results: result.results.map((r) => ({
          ...r,
          mcpPath: r.mcpPath ? toPosixPath(r.mcpPath) : undefined,
          mcpPaths: r.mcpPaths?.map((p) => toPosixPath(p)),
        })),
        rules: result.rules?.map((r) => ({ ...r, path: toPosixPath(r.path) })),
        gitignore: result.gitignore
          ? {
              path: toPosixPath(result.gitignore.gitignorePath),
              added: result.gitignore.added,
            }
          : null,
      });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  Frustration Tracker 配置界面已启动`);
  console.log(`  ${url}\n`);
  console.log(`  关闭此窗口即可停止服务\n`);

  if (process.platform === "win32") {
    exec(`start "" "${url}"`);
  } else {
    exec(`open "${url}"`);
  }
});
