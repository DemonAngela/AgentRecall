import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLocalProfile, validateLocalCli } from "./local-v1-profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps", "main-1.0");
const profileDir = path.join(root, ".local", "windows-v1");

try {
  if (process.platform !== "win32") throw new Error("此本机启动入口仅适用于 Windows；其他平台请使用上游 dev:v1。");
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$cb = (Get-Command codebuddy -CommandType ExternalScript,Application -ErrorAction Stop | Select-Object -First 1).Source
$oc = (Get-Command opencode2 -CommandType ExternalScript,Application -ErrorAction Stop | Select-Object -First 1).Source
$version = (& $oc --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'opencode2 version failed' }
$db = (& $oc debug paths db | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'opencode2 paths failed' }
[pscustomobject]@{codeBuddyBinary=$cb;openCodeBinary=$oc;openCodeVersion=$version;openCodeDb=$db} | ConvertTo-Json -Compress
`;
  const inspected = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (inspected.error || inspected.status !== 0) throw new Error("CLI 诊断失败，请确认 codebuddy、opencode2 可在 PowerShell 中运行。");
  const cli = JSON.parse(inspected.stdout.replace(/^\uFEFF/, "").trim());
  for (const key of ["codeBuddyBinary", "openCodeBinary"]) {
    // npm cmd shim also works when the selected terminal falls back to cmd.exe.
    const cmd = cli[key].replace(/\.ps1$/i, ".cmd");
    if (fs.existsSync(cmd)) cli[key] = cmd;
  }
  validateLocalCli(cli, os.homedir());
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({ codebuddy: "已发现", opencode2: cli.openCodeVersion, database: "与 v2 诊断一致", profileDir }));
  } else {
    const executable = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
    if (!fs.existsSync(executable) || !fs.existsSync(path.join(appDir, "out", "main", "index.js"))) {
      throw new Error("请先运行 npm run setup:v1 和 npm --prefix apps/main-1.0 run build。");
    }
    prepareLocalProfile(profileDir, cli);
    const args = [appDir];
    const port = process.argv.find((arg) => arg.startsWith("--debug-port="))?.split("=")[1];
    if (port) {
      if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error("调试端口无效。");
      args.push("--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`);
    }
    const log = fs.openSync(path.join(profileDir, "runtime.log"), "a");
    const child = spawn(executable, args, {
      cwd: appDir, windowsHide: true, stdio: ["ignore", log, log],
      env: {
        ...process.env, AGENT_RECALL_USER_DATA_DIR: profileDir,
        AGENT_RECALL_SKIP_STATUSLINE_INSTALL: "1", AGENT_RECALL_NO_UPDATE_CHECK: "1", AGENT_RECALL_SOURCE_BUILD: "1",
        AGENT_RECALL_DISABLE_DB_POINTER: "1",
      },
    });
    fs.closeSync(log);
    child.once("spawn", () => console.log("AgentRecall v1 已启动：CodeBuddy / OpenCode 2；关闭窗口可能缩至托盘，退出请使用托盘菜单。"));
    child.once("error", () => { console.error("AgentRecall 未能启动，请检查 .local/windows-v1/runtime.log。"); process.exitCode = 1; });
    child.once("exit", (code) => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "本机启动失败。");
  process.exitCode = 1;
}
