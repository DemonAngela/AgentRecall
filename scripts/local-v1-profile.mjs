import fs from "node:fs";
import path from "node:path";

export function validateLocalCli(cli, homeDir) {
  if (!/^opencode v?2\./m.test(cli.openCodeVersion)) throw new Error("需要 opencode2 的 2.x 版本，未接受旧版 opencode。");
  const expectedDb = path.join(homeDir, ".local", "share", "opencode", "opencode.db");
  if (!fs.existsSync(expectedDb) || path.normalize(cli.openCodeDb).toLowerCase() !== path.normalize(expectedDb).toLowerCase()) {
    throw new Error("opencode2 报告的数据库与当前读取位置不一致；已停止，未读取其他旧库。");
  }
  for (const binary of [cli.codeBuddyBinary, cli.openCodeBinary]) {
    if (!path.isAbsolute(binary) || !fs.statSync(binary).isFile()) throw new Error("本机 CLI 入口不存在，请检查安装与 PATH。");
  }
}

export function prepareLocalProfile(profileDir, cli) {
  fs.mkdirSync(profileDir, { recursive: true });
  const configPath = path.join(profileDir, "config.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  // Dedicated profile owns source/safety switches, not layout or official app settings.
  for (const key of Object.keys(config)) if (/^include[A-Z]/.test(key)) config[key] = false;
  Object.assign(config, {
    includeDefaultSources: false, includeCodeBuddyCli: true, includeOpenCode: true,
    codeBuddyBinary: cli.codeBuddyBinary, openCodeBinary: cli.openCodeBinary,
    autoCheckUpdates: false, sessionSearchMcpEnabled: false, summaryAutoBackfill: false,
    rulesSyncEnabled: false, memoriesSyncEnabled: false, skillSyncEnabled: false, remoteSyncEnabled: false,
    hideClaudeQuota: true, hideCodexQuota: true,
  });
  config.defaultTerminal ??= "PowerShell";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
