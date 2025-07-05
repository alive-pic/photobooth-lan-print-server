import { platform } from "process";
import { execa } from "execa";

export interface PrintOptions {
  filePath: string;
  copies: number;
  printerName?: string;
}

export async function print({ filePath, copies, printerName }: PrintOptions): Promise<void> {
  const isWindows = platform === "win32";

  if (isWindows) {
    for (let i = 0; i < copies; i++) {
      const { stdout, stderr } = await execa(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Start-Process",
          "-FilePath",
          filePath,
          "-Verb",
          "Print",
          "-PassThru",
        ],
        { timeout: 30_000 }
      );
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    }
  } else {
    const args: string[] = [];
    if (printerName && printerName.trim().length > 0) {
      args.push("-d", printerName);
    }
    args.push("-n", String(copies), filePath);
    const { stdout, stderr } = await execa("lp", args, { timeout: 30_000 });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  }
}

export async function detectDefaultPrinter(): Promise<string | undefined> {
  const isWindows = platform === "win32";
  try {
    if (isWindows) {
      const { stdout } = await execa(
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
      const { stdout } = await execa("lpstat", ["-d"], { timeout: 10_000 });
      const match = stdout.match(/system default destination:\s+(\S+)/);
      return match ? match[1] : undefined;
    }
  } catch {
    return undefined;
  }
} 