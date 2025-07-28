import { platform } from "process";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, dirname, resolve } from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import https from "https";
import * as fsSync from "fs";

// Promisified execFile for async/await usage. Mimics a subset of execa's API we relied on.
const execFileAsync = promisify(execFile);

export interface PrintOptions {
  filePath: string;
  copies: number;
  printerName?: string;
  hasAccess?: boolean;
  paperSize?: {
    widthInch: number;
    heightInch: number;
  };
}

export async function print({ filePath, copies, printerName, hasAccess = false, paperSize }: PrintOptions): Promise<void> {
  const isWindows = platform === "win32";
  
  let fileToPrint = filePath;
  let tempWatermark: string | undefined;

  if (!hasAccess) {
    // Locate watermark asset on disk (works in dev and packaged builds)
    const baseDir = (process as any).pkg ? dirname(process.execPath) : dirname(__dirname);
    const watermarkSrc = resolve(baseDir, "public", "images", "watermark.jpg");

    // Copy watermark to a real temporary path because embedded assets might be in a snapshot
    tempWatermark = resolve(os.tmpdir(), `watermark-${uuidv4()}.jpg`);
    try {
      await fs.copyFile(watermarkSrc, tempWatermark);
    } catch {
      try {
        const data = await fs.readFile(watermarkSrc);
        await fs.writeFile(tempWatermark, data);
      } catch {
        await downloadWatermark(tempWatermark);
      }
    }
    fileToPrint = tempWatermark;
  }

  // When hasAccess is false, always print only 1 copy
  const copiesToPrint = hasAccess ? copies : 1;

  if (isWindows) {
    // Try PowerShell Start-Process first, fallback to ImageView_PrintTo for images
    const printSuccess = await tryWindowsPrintMethods(fileToPrint, copiesToPrint, printerName, paperSize);
    if (!printSuccess) {
      throw new Error("All Windows printing methods failed");
    }
  } else {
    const args: string[] = [];
    if (printerName && printerName.trim().length > 0) {
      args.push("-d", printerName);
    }
    args.push("-n", String(copiesToPrint), fileToPrint);
    await execFileAsync("lp", args, { timeout: 30_000 });
  }

  // Cleanup temporary watermark copy
  if (tempWatermark) {
    try { await fs.unlink(tempWatermark); } catch {}
  }
}

