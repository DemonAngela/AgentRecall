import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { assertLocalNativeResumeSource } from "./native-resume-preflight";
import type { SessionSearchResult } from "./types";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("本机原生会话恢复预检", () => {
  it("只读检查 OpenCode 的原生 ID 和项目，拒绝已删除、错误目录和缺失来源", () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-recall-resume-"));
    try {
      const projectPath = path.join(root, "项目 空格");
      mkdirSync(projectPath);
      const filePath = path.join(root, "opencode.db");
      const db = new DatabaseSync(filePath);
      db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT)");
      db.prepare("INSERT INTO session VALUES (?, ?)").run("ses_123", projectPath);
      db.close();
      const session = { source: "opencode-cli", rawId: "ses_123", projectPath, filePath } as SessionSearchResult;
      expect(() => assertLocalNativeResumeSource(session)).not.toThrow();
      expect(() => assertLocalNativeResumeSource({ ...session, rawId: "ses_deleted" })).toThrow("未创建新会话");
      expect(() => assertLocalNativeResumeSource({ ...session, projectPath: root })).toThrow("目录与索引不一致");
      expect(() => assertLocalNativeResumeSource({ ...session, projectPath: path.join(root, "missing") })).toThrow("项目目录缺失");
      expect(() => assertLocalNativeResumeSource({ ...session, filePath: path.join(root, "missing.db") })).toThrow("原始会话文件");
      const check = new DatabaseSync(filePath, { readOnly: true });
      expect(check.prepare("SELECT count(*) AS n FROM session").get()?.n).toBe(1);
      check.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("不猜测 CodeBuddy 缺失的项目目录，也不改写原始日志", () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-recall-codebuddy-resume-"));
    try {
      const filePath = path.join(root, "session.jsonl");
      writeFileSync(filePath, "{}\n");
      const session = { source: "codebuddy-cli", rawId: "cb1", projectPath: root, filePath } as SessionSearchResult;
      expect(() => assertLocalNativeResumeSource(session)).not.toThrow();
      expect(() => assertLocalNativeResumeSource({ ...session, projectPath: "" })).toThrow("项目目录缺失");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
