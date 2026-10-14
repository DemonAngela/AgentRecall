import fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadDefaultSessions } from "./session-loader";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => import("node:sqlite").DatabaseSync };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentrecall-antigravity-v1-"));
  roots.push(root);
  return root;
}

function antigravityPaths(root: string, conversationId: string): {
  transcript: string;
  transcriptFallback: string;
  metadataDb: string;
  annotation: string;
} {
  const home = path.join(root, ".gemini", "antigravity");
  const logs = path.join(home, "brain", conversationId, ".system_generated", "logs");
  return {
    transcript: path.join(logs, "transcript_full.jsonl"),
    transcriptFallback: path.join(logs, "transcript.jsonl"),
    metadataDb: path.join(home, "conversations", `${conversationId}.db`),
    annotation: path.join(home, "annotations", `${conversationId}.pbtxt`),
  };
}

function writeTranscript(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function protoVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function protoTag(field: number, wire: number): Buffer {
  return protoVarint(field * 8 + wire);
}

function protoLengthDelimited(field: number, payload: Buffer): Buffer {
  return Buffer.concat([protoTag(field, 2), protoVarint(payload.length), payload]);
}

function protoString(field: number, value: string): Buffer {
  return protoLengthDelimited(field, Buffer.from(value, "utf8"));
}

function writeMetadataDb(
  dbPath: string,
  options: { folderUri?: string; branch?: string; createdAtSeconds?: number },
): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE trajectory_metadata_blob (id TEXT DEFAULT 'main', data BLOB, PRIMARY KEY (id))");
  const workspaceParts: Buffer[] = [];
  if (options.folderUri) workspaceParts.push(protoString(1, options.folderUri));
  if (options.branch) workspaceParts.push(protoString(4, options.branch));
  const parts: Buffer[] = [];
  if (workspaceParts.length) parts.push(protoLengthDelimited(1, Buffer.concat(workspaceParts)));
  if (options.createdAtSeconds) {
    parts.push(protoLengthDelimited(2, Buffer.concat([protoTag(1, 0), protoVarint(options.createdAtSeconds)])));
  }
  db.prepare("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)").run(Buffer.concat(parts));
  db.close();
}

const CONVERSATION_ID = "5cb078f8-1111-2222-3333-444455556666";

