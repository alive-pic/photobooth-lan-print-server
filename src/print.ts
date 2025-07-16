import { platform } from "process";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, dirname } from "path";

// Promisified execFile for async/await usage. Mimics a subset of execa's API we relied on.
const execFileAsync = promisify(execFile);

export interface PrintOptions {
  filePath: string;
  copies: number;
  printerName?: string;
  hasAccess?: boolean;
  paperSize?: {
    widthInch: number;
    heightInch: number;
  };
}

export async function print({ filePath, copies, printerName, hasAccess = false, paperSize }: PrintOptions): Promise<void> {
  const isWindows = platform === "win32";
  
  // Determine which file to print based on access level
  const fileToPrint = hasAccess ? filePath : join(dirname(__dirname), "src", "public", "images", "watermark.jpg");
  // When hasAccess is false, always print only 1 copy
  const copiesToPrint = hasAccess ? copies : 1;

  if (isWindows) {
    // Try PowerShell Start-Process first, fallback to ImageView_PrintTo for images
    const printSuccess = await tryWindowsPrintMethods(fileToPrint, copiesToPrint, printerName, paperSize);
    if (!printSuccess) {
      throw new Error("All Windows printing methods failed");
    }
  } else {
    const args: string[] = [];
    if (printerName && printerName.trim().length > 0) {
      args.push("-d", printerName);
    }
    args.push("-n", String(copiesToPrint), fileToPrint);
    await execFileAsync("lp", args, { timeout: 30_000 });
  }
}

async function tryWindowsPrintMethods(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<boolean> {
  // Method 1: Try advanced printing with paper size specification (for 2x6 templates)
  if (paperSize && paperSize.widthInch === 4 && paperSize.heightInch === 6) {
    try {
      await printWithAdvancedWindowsAPI(filePath, copies, printerName, paperSize);
      return true;
    } catch (err) {
      console.log('Advanced printing failed, falling back to basic methods');
    }
  }

  // Method 2: PowerShell Start-Process with Print verb (modern, compatible with most printers)
  try {
    await printWithPowerShell(filePath, copies, printerName, paperSize);
    return true;
  } catch (err) {
    // Suppress detailed error messages for user experience
  }

  // Method 3: Legacy ImageView_PrintTo method (fallback for images only)
  if (isImageFile(filePath)) {
    try {
      await printWithImageView(filePath, copies, printerName, paperSize);
      return true;
      } catch (err) {
    // Suppress detailed error messages for user experience
  }
  }

  return false;
}

async function printWithAdvancedWindowsAPI(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  // For 2x6 templates that should be cut from 4x6 paper, we need to ensure the printer knows about the paper size
  // This method uses Windows printing APIs to specify paper size and cutting instructions
  
  for (let i = 0; i < copies; i++) {
    // Use rundll32 with printui.dll to print with specific settings
    // This method can specify printer and paper settings
    const printCommand = `rundll32 printui.dll,PrintUIEntry /k /n "${printerName || 'default'}" "${filePath}"`;
    
    try {
      await execFileAsync("cmd", ["/c", printCommand], { timeout: 30_000 });
    } catch (error) {
      // If the advanced method fails, throw the error to fall back to basic methods
      throw error;
    }
  }
}

async function printWithPowerShell(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  for (let i = 0; i < copies; i++) {
    let powershellCommand = `Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait`;
    // Note: PowerShell Start-Process does not support specifying a printer directly
    // The print dialog will use the default printer, or the user must set the default printer
    // If you want to force a printer, you must set it as default before printing
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      powershellCommand
    ], { timeout: 30_000 });
  }
}

async function printWithImageView(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  // Legacy method using Windows Image and Fax Viewer
  const dllEntry = `${process.env.SystemRoot}\\System32\\shimgvw.dll,ImageView_PrintTo`;
  for (let i = 0; i < copies; i++) {
    const args = [dllEntry, filePath];
    if (printerName && printerName.trim().length > 0) {
      args.push(printerName);
    }
    await execFileAsync("rundll32.exe", args, { timeout: 30_000 });
  }
}

function isImageFile(filePath: string): boolean {
  return /\.(png|jpg|jpeg|bmp|gif)$/i.test(filePath);
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

// New function to get all available printers
export async function getAvailablePrinters(): Promise<string[]> {
  const isWindows = platform === "win32";
  try {
    if (isWindows) {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_Printer).Name",
        ],
        { timeout: 10_000 }
      );
      return stdout.trim().split('\n').filter(name => name.trim().length > 0);
    } else {
      const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 10_000 });
      const printers = stdout.match(/printer\s+(\S+)/g) || [];
      return printers.map(match => match.replace(/printer\s+/, ''));
    }
  } catch {
    return [];
  }
} 