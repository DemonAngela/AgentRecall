import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadDefaultSessions, loadDefaultSessionsAsyncIterator } from "./session-loader";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("v1 本机双 CLI 来源边界", () => {
  it("同步与后台扫描只读指定 home 的双来源，忽略旧 OpenCode 库与默认 Codex 来源", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "agent-recall-sources-"));
    try {
      const project = path.join(homeDir, "项目 空格");
      mkdirSync(project);
      const cbDir = path.join(homeDir, ".codebuddy", "projects", "encoded-store-name");
      mkdirSync(cbDir, { recursive: true });
      const codebuddy = { type: "message", role: "user", sessionId: "cb1", cwd: project, timestamp: Date.now(), content: [{ type: "input_text", text: "合成 CodeBuddy 消息" }] };
      writeFileSync(path.join(cbDir, "cb1.jsonl"), JSON.stringify(codebuddy) + "\n");
      const codexDir = path.join(homeDir, ".codex", "sessions");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(path.join(codexDir, "codex1.jsonl"), [
        { type: "session_meta", payload: { id: "codex1", cwd: project } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "不应导入的合成 Codex 消息" }] } },
      ].map((row) => JSON.stringify(row)).join("\n"));
      const ocDir = path.join(homeDir, ".local", "share", "opencode");
      mkdirSync(ocDir, { recursive: true });
      for (const file of ["opencode.db", "opencode-local.db"]) {
        const db = new DatabaseSync(path.join(ocDir, file));
        db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER);
          CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
          CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);`);
        const id = file === "opencode.db" ? "ses_current" : "ses_old";
        db.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run(id, project, "合成 OpenCode", Date.now());
        db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg1", id, JSON.stringify({ role: "user" }), Date.now());
        db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("part1", "msg1", id, JSON.stringify({ type: "text", text: "合成 OpenCode 消息" }), Date.now());
        db.close();
      }
      const options = { homeDir, includeDefaultSources: false, includeCodeBuddyCli: true, includeOpenCode: true };
      const sync = loadDefaultSessions(options);
      expect(sync.map(({ session }) => session.source).sort()).toEqual(["codebuddy-cli", "opencode-cli"]);
      expect(sync.map(({ session }) => session.rawId).sort()).toEqual(["cb1", "ses_current"]);
      expect(sync.every(({ session }) => session.projectPath === project)).toBe(true);
      expect(sync.every(({ messages }) => messages.length === 1)).toBe(true);
      const asyncRows = [];
      for await (const item of loadDefaultSessionsAsyncIterator(options)) asyncRows.push(item);
      expect(asyncRows.map(({ session }) => session.rawId).sort()).toEqual(["cb1", "ses_current"]);
      expect(loadDefaultSessions({ ...options, includeDefaultSources: true }).some(({ session }) => session.rawId === "codex1")).toBe(true);
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });
});
