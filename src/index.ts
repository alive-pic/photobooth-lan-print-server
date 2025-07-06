import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import fs from "fs/promises";
import path from "path";
import bonjourLib from "bonjour";
import { print, detectDefaultPrinter } from "./print";
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
    const detected = await detectDefaultPrinter();
    if (detected) {
      printerName = detected;
    } else {
      console.warn("No default printer detected – printing will fall back to Windows default queue");
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
    },
  });

  app.get("/health", (req, res) => {
    console.log(`[DEBUG] /health check received from ${req.ip}`);
    res.send("OK");
  });

  app.post("/print", async (req, res) => {
    const { copies = 1, mimeType = "image/png", data } = req.body || {};

    if (!data || typeof data !== "string") {
      return res.status(400).json({ error: "Missing base64 data" });
    }

    const jobId = uuidv4();
    console.log(`[DEBUG] /print request ${jobId} copies=${copies} mime=${mimeType}`);
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `${jobId}.${ext}`);

    try {
      await fs.writeFile(filePath, Buffer.from(data, "base64"));
      console.log(`[${jobId}] Saved print file to ${filePath}`);

      await print({ filePath, copies, printerName });
      console.log(`[${jobId}] Print command completed`);

      res.json({ jobId, copies });
    } catch (err: any) {
      console.error(`[${jobId}] Print error`, err);
      res.status(500).json({ error: err.message });
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
    console.log(`Advertising _photoprint._tcp with printer=\"${printerName}\"`);

    // No automatic browser launch; users can navigate manually.
  });
})(); 