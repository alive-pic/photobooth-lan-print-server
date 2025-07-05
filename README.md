# PhotoBooth LAN Print Server

Zero-install LAN print server that pairs with the PhotoBooth iPad app.

## Features

* **HTTP API** – `POST /print` (PNG/JPEG base64) & `GET /health`
* **mDNS/Bonjour** – advertises `_photoprint._tcp` with printer meta
* **Cross-platform** – Windows (PowerShell) & macOS/Linux (CUPS `lp`)
* **Zero-install** – only Node 18+ required, no global packages
* **CORS** – open to any origin

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

## Environment variables

| Name          | Default | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `PORT`        | `4000`  | HTTP port                                        |
| `PRINTER_NAME`| *(auto)*| Printer to use; leave blank to use OS default    |

---

## Printing commands

### Windows

`PowerShell` is used:

```powershell
Start-Process -FilePath <file> -Verb Print -PassThru
```

Ensure a default printer is configured in **Settings → Printers & Scanners**.

### macOS / Linux

Relies on CUPS:

```bash
lp -d <printer> -n <copies> <file>
```

Make sure a default printer is available (`lpstat -d`).

---

## Run as a background service

* **Windows** – create a *Scheduled Task* that runs `npm start` at logon.
* **macOS** – create a *LaunchAgent* in `~/Library/LaunchAgents`.
* **Linux** – create a *systemd* user service in `~/.config/systemd/user`.

---

MIT License. 