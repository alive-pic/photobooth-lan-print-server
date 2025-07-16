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
import readline from "readline";
import { exec } from "child_process";

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

const port = Number(process.env.PORT) || 4000;
let printerName = "";
let availablePrinters: string[] = [];
let printCount = 0; // Add print counter
let statsLinePosition = 0; // Track where the stats section is

// Function to update print statistics display
function updatePrintStats() {
  // Clear the last few lines and redraw the statistics section
  // Move up to clear the print job messages and stats section
  for (let i = 0; i < 7; i++) {
    process.stdout.write('\x1b[1A'); // Move up one line
    process.stdout.write('\x1b[2K'); // Clear that line
  }
  
  // Redraw the statistics section
  console.log(colorStart + "============= Print Statistics =============" + reset);
  console.log(colorStart + `📊 Total prints: ${printCount}` + reset);
  console.log(colorStart + "==========================================\n" + reset);
}

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

// Function to open printer settings
function openPrinterSettings() {
  console.log(colorStart + "🖨️  Opening printer settings..." + reset);
  
  if (platform === "win32") {
    // Windows: Open printer settings - try multiple methods
    // First try to open the default printer properties
    const defaultPrinterCommand = printerName ? 
      `rundll32 printui.dll,PrintUIEntry /p /n "${printerName}"` : 
      "rundll32 printui.dll,PrintUIEntry /p";
    
    exec(defaultPrinterCommand, (error) => {
      if (error) {
        // Fallback to printer management
        exec("rundll32 printui.dll,PrintUIEntry /s", (error2) => {
          if (error2) {
            // Fallback to control panel printers
            exec("control printers", (error3) => {
              if (error3) {
                // Final fallback to settings app
                exec("start ms-settings:printers", (error4) => {
                  if (error4) {
                    console.error(colorStart + "❌ Failed to open printer settings. Please open manually from Windows Settings." + reset);
                  } else {
                    console.log(colorStart + "✅ Printer settings opened successfully!" + reset);
                  }
                });
              } else {
                console.log(colorStart + "✅ Printer settings opened successfully!" + reset);
              }
            });
          } else {
            console.log(colorStart + "✅ Printer management opened successfully!" + reset);
          }
        });
      } else {
        console.log(colorStart + `✅ Printer settings opened for: ${printerName || 'default printer'}!` + reset);
      }
    });
  } else if (platform === "darwin") {
    // macOS: Open System Preferences > Printers & Scanners
    exec("open 'x-apple.systempreferences:com.apple.preference.printfax'", (error) => {
      if (error) {
        console.error(colorStart + "❌ Failed to open printer settings. Please open manually from System Preferences." + reset);
      } else {
        console.log(colorStart + "✅ Printer settings opened successfully!" + reset);
      }
    });
  } else {
    // Linux: Try to open printer settings
    exec("system-config-printer", (error) => {
      if (error) {
        // Fallback to CUPS web interface
        exec("xdg-open http://localhost:631", (error2) => {
          if (error2) {
            console.error(colorStart + "❌ Failed to open printer settings. Please open manually." + reset);
          } else {
            console.log(colorStart + "✅ CUPS printer interface opened!" + reset);
          }
        });
      } else {
        console.log(colorStart + "✅ Printer settings opened successfully!" + reset);
      }
    });
  }
}

// Setup keyboard listener
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Hide cursor and disable echo for cleaner input handling
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (str, key) => {
  if (key.name === 'p' || key.sequence === 'p') {
    openPrinterSettings();
  }
  // Allow Ctrl+C to exit
  if (key.ctrl && key.name === 'c') {
    console.log(colorStart + "\n[INFO] Shutting down server..." + reset);
    process.exit(0);
  }
});

