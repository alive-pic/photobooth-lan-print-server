import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync, spawn } from "child_process";
import semver from "semver";

// ANSI cyan for prefix
const cyan = "\x1b[38;2;2;197;255m";
const reset = "\x1b[0m";

/**
 * Check GitHub for a newer version and, if found, update automatically.
 *
 * This function returns `true` if the current process **should exit now**
 * because an update has been started. In that case the caller must **return immediately**.
 */
export async function checkForUpdates(): Promise<boolean> {
  try {
    const currentVersion = getCurrentVersion();

    console.log(`${cyan}[UPDATE] Checking for updates… (current ${currentVersion})${reset}`);

    const remotePkgJson = await fetchRawGithubFileAsString(
      "alive-pic",
      "photobooth-lan-print-server",
      "main",
      "package.json"
    );
    if (!remotePkgJson) {
      console.warn("[UPDATE] Could not fetch latest version information – skipping update check.");
      return false;
    }
    const remotePkg = JSON.parse(remotePkgJson);
    const remoteVersion: string = remotePkg.version || "0.0.0";

    if (!semver.valid(currentVersion) || !semver.valid(remoteVersion)) {
      console.warn("[UPDATE] Invalid semver detected – skipping update check.");
      return false;
    }

    if (semver.lt(currentVersion, remoteVersion)) {
      console.log(`\x1b[38;2;2;197;255m[UPDATE] Detected older version ${currentVersion}. Updating to ${remoteVersion}…\x1b[0m`);
      const updated = await performSelfUpdate(remoteVersion);
      return updated; // if true, caller should exit
    } else {
      if (semver.gt(currentVersion, remoteVersion)) {
        console.log(`\x1b[38;2;2;197;255m[UPDATE] You are running a newer local version (${currentVersion}) than the official release (${remoteVersion}).\x1b[0m`);
      } else {
        console.log(`\x1b[38;2;2;197;255m[UPDATE] You are already running the latest version (${currentVersion}).\x1b[0m`);
      }
    }
  } catch (err) {
    console.error("[UPDATE] Unexpected error during update check", err);
  }
  return false;
}

async function performSelfUpdate(remoteVersion: string): Promise<boolean> {
  // If running inside a pkg executable use binary replacement, otherwise git pull
  const isPkg = (process as any).pkg !== undefined;
  if (isPkg) {
    return await updateCompiledBinary(remoteVersion);
  }
  return await updateFromGit(remoteVersion);
}

// ────────────────────────────────────────────────────────────
// Git-based update (development / source install)
// ────────────────────────────────────────────────────────────
async function updateFromGit(_remoteVersion: string): Promise<boolean> {
  try {
    const repoRoot = path.resolve(__dirname, "..");
    console.log("[UPDATE] Updating via git pull…");
    execSync("git fetch --all", { cwd: repoRoot, stdio: "inherit" });
    execSync("git reset --hard origin/main", { cwd: repoRoot, stdio: "inherit" });
    execSync("npm install", { cwd: repoRoot, stdio: "inherit" });
    // Rebuild in case source changed
    execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });

    // Relaunch using node directly to avoid npm path issues
    const entry = path.join(repoRoot, "dist", "index.js");
    spawn(process.execPath, [entry], {
      cwd: repoRoot,
      stdio: "inherit",
      detached: true,
    });
    console.log("[UPDATE] Relaunching updated version…");
    return true; // caller should exit
  } catch (err) {
    console.error("[UPDATE] Git-based update failed", err);
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// pkg-compiled executable update
// ────────────────────────────────────────────────────────────
async function updateCompiledBinary(_remoteVersion: string): Promise<boolean> {
  try {
    const assetName = getAssetName();
    const downloadUrl = `https://github.com/alive-pic/photobooth-lan-print-server/raw/main/releases/${assetName}`;

    const tempFile = path.join(os.tmpdir(), assetName);
    console.log(`[UPDATE] Downloading latest binary (${assetName})…`);
    try {
      await downloadFile(downloadUrl, tempFile);
    } catch (err: any) {
      if (err.message && err.message.includes("404")) {
        console.warn("[UPDATE] Pre-built binary not found – falling back to source update.");
        const ok = await updateFromGit(_remoteVersion);
        if (!ok) {
          logManualDownloadInstruction();
        }
        return ok;
      }
      logManualDownloadInstruction();
      throw err;
    }

    // Make executable on *nix
    if (process.platform !== "win32") {
      fs.chmodSync(tempFile, 0o755);
    }

    console.log("[UPDATE] Launching new version…");
    const args = process.argv.slice(2); // preserve user args
    const child = spawn(tempFile, args, {
      detached: true,
      stdio: "inherit",
    });
    child.unref();
    // Give the child a moment to start before exiting
    setTimeout(() => {
      console.log("[UPDATE] Exiting old version after launch…");
      process.exit(0);
    }, 500);
    return true;
  } catch (err) {
    console.error("[UPDATE] Binary update failed", err);
    return false;
  }
}

function getAssetName(): string {
  const base = "alive-magic-print";
  switch (process.platform) {
    case "win32":
      return `${base}-windows.exe`;
    case "darwin":
      return `${base}-macos`;
    default:
      return `${base}-linux`;
  }
}

function getCurrentVersion(): string {
  // Attempt 1: `require` works inside pkg snapshot
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgJson = require("../package.json");
    if (pkgJson && pkgJson.version) return pkgJson.version as string;
  } catch {}

  // Attempt 2: read from filesystem relative to process.cwd()
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const data = fs.readFileSync(pkgPath, "utf8");
    const pkgJson = JSON.parse(data);
    if (pkgJson.version) return pkgJson.version as string;
  } catch {}

  return "0.0.0";
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function fetchRawGithubFileAsString(owner: string, repo: string, branch: string, filePath: string): Promise<string | null> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  return new Promise((resolve, reject) => {
    https
      .get(
        rawUrl,
        {
          headers: {
            "User-Agent": "alive-print-updater",
            Accept: "application/vnd.github.v3.raw",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
            res.resume();
            return;
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      )
      .on("error", (err) => reject(err));
  });
}

function downloadFile(url: string, dest: string, depth = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("Too many redirects"));

    https
      .get(url, (response) => {
        // Follow redirect (3xx)
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location.startsWith("http")
            ? response.headers.location
            : new URL(response.headers.location, url).href;
          return resolve(downloadFile(redirectUrl, dest, depth + 1));
        }

        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }

        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          file.close();
          fs.unlink(dest, () => {});
          reject(err);
        });
      })
      .on("error", (err) => reject(err));
  });
}

function logManualDownloadInstruction() {
  console.log(`${cyan}[UPDATE] Automatic update failed. Please download the latest version from:`);
  console.log(`${cyan}https://github.com/alive-pic/photobooth-lan-print-server/tree/main/releases${reset}`);
} 