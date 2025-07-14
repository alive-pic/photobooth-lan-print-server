const fetch = require('node-fetch');

const SERVER_URL = 'http://localhost:4000';

async function testPrinterSelection() {
  console.log('🧪 Testing Printer Selection Functionality\n');

  try {
    // Test 1: Get available printers
    console.log('1. Testing /printers endpoint...');
    const printersResponse = await fetch(`${SERVER_URL}/printers`);
    const printersData = await printersResponse.json();
    
    console.log('✅ Available printers:', printersData.availablePrinters);
    console.log('✅ Default printer:', printersData.defaultPrinter);
    console.log('✅ Timestamp:', printersData.timestamp);
    console.log('');

    // Test 2: Refresh printers
    console.log('2. Testing /printers/refresh endpoint...');
    const refreshResponse = await fetch(`${SERVER_URL}/printers/refresh`);
    const refreshData = await refreshResponse.json();
    
    console.log('✅ Refresh successful:', refreshData.success);
    console.log('✅ Available printers after refresh:', refreshData.availablePrinters);
    console.log('✅ Default printer after refresh:', refreshData.defaultPrinter);
    console.log('');

    // Test 3: Test print with specific printer
    if (printersData.availablePrinters.length > 0) {
      const testPrinter = printersData.availablePrinters[0];
      console.log(`3. Testing print with specific printer: ${testPrinter}`);
      
      // Create a simple test image (1x1 pixel PNG)
      const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      
      const printResponse = await fetch(`${SERVER_URL}/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          copies: 1,
          mimeType: 'image/png',
          data: testImageBase64,
          targetPrinter: testPrinter,
        }),
      });
      
      const printData = await printResponse.json();
      
      if (printResponse.ok) {
        console.log('✅ Print job sent successfully');
        console.log('✅ Job ID:', printData.jobId);
        console.log('✅ Target printer:', printData.printer);
        console.log('✅ Copies:', printData.copies);
      } else {
        console.log('❌ Print job failed:', printData.error);
      }
    } else {
      console.log('⚠️  No printers available for testing');
    }

    // Test 4: Test print with default printer
    console.log('\n4. Testing print with default printer...');
    const defaultPrintResponse = await fetch(`${SERVER_URL}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        copies: 1,
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        // No targetPrinter specified - should use default
      }),
    });
    
    const defaultPrintData = await defaultPrintResponse.json();
    
    if (defaultPrintResponse.ok) {
      console.log('✅ Default print job sent successfully');
      console.log('✅ Job ID:', defaultPrintData.jobId);
      console.log('✅ Printer used:', defaultPrintData.printer);
    } else {
      console.log('❌ Default print job failed:', defaultPrintData.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testPrinterSelection(); 