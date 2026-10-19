import { execFile } from "node:child_process";
import path from "node:path";
import { quotePowerShellLiteral } from "./terminal-title";

// cmd.exe parses the remainder as shell source, not as a normal argv token.
function windowsArguments(file: string, args: string[]): string {
  if (path.win32.basename(file).toLowerCase() === "cmd.exe") {
    if (args.length !== 3 || args[0] !== "/d" || args[1] !== "/k") {
      throw new Error("Unsupported interactive cmd.exe launch arguments.");
    }
    return `/d /s /k "${args[2]}"`;
  }
  return args.map((arg) => `"${arg
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\\"`)
    .replace(/(\\+)$/g, "$1$1")}"`).join(" ");
}

/**
 * ShellExecute creates a real interactive console. libuv's detached Windows
 * process uses DETACHED_PROCESS: pwsh can exit 0 without executing -Command.
 * The helper is hidden; the requested terminal is explicitly shown normally.
 */
export function launchWindowsTerminal(file: string, args: string[], cwd?: string): Promise<number> {
  const argumentsText = windowsArguments(file, args);
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $resolved = @(Get-Command -Name ${quotePowerShellLiteral(file)} -CommandType Application -ErrorAction SilentlyContinue)
  if ($resolved.Count -eq 0) {
    [Console]::Write('AGENT_RECALL_TERMINAL_NOT_FOUND')
    exit 2
  }
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $resolved[0].Source
  $info.Arguments = ${quotePowerShellLiteral(argumentsText)}
  $info.UseShellExecute = $true
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
  ${cwd ? `$info.WorkingDirectory = ${quotePowerShellLiteral(cwd)}` : ""}
  $child = [Diagnostics.Process]::Start($info)
  if ($null -eq $child) { throw 'Terminal startup did not return a process.' }
  [Console]::Write($child.Id)
} catch {
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  if ($failure -is [ComponentModel.Win32Exception] -and $failure.NativeErrorCode -in @(2, 3)) {
    [Console]::Write('AGENT_RECALL_TERMINAL_NOT_FOUND')
    exit 2
  }
  [Console]::Error.Write($failure.Message)
  exit 1
}
`;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 15_000, encoding: "utf8", maxBuffer: 16_384,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 2 && stdout.trim() === "AGENT_RECALL_TERMINAL_NOT_FOUND") {
          reject(Object.assign(new Error(`Terminal not installed: ${file}`), { code: "ENOENT" }));
        } else {
          reject(Object.assign(new Error(stderr.trim() || error.message), { code: error.code }));
        }
        return;
      }
      const pid = Number(stdout.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        reject(new Error("Terminal startup did not confirm a process ID."));
        return;
      }
      resolve(pid);
    });
  });
}
