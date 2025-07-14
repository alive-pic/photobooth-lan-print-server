import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import fs from "fs/promises";
import path from "path";
import bonjourLib from "bonjour";
import { print, detectDefaultPrinter, getAvailablePrinters } from "./print";
import { platform } from "node:process";

dotenv.config();

const app = express();
// Request logger for debugging
app.use((req, _res, next) => {
  console.log(`[DEBUG] ${new Date().toISOString()} ${req.method} ${req.url} from ${req.ip}`);
  next();
});
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

const port = Number(process.env.PORT) || 4000;
let printerName = "";
let availablePrinters: string[] = [];

// ────────────────────────────────────────────────────────────
// Fancy banner so the console shows the server is "ALIVE" 👋
// Color: #02C5FF (RGB 2,197,255)
const asciiArt = `
            _      _______      ________ 
      /\\   | |    |_   _\\ \\    / /  ____|
     /  \\  | |      | |  \\ \\  / /| |__   
    / /\\ \\ | |      | |   \\ \\/ / |  __|  
   / ____ \\| |____ _| |_   \\  /  | |____ 
  /_/    \\_\\______|_____|   \\/   |______|
                                         
                                         `;

const colorStart = "\x1b[38;2;2;197;255m"; // 24-bit ANSI color
const reset = "\x1b[0m";
console.log(colorStart + asciiArt + reset + "\n");

(async () => {
  try {
    // Detect default printer
    const detected = await detectDefaultPrinter();
    if (detected) {
      printerName = detected;
      console.log(`[INFO] Default printer detected: ${printerName}`);
    } else {
      console.warn("No default printer detected – printing will fall back to Windows default queue");
    }

    // Get all available printers
    try {
      availablePrinters = await getAvailablePrinters();
      console.log(`[INFO] Available printers: ${availablePrinters.join(", ")}`);
    } catch (err) {
      console.warn("Could not detect available printers:", err);
    }
  } catch (err) {
    console.warn("Could not detect default printer:", err);
  }

  // Advertise via mDNS/Bonjour
  const bonjour = bonjourLib();
  bonjour.publish({
    name: "PhotoBooth Print Server",
    type: "photoprint",
    port,
    txt: {
      printer: printerName || "default",
      printers: availablePrinters.join(","),
    },
  });

  app.get("/health", (req, res) => {
    console.log(`[DEBUG] /health check received from ${req.ip}`);
    res.json({ 
      status: "OK", 
      printer: printerName || "default",
      timestamp: new Date().toISOString()
    });
  });

  // Enhanced info endpoint with printer compatibility information
  app.get("/info", (req, res) => {
    console.log(`[DEBUG] /info request received from ${req.ip}`);
    res.json({
      printerName: printerName || "default",
      availablePrinters: availablePrinters,
      platform: platform,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      printingMethods: [
        "PowerShell Start-Process (modern)",
        "rundll32 printui.dll (specialized printers)",
        "ImageView_PrintTo (legacy fallback)"
      ]
    });
  });

  // New endpoint to get available printers
  app.get("/printers", (req, res) => {
    console.log(`[DEBUG] /printers request received from ${req.ip}`);
    res.json({
      defaultPrinter: printerName || "default",
      availablePrinters: availablePrinters,
      timestamp: new Date().toISOString()
    });
  });

  app.post("/print", async (req, res) => {
    const { copies = 1, mimeType = "image/png", data, targetPrinter } = req.body || {};

    if (!data || typeof data !== "string") {
      return res.status(400).json({ error: "Missing base64 data" });
    }

    // Use target printer if specified, otherwise use default
    const selectedPrinter = targetPrinter || printerName;
    
    // Validate printer exists if specified
    if (selectedPrinter && selectedPrinter !== "default" && !availablePrinters.includes(selectedPrinter)) {
      console.warn(`[WARN] Requested printer "${selectedPrinter}" not found in available printers`);
      // Don't fail here, let the print function handle it
    }

    const jobId = uuidv4();
    console.log(`[DEBUG] /print request ${jobId} copies=${copies} mime=${mimeType} printer=${selectedPrinter || "default"}`);
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `${jobId}.${ext}`);

    try {
      await fs.writeFile(filePath, Buffer.from(data, "base64"));
      console.log(`[${jobId}] Saved print file to ${filePath}`);

      await print({ filePath, copies, printerName: selectedPrinter });
      console.log(`[${jobId}] Print command completed successfully`);

      res.json({ 
        jobId, 
        copies, 
        printer: selectedPrinter || "default",
        success: true 
      });
    } catch (err: any) {
      console.error(`[${jobId}] Print error`, err);
      res.status(500).json({ 
        error: err.message,
        jobId,
        printer: selectedPrinter || "default",
        success: false,
        troubleshooting: {
          message: "Print failed. This might be due to printer compatibility issues.",
          suggestions: [
            "Ensure the printer is properly installed and drivers are up to date",
            "Check if the printer is online and accessible",
            "Try using a different printer from the available list",
            "Check Windows print spooler service status"
          ]
        }
      });
    } finally {
      try {
        await fs.rm(filePath, { force: true });
        console.log(`[${jobId}] Temp file removed`);
      } catch (err) {
        console.warn(`[${jobId}] Failed to remove temp file`, err);
      }
    }
  });

  app.listen(port, "0.0.0.0", async () => {
    const nets = os.networkInterfaces();
    const addrs: string[] = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          addrs.push(net.address);
        }
      }
    }

    if (addrs.length === 0) {
      console.log(`Print server listening on http://localhost:${port}`);
    } else {
      console.log("Print server listening on:");
      for (const addr of addrs) {
        console.log(`  http://${addr}:${port}`);
      }
    }
    console.log(`Advertising _photoprint._tcp with printer="${printerName}"`);
    console.log(`Available printers: ${availablePrinters.length > 0 ? availablePrinters.join(", ") : "none detected"}`);

    console.log("\n=== Printer Compatibility Information ===");
    console.log("• Modern printers (DNP-DS620, etc.): Use PowerShell Start-Process method");
    console.log("• Specialized photo printers: Use rundll32 printui.dll method");
    console.log("• Legacy systems: Fallback to ImageView_PrintTo method");
    console.log("• The server will try all methods automatically for best compatibility");
    console.log("==========================================\n");
  });
})(); 