(async () => {
  try {
    // Detect default printer
    const detected = await detectDefaultPrinter();
    if (detected) {
      printerName = detected;
      console.log(colorStart + `🖨️  Default printer found: ${printerName}` + reset);
    } else {
      console.warn(colorStart + "⚠️  No default printer detected – will use Windows default print queue" + reset);
    }

    // Get all available printers
    try {
      availablePrinters = await getAvailablePrinters();
      if (availablePrinters.length > 0) {
        console.log(colorStart + `📋 Available printers: ${availablePrinters.join(", ")}` + reset);
      } else {
        console.warn(colorStart + "⚠️  No printers detected on your system" + reset);
      }
    } catch (err) {
      console.warn(colorStart + "⚠️  Could not detect available printers" + reset);
    }
  } catch (err) {
    console.warn(colorStart + "⚠️  Could not detect default printer" + reset);
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
    res.json({ 
      status: "OK", 
      printer: printerName || "default",
      timestamp: new Date().toISOString()
    });
  });

  // Enhanced info endpoint with printer compatibility information
  app.get("/info", (req, res) => {
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
    res.json({
      defaultPrinter: printerName || "default",
      availablePrinters: availablePrinters,
      timestamp: new Date().toISOString()
    });
  });

  // New endpoint to refresh available printers
  app.get("/printers/refresh", async (req, res) => {
    try {
      availablePrinters = await getAvailablePrinters();
      console.log(colorStart + `🔄 Refreshed printer list: ${availablePrinters.join(", ")}` + reset);
      res.json({
        defaultPrinter: printerName || "default",
        availablePrinters: availablePrinters,
        timestamp: new Date().toISOString(),
        success: true
      });
    } catch (error) {
      console.error(colorStart + "❌ Failed to refresh printer list" + reset);
      res.status(500).json({
        error: "Failed to refresh printers",
        timestamp: new Date().toISOString(),
        success: false
      });
    }
  });

  app.post("/print", async (req, res) => {
    const { copies = 1, mimeType = "image/png", data, targetPrinter, hasAccess = false, template } = req.body || {};

    if (!data || typeof data !== "string") {
      return res.status(400).json({ error: "Missing base64 data" });
    }

    // Use target printer if specified, otherwise use default
    const selectedPrinter = targetPrinter || printerName;
    
    // Validate printer exists if specified
    if (selectedPrinter && selectedPrinter !== "default" && !availablePrinters.includes(selectedPrinter)) {
      console.warn(colorStart + `⚠️  Requested printer "${selectedPrinter}" not found in available printers` + reset);
      // Don't fail here, let the print function handle it
    }

    const jobId = uuidv4();
    console.log(colorStart + `🖨️  Print job ${jobId}: ${copies} copy${copies > 1 ? 'ies' : 'y'} to ${selectedPrinter || "default printer"}` + reset);
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `${jobId}.${ext}`);

    try {
      await fs.writeFile(filePath, Buffer.from(data, "base64"));
      console.log(colorStart + `📁 Photo saved temporarily for printing` + reset);

      // Determine paper size for 2x6 templates that should be cut from 4x6 paper
      let paperSize = undefined;
      if (template && template.widthInch === 2 && template.heightInch === 6) {
        paperSize = {
          widthInch: 4, // Double width for cutting
          heightInch: 6, // Same height
        };
        console.log(colorStart + `📏 2x6 template detected - will print on 4x6 paper for cutting` + reset);
      }

      await print({ filePath, copies, printerName: selectedPrinter, hasAccess, paperSize });
      console.log(colorStart + `✅ Print job completed successfully!` + reset);
      
      // Increment print counter
      printCount += copies;
      updatePrintStats(); // Update statistics display

      res.json({ 
        jobId, 
        copies, 
        printer: selectedPrinter || "default",
        success: true 
      });
    } catch (err: any) {
      console.error(colorStart + `❌ Print job failed: ${err.message}` + reset);
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
        } catch (err) {
          // Silently handle cleanup errors
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

    console.log(colorStart + "🚀 PhotoBooth Print Server is now running!" + reset);
    console.log(colorStart + "📱 Alive app can now connect to print photos" + reset);
    console.log("");
    
    if (addrs.length === 0) {
      console.log(colorStart + `🌐 Server address: http://localhost:${port}` + reset);
    } else {
      console.log(colorStart + "🌐 Server addresses:" + reset);
      for (const addr of addrs) {
        console.log(colorStart + `   http://${addr}:${port}` + reset);
      }
    }
    
    console.log("");
    console.log(colorStart + `🖨️  Default printer: ${printerName || "Windows default"}` + reset);
    if (availablePrinters.length > 0) {
      console.log(colorStart + `📋 Available printers: ${availablePrinters.join(", ")}` + reset);
    } else {
      console.log(colorStart + "⚠️  No printers detected - please check your printer setup" + reset);
    }
    console.log("");

    // Keyboard shortcuts instructions
    console.log(colorStart + "============= Quick Actions =============" + reset);
    console.log(colorStart + "• Press 'p' to open printer settings" + reset);
    console.log(colorStart + "• Press Ctrl+C to stop the server" + reset);
    console.log(colorStart + "==========================================" + reset);
    
    // Print statistics section
    console.log("");
    console.log(colorStart + "============= Print Statistics =============" + reset);
    console.log(colorStart + `📊 Total prints: ${printCount}` + reset);
    console.log(colorStart + "==========================================\n" + reset);
  });
})(); 