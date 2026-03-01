const https = require('https');
const fs = require('fs');
const email = process.argv[2] || 'decloxskwix@gmail.com';
const body = JSON.stringify({ email });
const opts = {
  hostname: 'cryptosite-rud8.onrender.com',
  path: '/api/auth/forgot-password',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
};
const req = https.request(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const out = 'STATUS:' + res.statusCode + '\nBODY:' + d;
    console.log(out);
    fs.writeFileSync('C:/Users/admin/Desktop/prodtest.txt', out);
  });
});
req.on('error', e => { const out = 'ERROR:' + e.message; console.log(out); fs.writeFileSync('C:/Users/admin/Desktop/prodtest.txt', out); });
req.write(body);
req.end();
