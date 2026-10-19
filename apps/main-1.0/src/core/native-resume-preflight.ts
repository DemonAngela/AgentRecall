import { statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { SessionSearchResult } from "./types";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// OpenCode --session creates a new session if its ID no longer exists. Check the
// original source immediately before handing control to the native terminal.
export function assertLocalNativeResumeSource(session: SessionSearchResult): void {
  if (session.environmentKind === "ssh" || session.environmentKind === "wsl") return;
  if (session.source !== "opencode-cli" && session.source !== "codebuddy-cli") return;
  if (!session.projectPath || !statSync(session.projectPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("项目目录缺失或不可访问，请先定位真实项目目录；未启动 CLI。");
  }
  if (!statSync(session.filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("原始会话文件已不存在，请刷新索引；未启动 CLI。");
  }
  if (session.source !== "opencode-cli") return;
  const db = new DatabaseSync(session.filePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT * FROM session WHERE id = ?").get(session.rawId);
    if (!row) throw new Error("OpenCode 会话已不存在，请刷新索引；未创建新会话。");
    const directory = row.directory ?? row.path;
    const normalize = (value: string) => {
      const normalized = path.resolve(value);
      return process.platform === "win32" ? normalized.toLowerCase() : normalized;
    };
    if (typeof directory !== "string" || normalize(directory) !== normalize(session.projectPath)) {
      throw new Error("OpenCode 原始项目目录与索引不一致，请刷新后重试；未启动 CLI。");
    }
  } finally {
    db.close();
  }
}
