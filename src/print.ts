import { platform } from "process";
import { execFile } from "child_process";
import { promisify } from "util";

// Promisified execFile for async/await usage. Mimics a subset of execa's API we relied on.
const execFileAsync = promisify(execFile);

export interface PrintOptions {
  filePath: string;
  copies: number;
  printerName?: string;
}

export async function print({ filePath, copies, printerName }: PrintOptions): Promise<void> {
  const isWindows = platform === "win32";

  if (isWindows) {
    // Use Windows Image and Fax Viewer (built-in) via rundll32 to print.
    // Syntax: rundll32.exe %SystemRoot%\System32\shimgvw.dll,ImageView_PrintTo <file> <printer>

    // Build the DLL entry path (comma separator must be a single argument!)
    const dllEntry = `${process.env.SystemRoot}\\System32\\shimgvw.dll,ImageView_PrintTo`;

    for (let i = 0; i < copies; i++) {
      let stdout: Buffer | string | null = null;
      let stderr: Buffer | string | null = null;
      const args = [dllEntry, filePath];
      if (printerName && printerName.trim().length > 0) {
        args.push(printerName);
      }

      try {
        ({ stdout, stderr } = await execFileAsync("rundll32.exe", args, {
          timeout: 30_000,
        }));
      } catch (err) {
        console.error("[print] rundll32 ImageView_PrintTo failed", err);
        throw err; // bubble up to caller
      }

      if (stdout) console.log(stdout.toString());
      if (stderr) console.error(stderr.toString());
    }
  } else {
    const args: string[] = [];
    if (printerName && printerName.trim().length > 0) {
      args.push("-d", printerName);
    }
    args.push("-n", String(copies), filePath);
    const { stdout, stderr } = await execFileAsync("lp", args, { timeout: 30_000 });
    if (stdout) console.log(stdout.toString());
    if (stderr) console.error(stderr.toString());
  }
}

export async function detectDefaultPrinter(): Promise<string | undefined> {
  const isWindows = platform === "win32";
  try {
    if (isWindows) {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name",
        ],
        { timeout: 10_000 }
      );
      return stdout.trim() || undefined;
    } else {
      const { stdout } = await execFileAsync("lpstat", ["-d"], { timeout: 10_000 });
      const match = stdout.match(/system default destination:\s+(\S+)/);
      return match ? match[1] : undefined;
    }
  } catch {
    return undefined;
  }
} 