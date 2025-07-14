# Printer Selection Functionality

This document describes the printer selection functionality that has been implemented in both the photobooth app and the LAN print server.

## Overview

The printer selection feature allows users to:
1. Discover all available printers on the LAN print server
2. Select a specific printer for printing
3. Save their printer preference for future use
4. Refresh the printer list to detect newly added printers

## Implementation Details

### LAN Print Server (`photobooth-lan-print-server`)

#### New Endpoints

1. **GET `/printers`** - Get available printers
   ```json
   {
     "defaultPrinter": "HP LaserJet Pro",
     "availablePrinters": ["HP LaserJet Pro", "Canon PIXMA", "DNP DS-RX1"],
     "timestamp": "2024-01-15T10:30:00.000Z"
   }
   ```

2. **GET `/printers/refresh`** - Refresh the printer list
   ```json
   {
     "defaultPrinter": "HP LaserJet Pro",
     "availablePrinters": ["HP LaserJet Pro", "Canon PIXMA", "DNP DS-RX1"],
     "timestamp": "2024-01-15T10:30:00.000Z",
     "success": true
   }
   ```

3. **Enhanced POST `/print`** - Now accepts `targetPrinter` parameter
   ```json
   {
     "copies": 1,
     "mimeType": "image/png",
     "data": "base64_image_data",
     "targetPrinter": "HP LaserJet Pro"  // Optional - uses default if not specified
   }
   ```

#### Printer Discovery

The server automatically discovers printers using:
- **Windows**: PowerShell `Get-CimInstance Win32_Printer`
- **macOS/Linux**: `lpstat -p` command

#### Default Printer Detection

The server detects the default printer using:
- **Windows**: PowerShell `Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }`
- **macOS/Linux**: `lpstat -d` command

### Photobooth App (`photobooth`)

#### New Components

1. **`PrinterSelector`** (`components/PrinterSelector.tsx`)
   - Modal-based printer selection interface
   - Shows available printers with default printer indicator
   - Refresh functionality to update printer list
   - Handles connection errors gracefully

2. **`usePrinterSelection`** (`hooks/usePrinterSelection.ts`)
   - Manages printer selection state
   - Persists selected printer in AsyncStorage
   - Automatically loads available printers when server connects
   - Provides printer selection and refresh functions

#### Enhanced Print Service

The print service has been enhanced with:

1. **`getLANPrinters()`** - Fetch available printers from server
2. **`refreshLANPrinters()`** - Refresh printer list from server
3. **Enhanced `printViaLANServer()`** - Now accepts `targetPrinter` parameter
4. **Enhanced `handleTestPrint()`** - Uses selected printer for printing

#### Integration Points

1. **Main Settings** - Printer selector appears in the Print Settings section
2. **Template Editor** - Selected printer is used when test printing templates
3. **Automatic Fallback** - Uses default printer if no specific printer is selected

## Usage

### For Users

1. **Selecting a Printer**:
   - Go to Settings → Print Settings
   - Tap the printer selector (shows "Select printer" or current selection)
   - Choose from the list of available printers
   - The selection is saved automatically and used for all print jobs

2. **Refreshing Printers**:
   - Open the printer selector in Settings
   - Tap the refresh button to scan for new printers

3. **Printing**:
   - The selected printer will be used for all print jobs across the app
   - If no printer is selected, the default printer is used

### For Developers

#### Adding Printer Selection to New Components

```typescript
import { usePrinterSelection } from '@/hooks/usePrinterSelection';
import PrinterSelector from '@/components/PrinterSelector';

function MyComponent() {
  const { selectedPrinter, selectPrinter, serverConnected } = usePrinterSelection();
  
  return (
    <PrinterSelector
      selectedPrinter={selectedPrinter}
      onPrinterSelect={selectPrinter}
      disabled={!serverConnected}
    />
  );
}
```

#### Using Selected Printer in Print Functions

```typescript
import { usePrinterSelection } from '@/hooks/usePrinterSelection';
import printService from '@/services/print/printService';

function MyPrintComponent() {
  const { selectedPrinter } = usePrinterSelection();
  
  const handlePrint = async () => {
    await printService.handleTestPrint(templateRef, templateData, {
      targetPrinter: selectedPrinter, // Use selected printer
    });
  };
}
```

## Testing

### LAN Print Server Testing

Run the test script to verify printer selection functionality:

```bash
cd photobooth-lan-print-server
node test-printer-selection.js
```

The test script will:
1. Test the `/printers` endpoint
2. Test the `/printers/refresh` endpoint
3. Test printing with a specific printer
4. Test printing with the default printer

### Manual Testing

1. **Start the LAN print server**:
   ```bash
   cd photobooth-lan-print-server
   npm start
   ```

2. **Open the photobooth app** and go to Settings

3. **Test printer selection**:
   - Go to Settings → Print Settings
   - Tap the printer selector
   - Verify available printers are listed
   - Select a different printer
   - Test printing from a template to verify the selected printer is used

## Error Handling

### Connection Issues
- If no print server is found, the printer selector shows "No print server found"
- Connection errors are displayed with helpful messages

### Printer Issues
- If a selected printer is no longer available, the system falls back to the default printer
- Print failures include troubleshooting suggestions

### Network Issues
- The app automatically retries printer discovery
- Health checks ensure the print server is still available

## Future Enhancements

1. **Printer Status Monitoring** - Show online/offline status of printers
2. **Printer Capabilities** - Display supported paper sizes and print quality
3. **Printer Groups** - Organize printers by location or type
4. **Print Queue Management** - View and manage print jobs
5. **Printer Settings** - Configure printer-specific settings (paper size, quality, etc.)

## Troubleshooting

### Common Issues

1. **No printers found**:
   - Ensure the print server is running
   - Check that the device and server are on the same network
   - Verify printer drivers are installed on the server

2. **Printer selection not working**:
   - Check the server logs for errors
   - Verify the printer name matches exactly
   - Try refreshing the printer list

3. **Print jobs failing**:
   - Check printer is online and has paper
   - Verify printer drivers are up to date
   - Check Windows print spooler service

### Debug Information

The LAN print server provides detailed logging:
- Printer discovery results
- Print job details
- Error messages with troubleshooting suggestions

## API Reference

### LAN Print Server Endpoints

| Endpoint | Method | Description | Parameters |
|----------|--------|-------------|------------|
| `/printers` | GET | Get available printers | None |
| `/printers/refresh` | GET | Refresh printer list | None |
| `/print` | POST | Print with optional target printer | `targetPrinter` (optional) |

### Print Service Functions

| Function | Description | Parameters |
|----------|-------------|------------|
| `getLANPrinters()` | Get printers from server | `serverUrl` |
| `refreshLANPrinters()` | Refresh printer list | `serverUrl` |
| `printViaLANServer()` | Print via LAN server | `templateRef`, `template`, `copies`, `serverUrl`, `targetPrinter` |

### Hook Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `usePrinterSelection()` | Manage printer selection | `{ selectedPrinter, selectPrinter, serverConnected, ... }` | 