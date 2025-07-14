"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.print = print;
exports.detectDefaultPrinter = detectDefaultPrinter;
exports.getAvailablePrinters = getAvailablePrinters;
const process_1 = require("process");
const child_process_1 = require("child_process");
const util_1 = require("util");
// Promisified execFile for async/await usage. Mimics a subset of execa's API we relied on.
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function print({ filePath, copies, printerName }) {
    const isWindows = process_1.platform === "win32";
    if (isWindows) {
        // Try PowerShell Start-Process first, fallback to ImageView_PrintTo for images
        const printSuccess = await tryWindowsPrintMethods(filePath, copies, printerName);
        if (!printSuccess) {
            throw new Error("All Windows printing methods failed");
        }
    }
    else {
        const args = [];
        if (printerName && printerName.trim().length > 0) {
            args.push("-d", printerName);
        }
        args.push("-n", String(copies), filePath);
        const { stdout, stderr } = await execFileAsync("lp", args, { timeout: 30000 });
        if (stdout)
            console.log(stdout.toString());
        if (stderr)
            console.error(stderr.toString());
    }
}
async function tryWindowsPrintMethods(filePath, copies, printerName) {
    // Method 1: PowerShell Start-Process with Print verb (modern, compatible with most printers)
    try {
        console.log("[print] Attempting PowerShell Start-Process method...");
        await printWithPowerShell(filePath, copies, printerName);
        console.log("[print] PowerShell Start-Process method succeeded");
        return true;
    }
    catch (err) {
        console.warn("[print] PowerShell Start-Process method failed:", err);
    }
    // Method 2: Legacy ImageView_PrintTo method (fallback for images only)
    if (isImageFile(filePath)) {
        try {
            console.log("[print] Attempting legacy ImageView_PrintTo method...");
            await printWithImageView(filePath, copies, printerName);
            console.log("[print] Legacy ImageView_PrintTo method succeeded");
            return true;
        }
        catch (err) {
            console.warn("[print] Legacy ImageView_PrintTo method failed:", err);
        }
    }
    return false;
}
async function printWithPowerShell(filePath, copies, printerName) {
    for (let i = 0; i < copies; i++) {
        let powershellCommand = `Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait`;
        // Note: PowerShell Start-Process does not support specifying a printer directly
        // The print dialog will use the default printer, or the user must set the default printer
        // If you want to force a printer, you must set it as default before printing
        const { stdout, stderr } = await execFileAsync("powershell", [
            "-NoProfile",
            "-Command",
            powershellCommand
        ], { timeout: 30000 });
        if (stdout)
            console.log(stdout.toString());
        if (stderr)
            console.error(stderr.toString());
    }
}
async function printWithImageView(filePath, copies, printerName) {
    // Legacy method using Windows Image and Fax Viewer
    const dllEntry = `${process.env.SystemRoot}\\System32\\shimgvw.dll,ImageView_PrintTo`;
    for (let i = 0; i < copies; i++) {
        const args = [dllEntry, filePath];
        if (printerName && printerName.trim().length > 0) {
            args.push(printerName);
        }
        const { stdout, stderr } = await execFileAsync("rundll32.exe", args, { timeout: 30000 });
        if (stdout)
            console.log(stdout.toString());
        if (stderr)
            console.error(stderr.toString());
    }
}
function isImageFile(filePath) {
    return /\.(png|jpg|jpeg|bmp|gif)$/i.test(filePath);
}
async function detectDefaultPrinter() {
    const isWindows = process_1.platform === "win32";
    try {
        if (isWindows) {
            const { stdout } = await execFileAsync("powershell", [
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name",
            ], { timeout: 10000 });
            return stdout.trim() || undefined;
        }
        else {
            const { stdout } = await execFileAsync("lpstat", ["-d"], { timeout: 10000 });
            const match = stdout.match(/system default destination:\s+(\S+)/);
            return match ? match[1] : undefined;
        }
    }
    catch {
        return undefined;
    }
}
// New function to get all available printers
async function getAvailablePrinters() {
    const isWindows = process_1.platform === "win32";
    try {
        if (isWindows) {
            const { stdout } = await execFileAsync("powershell", [
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Printer).Name",
            ], { timeout: 10000 });
            return stdout.trim().split('\n').filter(name => name.trim().length > 0);
        }
        else {
            const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 10000 });
            const printers = stdout.match(/printer\s+(\S+)/g) || [];
            return printers.map(match => match.replace(/printer\s+/, ''));
        }
    }
    catch {
        return [];
    }
}
