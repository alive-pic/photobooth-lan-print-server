"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.print = print;
exports.detectDefaultPrinter = detectDefaultPrinter;
exports.getAvailablePrinters = getAvailablePrinters;
exports.getPrinterPageSize = getPrinterPageSize;
const process_1 = require("process");
const child_process_1 = require("child_process");
const util_1 = require("util");
const path_1 = require("path");
const os_1 = __importDefault(require("os"));
const uuid_1 = require("uuid");
const fs_1 = require("fs");
const https_1 = __importDefault(require("https"));
const fsSync = __importStar(require("fs"));
// Promisified execFile for async/await usage. Mimics a subset of execa's API we relied on.
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function print({ filePath, copies, printerName, hasAccess = false, paperSize, isFullCover = false }) {
    const isWindows = process_1.platform === "win32";
    let fileToPrint = filePath;
    let tempWatermark;
    if (!hasAccess) {
        // Locate watermark asset on disk (works in dev and packaged builds)
        const baseDir = process.pkg ? (0, path_1.dirname)(process.execPath) : (0, path_1.dirname)(__dirname);
        const watermarkSrc = (0, path_1.resolve)(baseDir, "public", "images", "watermark.jpg");
        // Copy watermark to a real temporary path because embedded assets might be in a snapshot
        tempWatermark = (0, path_1.resolve)(os_1.default.tmpdir(), `watermark-${(0, uuid_1.v4)()}.jpg`);
        try {
            await fs_1.promises.copyFile(watermarkSrc, tempWatermark);
        }
        catch {
            try {
                const data = await fs_1.promises.readFile(watermarkSrc);
                await fs_1.promises.writeFile(tempWatermark, data);
            }
            catch {
                await downloadWatermark(tempWatermark);
            }
        }
        fileToPrint = tempWatermark;
    }
    // When hasAccess is false, always print only 1 copy
    const copiesToPrint = hasAccess ? copies : 1;
    const disableMargin = isFullCover;
    if (isWindows) {
        // Try PowerShell Start-Process first, fallback to ImageView_PrintTo for images
        const printSuccess = await tryWindowsPrintMethods(fileToPrint, copiesToPrint, printerName, paperSize, disableMargin);
        if (!printSuccess) {
            throw new Error("All Windows printing methods failed");
        }
    }
    else {
        const args = [];
        if (printerName && printerName.trim().length > 0) {
            args.push("-d", printerName);
        }
        args.push("-n", String(copiesToPrint), fileToPrint);
        await execFileAsync("lp", args, { timeout: 30000 });
    }
    // Cleanup temporary watermark copy
    if (tempWatermark) {
        try {
            await fs_1.promises.unlink(tempWatermark);
        }
        catch { }
    }
}
async function tryWindowsPrintMethods(filePath, copies, printerName, paperSize, disableMargin = false) {
    // Method 1: Use .NET printing system through PowerShell (respects all printer preferences)
    try {
        await printWithDotNetPrinting(filePath, copies, printerName, paperSize, disableMargin);
        return true;
    }
    catch (err) {
        console.log('.NET printing failed, falling back to basic methods');
    }
    // Method 2: PowerShell Start-Process with Print verb (fallback method)
    try {
        await printWithPowerShell(filePath, copies, printerName, paperSize);
        return true;
    }
    catch (err) {
        // Suppress detailed error messages for user experience
    }
    // Method 3: Legacy ImageView_PrintTo method (fallback for images only)
    if (isImageFile(filePath)) {
        try {
            await printWithImageView(filePath, copies, printerName, paperSize);
            return true;
        }
        catch (err) {
            // Suppress detailed error messages for user experience
        }
    }
    return false;
}
async function printWithDotNetPrinting(filePath, copies, printerName, paperSize, disableMargin = false) {
    // This method uses .NET printing classes through PowerShell to respect all printer preferences
    // including cutting settings, paper sizes, and other driver-specific options
    const disableMarginFlag = disableMargin ? '$true' : '$false';
    const marginValue = disableMargin ? 0 : 10.0; // 0 disables margin for full-cover
    const escapedFilePath = filePath.replace(/'/g, "''");
    const escapedPrinterName = printerName ? printerName.replace(/'/g, "''") : '';
    const powershellScript = `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    
    $filePath = '${escapedFilePath}'
    $copies = ${copies}
    $printerName = '${escapedPrinterName}'
    $disableMargin = ${disableMarginFlag}
    
    try {
      # Create PrintDocument object
      $printDoc = New-Object System.Drawing.Printing.PrintDocument
      
      # Set printer name if specified, otherwise use default
      if ($printerName -and $printerName.Trim() -ne '') {
        $printDoc.PrinterSettings.PrinterName = $printerName
      }
      
      # Set number of copies
      $printDoc.PrinterSettings.Copies = $copies
      
      # Important: Use the printer's default settings (including cutting preferences and orientation)
      # This ensures all user-configured preferences are respected
      $printDoc.DefaultPageSettings = $printDoc.PrinterSettings.DefaultPageSettings
      
      # Set document name for print queue
      $printDoc.DocumentName = Split-Path $filePath -Leaf
      
      # Load and print the image
      $image = $null
      $printDoc.add_PrintPage({
        param($sender, $e)
        try {
          $image = [System.Drawing.Image]::FromFile($filePath)
          
          # Determine printer page orientation – some drivers don’t set Landscape flag correctly
          $pageIsLandscape = $e.PageSettings.Landscape -or ($e.PageBounds.Width -gt $e.PageBounds.Height)
          
          # Obtain page bounds (already rotated if landscape)
          $pageWidth = $e.PageBounds.Width
          $pageHeight = $e.PageBounds.Height

          # Obtain printable area (coordinates relative to page origin)
          $originX = $e.PageSettings.PrintableArea.X
          $originY = $e.PageSettings.PrintableArea.Y
          $printableWidth = $e.PageSettings.PrintableArea.Width
          $printableHeight = $e.PageSettings.PrintableArea.Height

          # For borderless/full-cover templates, override printable area to page bounds
          if ($disableMargin) {
              $originX = 0
              $originY = 0
              $printableWidth  = $pageWidth
              $printableHeight = $pageHeight
          }

          # ---- BEGIN DUPLICATE‐STRIP PATH (disabled by default) ----
          $tileTwoCopies = $false  # PhotoBooth already duplicates when needed
          if ($tileTwoCopies) {
              # Dimensions
              $stripWidth  = $image.Width
              $stripHeight = $image.Height
              # scale calc same as before
              $availableHalfWidth = $printableWidth / 2
              $scaleX = $availableHalfWidth / $stripWidth
              $scaleY = $printableHeight / $stripHeight
              $scale  = [Math]::Min($scaleX, $scaleY)
              $copyWidth  = [int]($stripWidth  * $scale)
              $copyHeight = [int]($stripHeight * $scale)
              # Equal three-way gap: left margin == center gap == right margin
              $gap = ($printableWidth - (2 * $copyWidth)) / 3
              if ($gap -lt 0) { $gap = 0 }
              $x1 = $originX + $gap
              $x2 = $originX + $gap + $copyWidth + $gap
              $y  = $originY + ($printableHeight - $copyHeight) / 2
              $destRect1 = New-Object System.Drawing.Rectangle ([int]$x1), [int]$y, $copyWidth, $copyHeight
              $destRect2 = New-Object System.Drawing.Rectangle ([int]$x2), [int]$y, $copyWidth, $copyHeight
              $e.Graphics.DrawImage($image, $destRect1)
              $e.Graphics.DrawImage($image, $destRect2)
          }
          else {
              # ---- STANDARD SINGLE-IMAGE PATH ----
              # Dimensions of source image
              $imageWidth  = $image.Width
              $imageHeight = $image.Height
              $imageIsLandscape = $imageWidth -gt $imageHeight
              
              $pageIsLandscape = $printableWidth -gt $printableHeight
              
              # Handle orientation mismatch (optional rotate 90°)
              $rotatedImage      = $image
              $finalImageWidth   = $imageWidth
              $finalImageHeight  = $imageHeight
              $shouldRotate = $false
              if ($pageIsLandscape -ne $imageIsLandscape) {
                  $pageRatio   = $printableWidth / [double]$printableHeight
                  $imageRatio  = $imageWidth     / [double]$imageHeight
                  $ratioDiff   = [Math]::Abs($pageRatio - (1 / $imageRatio))
                  if ($ratioDiff -gt 0.2) { $shouldRotate = $true }
              }
              if ($shouldRotate) {
                  $rotatedImage = New-Object System.Drawing.Bitmap $imageHeight, $imageWidth
                  $g = [System.Drawing.Graphics]::FromImage($rotatedImage)
                  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                  $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                  $g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                  $g.TranslateTransform($imageHeight / 2, $imageWidth / 2)
                  $g.RotateTransform(90)
                  $g.TranslateTransform(-$imageWidth / 2, -$imageHeight / 2)
                  $g.DrawImage($image, 0, 0, $imageWidth, $imageHeight)
                  $g.Dispose()
                  $finalImageWidth  = $imageHeight
                  $finalImageHeight = $imageWidth
              }
              
              # Scale to fit printable region
              $scaleX = $printableWidth  / $finalImageWidth
              $scaleY = $printableHeight / $finalImageHeight
              if ($disableMargin) {
                  # FULL-COVER: fill entire page (cover) – may crop
                  $scale  = [Math]::Max($scaleX, $scaleY)
              }
              else {
                  # Standard: contain within printable area
                  $scale  = [Math]::Min($scaleX, $scaleY)
              }
              $newWidth  = [int]($finalImageWidth  * $scale)
              $newHeight = [int]($finalImageHeight * $scale)
              
              if (-not $disableMargin) {
                  # BEGIN: Safe margin to avoid clipping outer edges (approx 0.125")
                  $margin = ${marginValue}
                  if ($margin -gt 0 -and $newWidth -gt ($margin * 2) -and $newHeight -gt ($margin * 2)) {
                      $newWidth  = $newWidth  - ($margin * 2)
                      $newHeight = $newHeight - ($margin * 2)
                  }
                  # END: Safe margin
              }
              
              # Center in printable area (may be negative when cover-scaling)
              $x = $originX + ($printableWidth  - $newWidth ) / 2
              $y = $originY + ($printableHeight - $newHeight) / 2
              $destRect = New-Object System.Drawing.Rectangle $x, $y, $newWidth, $newHeight
              $e.Graphics.DrawImage($rotatedImage, $destRect)
              if ($rotatedImage -ne $image) { $rotatedImage.Dispose() }
          }
          
          if ($image) { $image.Dispose() }
        } catch {
          Write-Error "Error drawing image: $_"
        }
      })
      
      # Add cleanup handler
      $printDoc.add_EndPrint({
        if ($image) {
          $image.Dispose()
        }
      })
      
      # Print the document - this will use all configured printer preferences
      # including orientation, cutting, paper size, etc.
      $printDoc.Print()
      
    } catch {
      Write-Error "Printing failed: $_"
      exit 1
    } finally {
      if ($image) { $image.Dispose() }
      if ($printDoc) { $printDoc.Dispose() }
    }
  `;
    await execFileAsync("powershell", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", powershellScript
    ], { timeout: 30000 });
}
async function printWithAdvancedWindowsAPI(filePath, copies, printerName, paperSize) {
    // Deprecated: This method had issues with printer preferences
    // Now using printWithDotNetPrinting as the primary method
    throw new Error("Advanced Windows API method deprecated - using .NET printing instead");
}
async function printWithPowerShell(filePath, copies, printerName, paperSize) {
    for (let i = 0; i < copies; i++) {
        let powershellCommand = `Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait`;
        // Note: PowerShell Start-Process does not support specifying a printer directly
        // The print dialog will use the default printer, or the user must set the default printer
        // If you want to force a printer, you must set it as default before printing
        await execFileAsync("powershell", [
            "-NoProfile",
            "-Command",
            powershellCommand
        ], { timeout: 30000 });
    }
}
async function printWithImageView(filePath, copies, printerName, paperSize) {
    // Legacy method using Windows Image and Fax Viewer
    const dllEntry = `${process.env.SystemRoot}\\System32\\shimgvw.dll,ImageView_PrintTo`;
    for (let i = 0; i < copies; i++) {
        const args = [dllEntry, filePath];
        if (printerName && printerName.trim().length > 0) {
            args.push(printerName);
        }
        await execFileAsync("rundll32.exe", args, { timeout: 30000 });
    }
}
function isImageFile(filePath) {
    return /\.(png|jpg|jpeg|bmp|gif)$/i.test(filePath);
}
async function detectDefaultPrinter() {
    const isWindows = process_1.platform === "win32";
    try {
        if (isWindows) {
            // Force UTF-8 output so Unicode printer names (e.g. Hebrew) are preserved
            const psScriptDefaultPrinter = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name`;
            const { stdout } = await execFileAsync("powershell", [
                "-NoProfile",
                "-Command",
                psScriptDefaultPrinter,
            ], {
                timeout: 10000,
                encoding: "utf8",
            });
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
            // Force UTF-8 output so Unicode printer names are preserved
            const psScriptAllPrinters = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Printer).Name`;
            const { stdout } = await execFileAsync("powershell", [
                "-NoProfile",
                "-Command",
                psScriptAllPrinters,
            ], {
                timeout: 10000,
                encoding: "utf8",
            });
            return stdout.trim().split(/\r?\n/).filter(name => name.trim().length > 0);
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
// New function to get printer's current page size settings
async function getPrinterPageSize(printerName) {
    const isWindows = process_1.platform === "win32";
    try {
        if (isWindows) {
            const targetPrinter = printerName || await detectDefaultPrinter();
            if (!targetPrinter) {
                return null;
            }
            // Use PowerShell to get printer's current page size settings
            const escapedPrinterName = targetPrinter.replace(/'/g, "''");
            const psScriptPageSize = `
        [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; 
        $OutputEncoding=[System.Text.Encoding]::UTF8;
        
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        
        $printerName = '${escapedPrinterName}'
        
        try {
          $printDoc = New-Object System.Drawing.Printing.PrintDocument
          $printDoc.PrinterSettings.PrinterName = $printerName
          
          # Get the default page settings
          $pageSettings = $printDoc.PrinterSettings.DefaultPageSettings
          
          # Get both paper size and printable area
          $paperWidth = [Math]::Round($pageSettings.PaperSize.Width / 100, 2)
          $paperHeight = [Math]::Round($pageSettings.PaperSize.Height / 100, 2)
          $printableWidth = [Math]::Round($pageSettings.PrintableArea.Width / 100, 2)
          $printableHeight = [Math]::Round($pageSettings.PrintableArea.Height / 100, 2)
          $paperName = $pageSettings.PaperSize.PaperName
          
          # Try to get more detailed paper information
          $paperSizeInfo = $pageSettings.PaperSize
          $isCustom = $paperSizeInfo.Kind -eq [System.Drawing.Printing.PaperKind]::Custom
          
          # Map common paper sizes to standard names
          $standardSizes = @{
            "4x6" = @{ width = 4; height = 6; name = "4x6 Photo" }
            "5x7" = @{ width = 5; height = 7; name = "5x7 Photo" }
            "6x4" = @{ width = 6; height = 4; name = "6x4 Photo" }
            "3x5" = @{ width = 3; height = 5; name = "3x5 Photo" }
            "8x10" = @{ width = 8; height = 10; name = "8x10 Photo" }
          }
          
          # Try to match the paper size to a standard size
          $matchedSize = $null
          foreach ($size in $standardSizes.GetEnumerator()) {
            $key = $size.Key
            $value = $size.Value
            # Allow for small variations (within 0.5 inches)
            if ([Math]::Abs($paperWidth - $value.width) -lt 0.5 -and [Math]::Abs($paperHeight - $value.height) -lt 0.5) {
              $matchedSize = $value
              break
            }
            # Also check if dimensions are swapped (landscape vs portrait)
            if ([Math]::Abs($paperWidth - $value.height) -lt 0.5 -and [Math]::Abs($paperHeight - $value.width) -lt 0.5) {
              $matchedSize = @{ width = $value.height; height = $value.width; name = $value.name + " (Landscape)" }
              break
            }
          }
          
          # Return as JSON
          $result = @{
            paperWidth = $paperWidth
            paperHeight = $paperHeight
            printableWidth = $printableWidth
            printableHeight = $printableHeight
            paperName = $paperName
            isCustom = $isCustom
            matchedSize = $matchedSize
          } | ConvertTo-Json -Compress
          
          Write-Output $result
          
        } catch {
          Write-Error "Failed to get page size: $_"
          exit 1
        }
      `;
            const { stdout } = await execFileAsync("powershell", [
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command",
                psScriptPageSize,
            ], {
                timeout: 10000,
                encoding: "utf8",
            });
            const result = JSON.parse(stdout.trim());
            // If we have a matched standard size, use that
            if (result.matchedSize) {
                return {
                    widthInch: result.matchedSize.width,
                    heightInch: result.matchedSize.height,
                    name: result.matchedSize.name,
                    actualPaperSize: {
                        widthInch: result.paperWidth,
                        heightInch: result.paperHeight,
                        name: result.paperName
                    },
                    printableArea: {
                        widthInch: result.printableWidth,
                        heightInch: result.printableHeight
                    }
                };
            }
            // Otherwise return the actual paper size
            return {
                widthInch: result.paperWidth,
                heightInch: result.paperHeight,
                name: result.paperName,
                isCustom: result.isCustom,
                printableArea: {
                    widthInch: result.printableWidth,
                    heightInch: result.printableHeight
                }
            };
        }
        else {
            // For non-Windows systems, try to get page size from CUPS
            const targetPrinter = printerName || await detectDefaultPrinter();
            if (!targetPrinter) {
                return null;
            }
            try {
                const { stdout } = await execFileAsync("lpoptions", ["-p", targetPrinter], { timeout: 10000 });
                const mediaMatch = stdout.match(/media=([^\\s]+)/);
                if (mediaMatch) {
                    const mediaSize = mediaMatch[1];
                    // Common CUPS media sizes mapping
                    const sizeMap = {
                        "4x6": { widthInch: 4, heightInch: 6, name: "4x6 Photo" },
                        "5x7": { widthInch: 5, heightInch: 7, name: "5x7 Photo" },
                        "6x4": { widthInch: 6, heightInch: 4, name: "6x4 Photo" },
                        "letter": { widthInch: 8.5, heightInch: 11, name: "Letter" },
                        "a4": { widthInch: 8.27, heightInch: 11.69, name: "A4" },
                        "legal": { widthInch: 8.5, heightInch: 14, name: "Legal" }
                    };
                    return sizeMap[mediaSize] || { widthInch: 0, heightInch: 0, name: mediaSize };
                }
            }
            catch {
                // Fallback to default size if CUPS query fails
                return { widthInch: 4, heightInch: 6, name: "Default Photo Size" };
            }
            // If we get here, return a default size
            return { widthInch: 4, heightInch: 6, name: "Default Photo Size" };
        }
    }
    catch (error) {
        console.error("Failed to get printer page size:", error);
        return null;
    }
}
async function downloadWatermark(dest) {
    const url = "https://raw.githubusercontent.com/alive-pic/photobooth-lan-print-server/main/src/public/images/watermark.jpg";
    await new Promise((resolve, reject) => {
        https_1.default.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to download watermark: HTTP ${res.statusCode}`));
            }
            const file = fsSync.createWriteStream(dest);
            res.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
        }).on("error", reject);
    });
}
