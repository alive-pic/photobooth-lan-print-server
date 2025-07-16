import { platform } from "process";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, dirname } from "path";

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
  
  // Determine which file to print based on access level
  const fileToPrint = hasAccess ? filePath : join(dirname(__dirname), "src", "public", "images", "watermark.jpg");
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
          
          # Use the full page bounds (not margin bounds) to fill entire printable area
          # This ensures the image uses the full paper size as configured in printer preferences
          $pageWidth = $e.PageBounds.Width
          $pageHeight = $e.PageBounds.Height
          $imageWidth = $image.Width
          $imageHeight = $image.Height
          
          # Determine if we need to rotate the image to match the page orientation
          $pageIsLandscape = $pageWidth -gt $pageHeight
          $imageIsLandscape = $imageWidth -gt $imageHeight
          
          $rotatedImage = $image
          $finalImageWidth = $imageWidth
          $finalImageHeight = $imageHeight
          
          # If orientations don't match, rotate the image 90 degrees
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
          
          # Calculate scaling to fill the entire page while maintaining aspect ratio
          $scaleX = $pageWidth / $finalImageWidth
          $scaleY = $pageHeight / $finalImageHeight
          
          # Use the larger scale to fill the page (may crop slightly if aspect ratios don't match)
          # This ensures the image fills the entire printable area
          $scale = [Math]::Max($scaleX, $scaleY)
          
          $newWidth = [int]($finalImageWidth * $scale)
          $newHeight = [int]($finalImageHeight * $scale)
          
          # Center the image on the page
          $x = ($pageWidth - $newWidth) / 2
          $y = ($pageHeight - $newHeight) / 2
          
          # Draw the image to fill the entire page
          $destRect = New-Object System.Drawing.Rectangle $x, $y, $newWidth, $newHeight
          $e.Graphics.DrawImage($rotatedImage, $destRect)
          
          # Clean up rotated image if we created one
          if ($rotatedImage -ne $image) {
            $rotatedImage.Dispose()
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
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name",
        ],
        { timeout: 10_000 }
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
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_Printer).Name",
        ],
        { timeout: 10_000 }
      );
      return stdout.trim().split('\n').filter(name => name.trim().length > 0);
    } else {
      const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 10_000 });
      const printers = stdout.match(/printer\s+(\S+)/g) || [];
      return printers.map(match => match.replace(/printer\s+/, ''));
    }
  } catch {
    return [];
  }
} 