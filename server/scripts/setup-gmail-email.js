#!/usr/bin/env node
/**
 * Gmail OAuth2 Setup Script for CryptoAlerts Email Sending
 * =========================================================
 *
 * This script helps you set up Gmail REST API as your email provider.
 * It uses HTTPS (port 443) so it works on Render/Railway/any cloud host
 * that blocks SMTP ports. Emails are sent FROM Gmail's own infrastructure,
 * giving 100% deliverability.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Select your project (the one with your GOOGLE_CLIENT_ID)
 *   3. Click on your OAuth 2.0 Client ID → note down the "Client secret"
 *   4. Under "Authorized redirect URIs" → Add: http://localhost:3000/oauth2callback
 *   5. Go to https://console.cloud.google.com/apis/library/gmail.googleapis.com
 *      and click "Enable" to enable the Gmail API
 *   6. If your app is in "Testing" publishing status, add your Gmail address
 *      (e.g. defensivelox@gmail.com) as a test user under OAuth consent screen
 *
 * Usage:
 *   node server/scripts/setup-gmail-email.js
 *
 * Then follow the prompts. At the end you get 3 env vars to add to Render.
 */

const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const readline = require('readline');

const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = 'https://www.googleapis.com/auth/gmail.send';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Gmail REST API Setup for CryptoAlerts Email          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('This will give you the env vars needed to send password reset');
  console.log('emails via Gmail REST API (HTTPS, works on Render/Railway).');
  console.log('');

  const clientId = (await ask('Enter GOOGLE_CLIENT_ID (from Google Cloud Console): ')).trim();
  if (!clientId) { console.error('Client ID is required.'); process.exit(1); }

  const clientSecret = (await ask('Enter GOOGLE_CLIENT_SECRET (from same OAuth2 credentials page): ')).trim();
  if (!clientSecret) { console.error('Client Secret is required.'); process.exit(1); }

  const gmailUser = (await ask('Enter GMAIL_USER (the Gmail address to send from, e.g. defensivelox@gmail.com): ')).trim();
  if (!gmailUser) { console.error('Gmail user is required.'); process.exit(1); }

  // Build the authorization URL
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: gmailUser,
  }).toString();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Open this URL in your browser and authorize the app:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log(`Waiting for redirect on http://localhost:${REDIRECT_PORT}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Start local server to capture the callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === '/oauth2callback') {
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>Close this tab and try again.</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>✅ Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>');
          server.close();
          resolve(authCode);
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(REDIRECT_PORT, () => {
      // Try to open browser automatically
      const { exec } = require('child_process');
      const os = require('os');
      const platform = os.platform();
      const cmd = platform === 'win32' ? `start "" "${authUrl}"` :
                  platform === 'darwin' ? `open "${authUrl}"` :
                  `xdg-open "${authUrl}"`;
      exec(cmd, () => {}); // Ignore errors — user can open manually
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is already in use. Stop whatever is running on that port and try again.`));
      } else {
        reject(err);
      }
    });
  });

  console.log('');
  console.log('Authorization code received! Exchanging for tokens...');

  // Exchange code for tokens
  const tokenData = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  const tokens = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenData),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Token exchange error: ${parsed.error_description || parsed.error}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid token response: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(tokenData);
    req.end();
  });

  if (!tokens.refresh_token) {
    console.error('');
    console.error('⚠️  No refresh_token received! This can happen if you already authorized');
    console.error('this app before. Go to https://myaccount.google.com/permissions,');
    console.error('remove the app, and run this script again.');
    process.exit(1);
  }

  // Test sending
  console.log('');
  console.log('Testing token by sending a test email to', gmailUser, '...');

  try {
    const accessToken = tokens.access_token;
    const boundary = 'test_boundary_' + Date.now();
    const rawMsg = [
      `From: CryptoAlerts <${gmailUser}>`,
      `To: ${gmailUser}`,
      `Subject: =?UTF-8?B?${Buffer.from('CryptoAlerts Gmail API Setup - Success!').toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: text/plain; charset=UTF-8`,
      '',
      'If you received this email, the Gmail REST API is working correctly!',
      '',
      'Add the environment variables shown in the terminal to your Render dashboard.',
    ].join('\r\n');
    const raw = Buffer.from(rawMsg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = JSON.stringify({ raw });

    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'gmail.googleapis.com',
          path: '/gmail/v1/users/me/messages/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Gmail API ${res.statusCode}: ${data}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    console.log('✅ Test email sent successfully! Check your inbox at', gmailUser);
  } catch (err) {
    console.log('⚠️  Test email failed:', err.message);
    console.log('The tokens are still valid — you may need to enable the Gmail API first.');
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SETUP COMPLETE!                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Add these environment variables to your Render dashboard');
  console.log('(https://dashboard.render.com → your service → Environment):');
  console.log('');
  console.log('┌──────────────────────────────────────────────────────────────');
  console.log(`│ GMAIL_CLIENT_ID=${clientId}`);
  console.log(`│ GMAIL_CLIENT_SECRET=${clientSecret}`);
  console.log(`│ GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`│ GMAIL_USER=${gmailUser}`);
  console.log('└──────────────────────────────────────────────────────────────');
  console.log('');
  console.log('After adding these vars, Render will auto-deploy and Gmail API');
  console.log('becomes the #1 email provider. Password reset emails will be');
  console.log('sent from Gmail\'s own servers with 100% deliverability.');
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
