/**
 * Debug utility for API calls
 * Use this to test API connectivity and diagnose issues
 */

export const testBinanceApi = async () => {
  const baseURL = 'http://localhost:5000/api';
  const url = `${baseURL}/market/binance/tokens?exchangeType=futures`;
  
  console.group('🔍 API Debug Test');
  console.log('Testing URL:', url);
  
  try {
    // Test 1: Direct fetch (no auth)
    console.log('\n📡 Test 1: Direct fetch (no auth headers)');
    const fetchResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('Status:', fetchResponse.status);
    console.log('Status Text:', fetchResponse.statusText);
    console.log('Headers:', Object.fromEntries(fetchResponse.headers.entries()));
    
    if (fetchResponse.ok) {
      const data = await fetchResponse.json();
      console.log('✅ Fetch Success:', {
        tokenCount: data.tokens?.length,
        exchangeType: data.exchangeType,
      });
    } else {
      const errorText = await fetchResponse.text();
      console.error('❌ Fetch Error:', errorText);
    }
    
    // Test 2: Check CORS
    console.log('\n🌐 Test 2: CORS Check');
    if (fetchResponse.headers.get('access-control-allow-origin')) {
      console.log('✅ CORS header present:', fetchResponse.headers.get('access-control-allow-origin'));
    } else {
      console.warn('⚠️ No CORS header found');
    }
    
  } catch (error) {
    console.error('❌ Test Failed:', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    
    if (error.message.includes('Failed to fetch') || error.code === 'ERR_NETWORK') {
      console.error('\n💡 Possible Issues:');
      console.error('1. Backend server not running on port 5000');
      console.error('2. CORS not configured correctly');
      console.error('3. Network/firewall blocking the request');
    }
  }
  
  console.groupEnd();
};

export const checkApiConfig = () => {
  console.group('⚙️ API Configuration Check');
  
  const expectedBaseURL = 'http://localhost:5000/api';
  const currentOrigin = window.location.origin;
  const vitePort = currentOrigin.split(':').pop();
  
  console.log('Current Origin:', currentOrigin);
  console.log('Vite Port:', vitePort);
  console.log('Expected API Base:', expectedBaseURL);
  console.log('Expected CORS Origin:', `http://localhost:${vitePort}`);
  
  console.groupEnd();
};
