import { describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchWindowsTerminal } from "./windows-terminal";
import { quotePowerShellLiteral, withPowerShellTerminalTitle } from "./terminal-title";

describe.skipIf(process.platform !== "win32")("Windows 交互终端真实启动", () => {
  for (const file of ["powershell.exe", "pwsh.exe", "cmd.exe"]) {
  const installed = process.platform === "win32" && spawnSync("where.exe", [file], { windowsHide: true }).status === 0;
  it.skipIf(!installed)(`通过 ${file} 执行命令并连接真实 TTY`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agent-recall-console-"));
    const cwd = path.join(root, "项目 空格 & ' %!");
    let pid: number | undefined;
    let watcher: ReturnType<typeof watch> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      mkdirSync(cwd);
      for (const key of ["HOME", "USERPROFILE"]) vi.stubEnv(key, root);
      vi.stubEnv("CODEX_HOME", path.join(root, ".codex"));
      vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(root, ".claude"));
      const marker = path.join(root, "ready.json");
      const probe = path.join(root, "probe.mjs");
      writeFileSync(probe, `
        import fs from 'node:fs';
        const [marker,...args]=process.argv.slice(2);
        fs.writeFileSync(marker+'.tmp',JSON.stringify({args,cwd:process.cwd(),input:process.stdin.isTTY===true,output:process.stdout.isTTY===true,literal:process.env.AGENT_RECALL_TEST_TITLE}));
        fs.renameSync(marker+'.tmp',marker);
      `);
      const values = ["--resume", 'id 空格 $() & % !', "trailing\\"];
      const command = [process.execPath, probe, marker, ...values].map(quotePowerShellLiteral).join(" ");
      const literal = '合成恢复 "title" & %!';
      const script = withPowerShellTerminalTitle(`$env:AGENT_RECALL_TEST_TITLE = ${quotePowerShellLiteral(literal)}; & ${command}; exit $LASTEXITCODE`, literal);
      const args = file === "cmd.exe"
        ? ["/d", "/k", `powershell.exe -NoLogo -NoProfile -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")} & exit`]
        : ["-NoLogo", "-NoProfile", "-NoExit", "-Command", script];
      const ready = new Promise<void>((resolve, reject) => {
        watcher = watch(root, () => { if (existsSync(marker)) resolve(); });
        timer = setTimeout(() => reject(new Error("终端未执行合成 CLI")), 15_000);
      });
      pid = await launchWindowsTerminal(file, args, cwd);
      await ready;
      const actual = JSON.parse(readFileSync(marker, "utf8"));
      expect(actual).toEqual({ args: values, cwd, input: true, output: true, literal });
    } finally {
      if (timer) clearTimeout(timer);
      watcher?.close();
      if (pid) {
        // Only this test's ShellExecute-returned process tree is owned here.
        try { process.kill(pid, 0); execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
        catch (error) {
          const failure = error as NodeJS.ErrnoException & { status?: number };
          // A successfully completed synthetic shell can exit before cleanup.
          if (failure.code !== "ESRCH" && failure.status !== 128) throw error;
        }
      }
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 25_000);
  }

  it("终端未安装时明确返回 ENOENT，供上层回退候选终端", async () => {
    await expect(launchWindowsTerminal("agent-recall-missing-terminal-test.exe", []))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