describe("Antigravity sessions", () => {
  it("orders entries by step_index and projects messages, tools, checkpoints, and metadata", () => {
    const root = fixture();
    const paths = antigravityPaths(root, CONVERSATION_ID);
    const projectDir = path.join(root, "workspace");
    // The tool result is written before the planner response that requested it.
    writeTranscript(paths.transcript, [
      { step_index: 3, source: "MODEL", type: "GENERIC", status: "DONE", created_at: "2026-09-15T02:24:05Z", content: "Created At: 2026-09-15T10:24:05+08:00\nCompleted At: 2026-09-15T10:24:11+08:00\nfile contents" },
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-15T02:23:59Z", content: "<USER_REQUEST>\nFix the parser\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-09-15T10:23:59+08:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user enabled something.\n</USER_SETTINGS_CHANGE>" },
      { step_index: 1, source: "SYSTEM", type: "CHECKPOINT", status: "DONE", created_at: "2026-09-15T02:23:59Z", content: "{{ CHECKPOINT 0 }}\nEarlier parts were truncated." },
      { step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T02:24:00Z", thinking: "Inspect the parser first", content: "Let me inspect the parser.", tool_calls: [{ name: "view_file", args: { AbsolutePath: "/work/app/parser.ts", toolSummary: "Inspect parser" } }] },
      { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T02:24:20Z", content: "Done." },
      { step_index: 5, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", created_at: "2026-09-15T02:24:30Z", content: "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n[Message] sender=other-task content=Report ready\n</SYSTEM_MESSAGE>" },
      { step_index: 6, source: "SYSTEM", type: "ERROR_MESSAGE", status: "DONE", created_at: "2026-09-15T02:24:40Z", content: "Error: The stream was interrupted." },
      { step_index: 7, source: "SYSTEM", type: "CONVERSATION_HISTORY", status: "DONE", created_at: "2026-09-15T02:24:41Z" },
    ]);
    writeMetadataDb(paths.metadataDb, {
      folderUri: pathToFileURL(projectDir).href,
      branch: "main",
      createdAtSeconds: 1789442000,
    });
    fs.mkdirSync(path.dirname(paths.annotation), { recursive: true });
    fs.writeFileSync(paths.annotation, 'title:"Parser repair" last_user_view_time:{seconds:1789442944 nanos:944000000}\n', "utf8");

    const loaded = loadDefaultSessions({ homeDir: root, includeAntigravity: true })
      .filter((item) => item.session.source === "antigravity");

    expect(loaded).toHaveLength(1);
    const { session, messages } = loaded[0];
    const traceEvents = loaded[0].traceEvents ?? [];
    expect(session).toMatchObject({
      sessionKey: `antigravity:${CONVERSATION_ID}`,
      rawId: CONVERSATION_ID,
      projectPath: projectDir,
      gitBranch: "main",
      originalTitle: "Parser repair",
      firstQuestion: "Fix the parser",
      isSubagent: false,
      parentSessionId: null,
      timestamp: 1789442000 * 1000,
    });
    // Tool results are tool events, not conversation messages, and the XML
    // wrapper plus system blocks do not leak into the user message.
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Fix the parser"],
      ["assistant", "Let me inspect the parser."],
      ["assistant", "Done."],
    ]);
    const callId = "antigravity:2:0";
    expect(traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_call", callId, title: "view_file · Inspect parser", eventType: "antigravity.toolCall", status: "running" }),
      expect.objectContaining({ kind: "tool_result", callId, detail: "file contents", eventType: "antigravity.toolResult", status: "completed" }),
      expect.objectContaining({ kind: "event", eventType: "antigravity.thought", detail: "Inspect the parser first" }),
      expect.objectContaining({ kind: "event", eventType: "antigravity.context.compaction" }),
      expect.objectContaining({ kind: "event", eventType: "antigravity.collaboration.message", detail: "[Message] sender=other-task content=Report ready" }),
      expect.objectContaining({ kind: "event", eventType: "antigravity.error", status: "failed" }),
    ]));
    const toolResult = traceEvents.find((event) => event.kind === "tool_result" && event.callId === callId);
    const toolCall = traceEvents.find((event) => event.kind === "tool_call" && event.callId === callId);
    expect(Date.parse(toolResult?.timestamp ?? "")).toBeGreaterThan(Date.parse(toolCall?.timestamp ?? ""));
    // The unknown CONVERSATION_HISTORY entry produces no event or message; the
    // remaining six entries produce exactly one event each.
    expect(traceEvents).toHaveLength(6);
  });

  it("pairs results in order and leaves a canceled call unpaired", () => {
    const root = fixture();
    const paths = antigravityPaths(root, CONVERSATION_ID);
    writeTranscript(paths.transcript, [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-15T03:00:00Z", content: "<USER_REQUEST>\nRun the checks\n</USER_REQUEST>" },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T03:00:01Z", tool_calls: [
        { name: "view_file", args: { AbsolutePath: "/work/app/a.ts" } },
        { name: "run_command", args: { CommandLine: "npm test" } },
      ] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", created_at: "2026-09-15T03:00:02Z", content: "Created At: 2026-09-15T11:00:02+08:00\nCompleted At: 2026-09-15T11:00:03+08:00\nfirst result" },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T03:00:04Z", content: "Partial result accepted." },
    ]);

    const [loaded] = loadDefaultSessions({ homeDir: root, includeAntigravity: true })
      .filter((item) => item.session.source === "antigravity");

    const calls = (loaded.traceEvents ?? []).filter((event) => event.kind === "tool_call");
    const results = (loaded.traceEvents ?? []).filter((event) => event.kind === "tool_result");
    expect(calls.map((event) => event.callId)).toEqual(["antigravity:1:0", "antigravity:1:1"]);
    expect(results.map((event) => event.callId)).toEqual(["antigravity:1:0"]);
    expect(results[0].detail).toBe("first result");
    expect(loaded.messages.map((message) => message.content)).toEqual(["Run the checks", "Partial result accepted."]);
  });

  it("falls back to the plain transcript, the file path, and the first question", () => {
    const root = fixture();
    const paths = antigravityPaths(root, CONVERSATION_ID);
    writeTranscript(paths.transcriptFallback, [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-15T04:00:00Z", content: "<USER_REQUEST>\nSummarize the report\n</USER_REQUEST>" },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T04:00:05Z", content: "Here is the summary." },
    ]);

    const [loaded] = loadDefaultSessions({ homeDir: root, includeAntigravity: true })
      .filter((item) => item.session.source === "antigravity");

    expect(loaded.session).toMatchObject({
      projectPath: paths.transcriptFallback,
      gitBranch: null,
      originalTitle: "Summarize the report",
      firstQuestion: "Summarize the report",
      timestamp: Date.parse("2026-09-15T04:00:00Z"),
    });
    expect(loaded.messages.map((message) => message.content)).toEqual(["Summarize the report", "Here is the summary."]);
  });

  it("keeps sessions when the metadata database is unreadable", () => {
    const root = fixture();
    const paths = antigravityPaths(root, CONVERSATION_ID);
    writeTranscript(paths.transcript, [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-15T05:00:00Z", content: "<USER_REQUEST>\nRecover the session\n</USER_REQUEST>" },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-15T05:00:01Z", content: "Recovered." },
    ]);
    fs.mkdirSync(path.dirname(paths.metadataDb), { recursive: true });
    fs.writeFileSync(paths.metadataDb, "not a sqlite database", "utf8");

    const [loaded] = loadDefaultSessions({ homeDir: root, includeAntigravity: true })
      .filter((item) => item.session.source === "antigravity");

    expect(loaded.session).toMatchObject({
      projectPath: paths.transcript,
      originalTitle: "Recover the session",
    });
  });

  it("stays out of the default index until the optional source is enabled", () => {
    const root = fixture();
    const paths = antigravityPaths(root, CONVERSATION_ID);
    writeTranscript(paths.transcript, [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-15T06:00:00Z", content: "<USER_REQUEST>\nHidden until enabled\n</USER_REQUEST>" },
    ]);

    expect(loadDefaultSessions({ homeDir: root })).toHaveLength(0);
    expect(loadDefaultSessions({ homeDir: root, includeAntigravity: true })).toHaveLength(1);
  });
});