async function tryWindowsPrintMethods(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<boolean> {
  // Method 1: Use .NET printing system through PowerShell (respects all printer preferences)
  try {
    await printWithDotNetPrinting(filePath, copies, printerName, paperSize);
    return true;
  } catch (err) {
    console.log('.NET printing failed, falling back to basic methods');
  }

  // Method 2: PowerShell Start-Process with Print verb (fallback method)
  try {
    await printWithPowerShell(filePath, copies, printerName, paperSize);
    return true;
  } catch (err) {
    // Suppress detailed error messages for user experience
  }

  // Method 3: Legacy ImageView_PrintTo method (fallback for images only)
  if (isImageFile(filePath)) {
    try {
      await printWithImageView(filePath, copies, printerName, paperSize);
      return true;
      } catch (err) {
    // Suppress detailed error messages for user experience
  }
  }

  return false;
}

async function printWithDotNetPrinting(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  // This method uses .NET printing classes through PowerShell to respect all printer preferences
  // including cutting settings, paper sizes, and other driver-specific options
  
  const escapedFilePath = filePath.replace(/'/g, "''");
  const escapedPrinterName = printerName ? printerName.replace(/'/g, "''") : '';
  
  const powershellScript = `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    
    $filePath = '${escapedFilePath}'
    $copies = ${copies}
    $printerName = '${escapedPrinterName}'
    
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
          
          # Dimensions of source image (pixels)
          $imageWidth = $image.Width
          $imageHeight = $image.Height
          
          # Detect if the source image itself is landscape
          $imageIsLandscape = $imageWidth -gt $imageHeight
          
          # Detect if the image looks like a narrow strip (either orientation)
          $aspectRatio = if ($imageWidth -gt 0) { $imageHeight / [double]$imageWidth } else { 0 }
          $isStrip = ($aspectRatio -gt 2) -or ($aspectRatio -lt 0.5)
          
          # We need to tile two copies when the page is landscape (e.g. 6x4) AND the source is a strip
          $tileTwoCopies = $pageIsLandscape -and $isStrip
          
          if ($tileTwoCopies) {
            # Ensure the strip is portrait (taller than wide). If it is currently landscape, rotate it 90°.
            $stripImage = $image
            $stripWidth = $imageWidth
            $stripHeight = $imageHeight
            if ($imageIsLandscape) {
              $stripImage = New-Object System.Drawing.Bitmap $imageHeight, $imageWidth
              $g = [System.Drawing.Graphics]::FromImage($stripImage)
              $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
              $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
              $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
              
              $g.TranslateTransform($imageHeight / 2, $imageWidth / 2)
              $g.RotateTransform(90)
              $g.TranslateTransform(-$imageWidth / 2, -$imageHeight / 2)
              $g.DrawImage($image, 0, 0, $imageWidth, $imageHeight)
              $g.Dispose()
              
              $stripWidth = $imageHeight
              $stripHeight = $imageWidth
            }
            
            # Configuration: small gap between strips (in hundredths of an inch)
            $gapInch = 0.1  # ≈2.5 mm
            $gap = [int]($gapInch * 100)
            
            # Scale strip to fill page height (or half page width minus half the gap)
            $availableHalfWidth = ($pageWidth - $gap) / 2
            $scaleX = $availableHalfWidth / $stripWidth
            $scaleY = $pageHeight / $stripHeight
            $scale = [Math]::Min($scaleX, $scaleY)
            
            $copyWidth = [int]($stripWidth * $scale)
            $copyHeight = [int]($stripHeight * $scale)
            
            $totalCopiesWidth = (2 * $copyWidth) + $gap
            $marginLeft = ($pageWidth - $totalCopiesWidth) / 2
            $y = ($pageHeight - $copyHeight) / 2
            
            $destRect1 = New-Object System.Drawing.Rectangle $marginLeft, $y, $copyWidth, $copyHeight
            $destRect2 = New-Object System.Drawing.Rectangle ($marginLeft + $copyWidth + $gap), $y, $copyWidth, $copyHeight
            
            $e.Graphics.DrawImage($stripImage, $destRect1)
            $e.Graphics.DrawImage($stripImage, $destRect2)
            
            if ($stripImage -ne $image) { $stripImage.Dispose() }
          } else {
            # Existing logic – rotate if orientations don't match, then scale to fill/fit as previously implemented
            
            $rotatedImage = $image
            $finalImageWidth = $imageWidth
            $finalImageHeight = $imageHeight
            
            if ($pageIsLandscape -ne $imageIsLandscape) {
              Write-Host "Rotating image to match page orientation"
              $rotatedImage = New-Object System.Drawing.Bitmap $imageHeight, $imageWidth
              $graphics = [System.Drawing.Graphics]::FromImage($rotatedImage)
              
              # Set high quality rendering
              $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
              $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
              $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
              
              # Rotate the image 90 degrees clockwise
              $graphics.TranslateTransform($imageHeight / 2, $imageWidth / 2)
              $graphics.RotateTransform(90)
              $graphics.TranslateTransform(-$imageWidth / 2, -$imageHeight / 2)
              
              # Draw the rotated image
              $graphics.DrawImage($image, 0, 0, $imageWidth, $imageHeight)
              $graphics.Dispose()
              
              # Update dimensions for the rotated image
              $finalImageWidth = $imageHeight
              $finalImageHeight = $imageWidth
            }
            
            # Calculate scaling as before
            $scaleX = $pageWidth / $finalImageWidth
            $scaleY = $pageHeight / $finalImageHeight
            if ($pageIsLandscape -ne $imageIsLandscape) {
              $scale = [Math]::Min($scaleX, $scaleY)
            } else {
              $scale = [Math]::Max($scaleX, $scaleY)
            }
            
            $newWidth = [int]($finalImageWidth * $scale)
            $newHeight = [int]($finalImageHeight * $scale)
            
            # Center the image on the page
            $x = ($pageWidth - $newWidth) / 2
            $y = ($pageHeight - $newHeight) / 2
            
            $destRect = New-Object System.Drawing.Rectangle $x, $y, $newWidth, $newHeight
            $e.Graphics.DrawImage($rotatedImage, $destRect)
            
            if ($rotatedImage -ne $image) { $rotatedImage.Dispose() }
          }
          
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
  ], { timeout: 30_000 });
}

async function printWithAdvancedWindowsAPI(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  // Deprecated: This method had issues with printer preferences
  // Now using printWithDotNetPrinting as the primary method
  throw new Error("Advanced Windows API method deprecated - using .NET printing instead");
}

async function printWithPowerShell(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  for (let i = 0; i < copies; i++) {
    let powershellCommand = `Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait`;
    // Note: PowerShell Start-Process does not support specifying a printer directly
    // The print dialog will use the default printer, or the user must set the default printer
    // If you want to force a printer, you must set it as default before printing
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      powershellCommand
    ], { timeout: 30_000 });
  }
}

async function printWithImageView(filePath: string, copies: number, printerName?: string, paperSize?: { widthInch: number; heightInch: number }): Promise<void> {
  // Legacy method using Windows Image and Fax Viewer
  const dllEntry = `${process.env.SystemRoot}\\System32\\shimgvw.dll,ImageView_PrintTo`;
  for (let i = 0; i < copies; i++) {
    const args = [dllEntry, filePath];
    if (printerName && printerName.trim().length > 0) {
      args.push(printerName);
    }
    await execFileAsync("rundll32.exe", args, { timeout: 30_000 });
  }
}

function isImageFile(filePath: string): boolean {
  return /\.(png|jpg|jpeg|bmp|gif)$/i.test(filePath);
}

export async function detectDefaultPrinter(): Promise<string | undefined> {
  const isWindows = platform === "win32";
  try {
    if (isWindows) {
      // Force UTF-8 output so Unicode printer names (e.g. Hebrew) are preserved
      const psScriptDefaultPrinter = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name`;
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          psScriptDefaultPrinter,
        ],
        {
          timeout: 10_000,
          encoding: "utf8",
        }
      );
      return stdout.trim() || undefined;
    } else {
      const { stdout } = await execFileAsync("lpstat", ["-d"], { timeout: 10_000 });
      const match = stdout.match(/system default destination:\s+(\S+)/);
      return match ? match[1] : undefined;
    }
  } catch {
    return undefined;
  }
}

