import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareLocalProfile, validateLocalCli } from "./local-v1-profile.mjs";

test("本机配置只处理指定来源，保留界面配置，不接受 v1 或其他库", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-recall-profile-"));
  try {
    const openCodeDb = path.join(home, ".local", "share", "opencode", "opencode.db");
    fs.mkdirSync(path.dirname(openCodeDb), { recursive: true });
    fs.writeFileSync(openCodeDb, "synthetic");
    const binary = path.join(home, "cli.cmd");
    fs.writeFileSync(binary, "synthetic");
    const cli = { codeBuddyBinary: binary, openCodeBinary: binary, openCodeVersion: "opencode v2.0.31", openCodeDb };
    validateLocalCli(cli, home);
    assert.throws(() => validateLocalCli({ ...cli, openCodeVersion: "opencode 1.4.0" }, home), /2.x/);
    assert.throws(() => validateLocalCli({ ...cli, openCodeDb: path.join(home, "opencode-local.db") }, home), /不一致/);
    const profile = path.join(home, "profile");
    const config = prepareLocalProfile(profile, cli);
    fs.writeFileSync(config, JSON.stringify({ defaultTerminal: "WindowsTerminal", includePi: true, summaryAutoBackfill: true }));
    prepareLocalProfile(profile, cli);
    const saved = JSON.parse(fs.readFileSync(config, "utf8"));
    assert.equal(saved.defaultTerminal, "WindowsTerminal");
    assert.equal(saved.includeDefaultSources, false);
    assert.equal(saved.includePi, false);
    assert.equal(saved.includeCodeBuddyCli, true);
    assert.equal(saved.includeOpenCode, true);
    assert.equal(saved.sessionSearchMcpEnabled, false);
    assert.equal(saved.summaryAutoBackfill, false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
