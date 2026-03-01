/**
 * Test the production forgot-password endpoint.
 * Run: node test-prod-email.js
 */
const https = require('https');

const email = 'decloxskwix@gmail.com';
const body = JSON.stringify({ email });

const options = {
  hostname: 'cryptosite-rud8.onrender.com',
  path: '/api/auth/forgot-password',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

console.log('Testing production forgot-password for:', email);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    console.log('Body:', data);
    if (res.statusCode === 429) {
      console.log('\nSTILL RATE LIMITED — wait 1 hour or Render has not redeployed yet with the new code.');
    } else if (res.statusCode === 503) {
      console.log('\nEMAIL SEND FAILED on server — SMTP/Resend env vars missing or wrong on Render.');
      console.log('Check Render logs for [forgotPassword] *** EMAIL SEND FAILED *** lines.');
    } else if (res.statusCode === 200) {
      console.log('\nSUCCESS — email should be on its way (with a ~5min Gmail delay).');
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