// New function to get all available printers
export async function getAvailablePrinters(): Promise<string[]> {
  const isWindows = platform === "win32";
  try {
    if (isWindows) {
      // Force UTF-8 output so Unicode printer names are preserved
      const psScriptAllPrinters = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Printer).Name`;
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          psScriptAllPrinters,
        ],
        {
          timeout: 10_000,
          encoding: "utf8",
        }
      );
      return stdout.trim().split(/\r?\n/).filter(name => name.trim().length > 0);
    } else {
      const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 10_000 });
      const printers = stdout.match(/printer\s+(\S+)/g) || [];
      return printers.map(match => match.replace(/printer\s+/, ''));
    }
  } catch {
    return [];
  }
}

// New function to get printer's current page size settings
export async function getPrinterPageSize(printerName?: string): Promise<{ 
  widthInch: number; 
  heightInch: number; 
  name: string;
  actualPaperSize?: { widthInch: number; heightInch: number; name: string };
  printableArea?: { widthInch: number; heightInch: number };
  isCustom?: boolean;
} | null> {
  const isWindows = platform === "win32";
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

      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy", "Bypass",
          "-Command",
          psScriptPageSize,
        ],
        {
          timeout: 10_000,
          encoding: "utf8",
        }
      );

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
    } else {
      // For non-Windows systems, try to get page size from CUPS
      const targetPrinter = printerName || await detectDefaultPrinter();
      if (!targetPrinter) {
        return null;
      }

      try {
        const { stdout } = await execFileAsync("lpoptions", ["-p", targetPrinter], { timeout: 10_000 });
        const mediaMatch = stdout.match(/media=([^\\s]+)/);
        if (mediaMatch) {
          const mediaSize = mediaMatch[1];
          // Common CUPS media sizes mapping
          const sizeMap: { [key: string]: { widthInch: number; heightInch: number; name: string } } = {
            "4x6": { widthInch: 4, heightInch: 6, name: "4x6 Photo" },
            "5x7": { widthInch: 5, heightInch: 7, name: "5x7 Photo" },
            "6x4": { widthInch: 6, heightInch: 4, name: "6x4 Photo" },
            "letter": { widthInch: 8.5, heightInch: 11, name: "Letter" },
            "a4": { widthInch: 8.27, heightInch: 11.69, name: "A4" },
            "legal": { widthInch: 8.5, heightInch: 14, name: "Legal" }
          };
          
          return sizeMap[mediaSize] || { widthInch: 0, heightInch: 0, name: mediaSize };
        }
      } catch {
        // Fallback to default size if CUPS query fails
        return { widthInch: 4, heightInch: 6, name: "Default Photo Size" };
      }
      
      // If we get here, return a default size
      return { widthInch: 4, heightInch: 6, name: "Default Photo Size" };
    }
  } catch (error) {
    console.error("Failed to get printer page size:", error);
    return null;
  }
} 

async function downloadWatermark(dest: string): Promise<void> {
  const url = "https://raw.githubusercontent.com/alive-pic/photobooth-lan-print-server/main/src/public/images/watermark.jpg";
  await new Promise<void>((resolve, reject) => {
    https.get(url, (res) => {
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