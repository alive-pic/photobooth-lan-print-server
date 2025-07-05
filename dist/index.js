"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const uuid_1 = require("uuid");
const os_1 = __importDefault(require("os"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const bonjour_1 = __importDefault(require("bonjour"));
const print_1 = require("./print");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json({ limit: "20mb" }));
const port = Number(process.env.PORT) || 4000;
let printerName = "";
(async () => {
    try {
        const detected = await (0, print_1.detectDefaultPrinter)();
        if (detected) {
            printerName = detected;
        }
        else {
            console.warn("No default printer detected – printing will fall back to Windows default queue");
        }
    }
    catch (err) {
        console.warn("Could not detect default printer:", err);
    }
    // Advertise via mDNS/Bonjour
    const bonjour = (0, bonjour_1.default)();
    bonjour.publish({
        name: "PhotoBooth Print Server",
        type: "photoprint",
        port,
        txt: {
            printer: printerName || "default",
        },
    });
    app.get("/health", (_, res) => {
        res.send("OK");
    });
    app.post("/print", async (req, res) => {
        const { copies = 1, mimeType = "image/png", data } = req.body || {};
        if (!data || typeof data !== "string") {
            return res.status(400).json({ error: "Missing base64 data" });
        }
        const jobId = (0, uuid_1.v4)();
        const ext = mimeType === "image/jpeg" ? "jpg" : "png";
        const tempDir = os_1.default.tmpdir();
        const filePath = path_1.default.join(tempDir, `${jobId}.${ext}`);
        try {
            await promises_1.default.writeFile(filePath, Buffer.from(data, "base64"));
            console.log(`[${jobId}] Saved print file to ${filePath}`);
            await (0, print_1.print)({ filePath, copies, printerName });
            console.log(`[${jobId}] Print command completed`);
            res.json({ jobId, copies });
        }
        catch (err) {
            console.error(`[${jobId}] Print error`, err);
            res.status(500).json({ error: err.message });
        }
        finally {
            try {
                await promises_1.default.rm(filePath, { force: true });
                console.log(`[${jobId}] Temp file removed`);
            }
            catch (err) {
                console.warn(`[${jobId}] Failed to remove temp file`, err);
            }
        }
    });
    app.listen(port, "0.0.0.0", () => {
        const nets = os_1.default.networkInterfaces();
        const addrs = [];
        for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
                if (net.family === "IPv4" && !net.internal) {
                    addrs.push(net.address);
                }
            }
        }
        if (addrs.length === 0) {
            console.log(`Print server listening on http://localhost:${port}`);
        }
        else {
            console.log("Print server listening on:");
            for (const addr of addrs) {
                console.log(`  http://${addr}:${port}`);
            }
        }
        console.log(`Advertising _photoprint._tcp with printer=\"${printerName}\"`);
    });
})();
