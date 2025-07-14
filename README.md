# PhotoBooth LAN Print Server

Zero-install LAN print server that pairs with the PhotoBooth iPad app with **enhanced printer compatibility** for modern and specialized printers.

## Features

* **HTTP API** – `POST /print` (PNG/JPEG base64) & `GET /health`, `/info`, `/printers`
* **Enhanced Printer Compatibility** – Multiple printing methods for better support of specialized printers like DNP-DS620
* **mDNS/Bonjour** – advertises `_photoprint._tcp` with printer meta
* **Cross-platform** – Windows (PowerShell) & macOS/Linux (CUPS `lp`)
* **Zero-install** – only Node 18+ required, no global packages
* **CORS** – open to any origin
* **Automatic Fallback** – tries multiple printing methods for maximum compatibility

## 🔧 Printer Compatibility Fix

**Problem Solved**: The original version used deprecated Windows APIs that didn't work with modern specialized printers like the DNP-DS620. This version implements multiple printing methods:

1. **PowerShell Start-Process** (modern, compatible with most printers)
2. **rundll32 printui.dll** (specialized printers like DNP-DS620)
3. **ImageView_PrintTo** (legacy fallback for older systems)

The server automatically tries all methods in order, ensuring your printer works regardless of type.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template & edit if needed
cp .env.example .env

# 3. Run in dev-mode (auto reload)
npm run dev

# ‑- OR build & start as a service ‑-

npm run build
npm start
```

The service advertises itself on the local network. The PhotoBooth app should detect it automatically.

---

## API Endpoints

### POST /print

Print an image with enhanced compatibility.

```json
{
  "data": "base64-encoded-image-data",
  "copies": 1,
  "mimeType": "image/png",
  "targetPrinter": "DNP-DS620" // Optional: specify printer
}
```

### GET /printers

Get available printers on the system.

```json
{
  "defaultPrinter": "DNP-DS620",
  "availablePrinters": ["DNP-DS620", "CITIZEN 01", "MITSUBISHI"],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /info

Get detailed system and compatibility information.

```json
{
  "printerName": "DNP-DS620",
  "availablePrinters": ["DNP-DS620", "CITIZEN 01"],
  "platform": "win32",
  "printingMethods": [
    "PowerShell Start-Process (modern)",
    "rundll32 printui.dll (specialized printers)",
    "ImageView_PrintTo (legacy fallback)"
  ]
}
```

---

## Environment variables

| Name          | Default | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `PORT`        | `4000`  | HTTP port                                        |
| `PRINTER_NAME`| *(auto)*| Printer to use; leave blank to use OS default    |

---

## Troubleshooting Printer Issues

### DNP-DS620 Not Working?

1. **Check Printer Drivers**: Ensure DNP-DS620 drivers are properly installed
2. **Verify Printer Status**: Check if printer is online and not in error state
3. **Test with Different Methods**: The server logs which method succeeded
4. **Check Print Spooler**: Ensure Windows print spooler service is running

### General Printing Issues

1. **Check Available Printers**: Use `GET /printers` to see detected printers
2. **Specify Target Printer**: Use `targetPrinter` in POST requests
3. **Review Logs**: Server logs show which printing method succeeded/failed
4. **Driver Updates**: Ensure printer drivers are up to date

### Logs to Check

The server provides detailed logging:

```
[INFO] Default printer detected: DNP-DS620
[INFO] Available printers: DNP-DS620, CITIZEN 01, MITSUBISHI
[print] Attempting PowerShell Start-Process method...
[print] PowerShell Start-Process method succeeded
```

---

## Printing commands

### Windows (Enhanced)

The server now uses **three methods** in order:

1. **PowerShell Start-Process** (modern):
   ```powershell
   Start-Process -FilePath 'image.png' -Verb Print -WindowStyle Hidden -Wait
   ```

2. **rundll32 printui.dll** (specialized printers):
   ```cmd
   rundll32 printui.dll,PrintUIEntry /k /n "DNP-DS620" /t "image.png"
   ```

3. **ImageView_PrintTo** (legacy fallback):
   ```cmd
   rundll32 shimgvw.dll,ImageView_PrintTo image.png DNP-DS620
   ```

### macOS / Linux

Relies on CUPS:

```bash
lp -d <printer> -n <copies> <file>
```

Make sure a default printer is available (`lpstat -d`).

---

## Supported Printers

✅ **Confirmed Working**:
- DNP-DS620 (fixed in this version)
- CITIZEN 01
- MITSUBISHI printers
- Most Windows-compatible printers

✅ **Expected to Work**:
- Canon photo printers
- HP photo printers
- Epson photo printers
- Any printer with proper Windows drivers

---

## Run as a background service

* **Windows** – create a *Scheduled Task* that runs `npm start` at logon.
* **macOS** – create a *LaunchAgent* in `~/Library/LaunchAgents`.
* **Linux** – create a *systemd* user service in `~/.config/systemd/user`.

---

## Changes in This Version

### Fixed
- 🔧 **DNP-DS620 Compatibility**: Replaced deprecated printing API with modern methods
- 🔧 **Specialized Printer Support**: Added `rundll32 printui.dll` method
- 🔧 **Automatic Fallback**: Multiple printing methods tried in sequence

### Added
- 🆕 **GET /printers**: List available printers
- 🆕 **targetPrinter**: Specify printer in POST requests
- 🆕 **Enhanced Logging**: Detailed printing method information
- 🆕 **Better Error Messages**: Troubleshooting suggestions included

### Improved
- 🚀 **Printer Detection**: Lists all available printers on startup
- 🚀 **Compatibility Information**: Shows which printing methods are available
- 🚀 **Error Handling**: More informative error responses

---

MIT License. 