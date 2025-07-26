"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkForUpdates = checkForUpdates;
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const semver_1 = __importDefault(require("semver"));
/**
 * Check GitHub for a newer version and, if found, update automatically.
 *
 * This function returns `true` if the current process **should exit now**
 * because an update has been started. In that case the caller must **return immediately**.
 */
async function checkForUpdates() {
    try {
        const localPkgPath = path_1.default.resolve(__dirname, "../package.json");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const localPkg = JSON.parse(fs_1.default.readFileSync(localPkgPath, "utf8"));
        const currentVersion = localPkg.version || "0.0.0";
        const remotePkgJson = await fetchRawGithubFileAsString("alive-pic", "photobooth-lan-print-server", "main", "package.json");
        if (!remotePkgJson) {
            return false; // Could not fetch – silently continue
        }
        const remotePkg = JSON.parse(remotePkgJson);
        const remoteVersion = remotePkg.version || "0.0.0";
        if (!semver_1.default.valid(currentVersion) || !semver_1.default.valid(remoteVersion)) {
            return false; // Invalid semver, skip
        }
        if (semver_1.default.lt(currentVersion, remoteVersion)) {
            console.log(`\x1b[38;2;2;197;255m[UPDATE] New version ${remoteVersion} available (current ${currentVersion}). Updating…\x1b[0m`);
            const updated = await performSelfUpdate(remoteVersion);
            return updated; // if true, caller should exit
        }
    }
    catch (err) {
        // Fail silently – we don't want to interrupt main flow
    }
    return false;
}
async function performSelfUpdate(remoteVersion) {
    // If running inside a pkg executable use binary replacement, otherwise git pull
    const isPkg = process.pkg !== undefined;
    if (isPkg) {
        return await updateCompiledBinary(remoteVersion);
    }
    return await updateFromGit(remoteVersion);
}
// ────────────────────────────────────────────────────────────
// Git-based update (development / source install)
// ────────────────────────────────────────────────────────────
async function updateFromGit(_remoteVersion) {
    try {
        const repoRoot = path_1.default.resolve(__dirname, "..");
        console.log("[UPDATE] Updating via git pull…");
        (0, child_process_1.execSync)("git fetch --all", { cwd: repoRoot, stdio: "inherit" });
        (0, child_process_1.execSync)("git reset --hard origin/main", { cwd: repoRoot, stdio: "inherit" });
        (0, child_process_1.execSync)("npm install --production", { cwd: repoRoot, stdio: "inherit" });
        // Rebuild in case source changed
        (0, child_process_1.execSync)("npm run build", { cwd: repoRoot, stdio: "inherit" });
        // Relaunch
        (0, child_process_1.spawn)("npm", ["start"], {
            cwd: repoRoot,
            stdio: "inherit",
            detached: true,
        });
        console.log("[UPDATE] Relaunching updated version…");
        return true; // caller should exit
    }
    catch (err) {
        console.error("[UPDATE] Git-based update failed", err);
        return false;
    }
}
// ────────────────────────────────────────────────────────────
// pkg-compiled executable update
// ────────────────────────────────────────────────────────────
async function updateCompiledBinary(_remoteVersion) {
    try {
        const assetName = getAssetName();
        const downloadUrl = `https://github.com/alive-pic/photobooth-lan-print-server/raw/main/releases/${assetName}`;
        const tempFile = path_1.default.join(os_1.default.tmpdir(), assetName);
        console.log(`[UPDATE] Downloading latest binary (${assetName})…`);
        await downloadFile(downloadUrl, tempFile);
        // Make executable on *nix
        if (process.platform !== "win32") {
            fs_1.default.chmodSync(tempFile, 0o755);
        }
        console.log("[UPDATE] Launching new version…");
        const args = process.argv.slice(2); // preserve user args
        const child = (0, child_process_1.spawn)(tempFile, args, {
            detached: true,
            stdio: "inherit",
        });
        child.unref();
        return true; // caller should exit
    }
    catch (err) {
        console.error("[UPDATE] Binary update failed", err);
        return false;
    }
}
function getAssetName() {
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
// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function fetchRawGithubFileAsString(owner, repo, branch, filePath) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    return new Promise((resolve, reject) => {
        https_1.default
            .get(rawUrl, {
            headers: {
                "User-Agent": "alive-print-updater",
                Accept: "application/vnd.github.v3.raw",
            },
        }, (res) => {
            if (res.statusCode !== 200) {
                resolve(null);
                res.resume();
                return;
            }
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
        })
            .on("error", (err) => reject(err));
    });
}
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs_1.default.createWriteStream(dest);
        https_1.default
            .get(url, (response) => {
            if (response.statusCode !== 200) {
                file.close();
                fs_1.default.unlink(dest, () => { });
                return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
            }
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
        })
            .on("error", (err) => {
            file.close();
            fs_1.default.unlink(dest, () => { });
            reject(err);
        });
    });
}
