/**
 * Send password reset link by email.
 *
 * Priority:
 *   1. SendGrid API — set SENDGRID_API_KEY  (free 100/day, industry standard, fast delivery)
 *   2. Brevo API    — set BREVO_API_KEY  (free 300/day, no domain needed — requires account activation)
 *   3. Mailjet API  — set MAILJET_API_KEY + MAILJET_API_SECRET  (free 200/day, instant activation)
 *   4. Resend API   — set RESEND_API_KEY  (needs verified domain to send to others)
 *   5. SMTP         — set SMTP_HOST, SMTP_USER, SMTP_PASS  (blocked on most cloud hosts)
 *
 * See server/EMAIL_SETUP.md for setup instructions.
 *
 * NOTE — env vars are read lazily (via helpers) so that hot-reloads and
 * late dotenv calls always pick up the latest values.
 */

const nodemailer = require('nodemailer');
const dns = require('dns');

// Force IPv4 DNS resolution — Render/Railway containers often cannot
// route to IPv6 endpoints (Gmail SMTP ENETUNREACH on 2607:f8b0:...).
try { dns.setDefaultResultOrder('ipv4first'); } catch { /* Node < 16.4 */ }

const EMAIL_CODE_VERSION = '2026-02-28-v8';

/* ---------- helpers that read env on every call (no stale cache) ---------- */

function getFrontendUrl() {
  return (
    process.env.FRONTEND_URL ||
    String(process.env.FRONTEND_URLS || '')
      .split(',')
      .map((o) => o.trim())
      .find(Boolean) ||
    'http://localhost:5173'
  );
}

// --- SendGrid (Twilio) ---
function getSendGridApiKey() { return process.env.SENDGRID_API_KEY; }
function getSendGridFrom() {
  return process.env.SENDGRID_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || 'CryptoAlerts <noreply@cryptoalerts.app>';
}

// --- Brevo (formerly Sendinblue) ---
function getBrevoApiKey() { return process.env.BREVO_API_KEY; }
function getBrevoFrom() {
  // Brevo requires a verified sender email (not domain). The email you
  // signed up with is auto-verified, or add more at brevo.com/senders.
  return process.env.BREVO_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@cryptoalerts.app';
}

// --- Mailjet ---
function getMailjetApiKey()    { return process.env.MAILJET_API_KEY; }
function getMailjetApiSecret() { return process.env.MAILJET_API_SECRET; }
function getMailjetFrom() {
  return process.env.MAILJET_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@cryptoalerts.app';
}

// --- Resend ---
function getResendApiKey() { return process.env.RESEND_API_KEY; }
/**
 * Resend "from" address.
 * Without domain verification, Resend only allows sending from
 * "onboarding@resend.dev".  Set RESEND_FROM to override once you
 * verify your own domain.
 */
function getResendFrom() {
  return process.env.RESEND_FROM || 'CryptoAlerts <onboarding@resend.dev>';
}

// --- SMTP (Gmail / any SMTP server) ---
function getSmtpHost()   { return process.env.SMTP_HOST; }
function getSmtpPort()   { return parseInt(process.env.SMTP_PORT || '587', 10); }
function getSmtpSecure() { return process.env.SMTP_SECURE === 'true'; }
function getSmtpUser()   { return process.env.SMTP_USER; }
function getSmtpPass()   { return process.env.SMTP_PASS; }
function getMailFrom()   { return process.env.MAIL_FROM || process.env.SMTP_USER || 'CryptoAlerts <noreply@cryptoalerts.app>'; }

function isSendGridConfigured() {
  return Boolean(getSendGridApiKey());
}

function isBrevoConfigured() {
  return Boolean(getBrevoApiKey());
}

function isMailjetConfigured() {
  return Boolean(getMailjetApiKey() && getMailjetApiSecret());
}

function isResendConfigured() {
  return Boolean(getResendApiKey());
}

function isSmtpConfigured() {
  return Boolean(getSmtpHost() && getSmtpUser() && getSmtpPass());
}

function isEmailConfigured() {
  return isSendGridConfigured() || isBrevoConfigured() || isMailjetConfigured() || isResendConfigured() || isSmtpConfigured();
}

/**
 * Call once at server startup to log which email provider is active.
 */
function logEmailStatus() {
  if (isSendGridConfigured()) {
    console.log(`📧 Password reset: emails will be sent via SendGrid API (from: ${getSendGridFrom()}).`);
  } else if (isBrevoConfigured()) {
    console.log(`📧 Password reset: emails will be sent via Brevo API (from: ${getBrevoFrom()}).`);
  } else if (isMailjetConfigured()) {
    console.log(`📧 Password reset: emails will be sent via Mailjet API (from: ${getMailjetFrom()}).`);
  } else if (isResendConfigured()) {
    console.log(`📧 Password reset: emails will be sent via Resend API (from: ${getResendFrom()}).`);
  } else if (isSmtpConfigured()) {
    console.log(`📧 Password reset: emails will be sent via SMTP (${getSmtpHost()}:${getSmtpPort()}).`);
  } else {
    console.log('📧 Password reset: ⚠️  no email provider configured! Add SENDGRID_API_KEY (recommended) or BREVO_API_KEY or MAILJET_API_KEY+MAILJET_API_SECRET or RESEND_API_KEY or SMTP_* vars to server/.env (see server/EMAIL_SETUP.md).');
  }
  console.log(`📧 Reset links will point to: ${getFrontendUrl()}`);
}

/**
 * Returns the branded HTML body for the password reset email.
 */
function buildResetEmailHtml(resetLink) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f1117;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                📈 CryptoAlerts
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;text-align:center;">
                Reset your password
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#8b8fa8;text-align:center;line-height:1.6;">
                We received a request to reset the password for your CryptoAlerts account.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <a href="${resetLink}"
                       style="display:inline-block;padding:14px 36px;background-color:#6366f1;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Set new password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <p style="margin:0 0 24px;font-size:13px;color:#8b8fa8;text-align:center;line-height:1.6;">
                This link expires in <strong style="color:#c4c7d4;">1 hour</strong>.
                If you didn't request a password reset, you can safely ignore this email — your password will not change.
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #2a2d3a;margin:24px 0;" />

              <!-- Fallback URL -->
              <p style="margin:0;font-size:12px;color:#5a5d72;text-align:center;line-height:1.6;">
                If the button doesn't work, copy and paste this URL into your browser:<br />
                <a href="${resetLink}" style="color:#6366f1;word-break:break-all;">${resetLink}</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#4a4d62;">
                © ${new Date().getFullYear()} CryptoAlerts · You are receiving this email because a password reset was requested for your account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send password reset email via SendGrid (Twilio) HTTP API.
 *
 * SendGrid free tier: 100 emails/day. Industry standard for transactional email.
 * No domain verification needed to start (single sender verification).
 * Sign up at sendgrid.com.
 */
async function sendViaSendGrid(toEmail, subject, text, html) {
  const apiKey = getSendGridApiKey();
  const fromRaw = getSendGridFrom();

  // Parse "Name <email>" format or plain email
  let senderName = 'CryptoAlerts';
  let senderEmail = fromRaw;
  const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    senderName = match[1].trim();
    senderEmail = match[2].trim();
  }

  console.log(`[Email/SendGrid] Sending to ${toEmail} from ${senderName} <${senderEmail}>`);

  const https = require('https');
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: toEmail }] }],
    from: { email: senderEmail, name: senderName },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
  });

  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.sendgrid.com',
        path: '/v3/mail/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // SendGrid returns 202 Accepted on success (empty body)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            let msg = data;
            try {
              const parsed = JSON.parse(data);
              msg = parsed?.errors?.map((e) => e.message).join('; ') || parsed?.message || data;
            } catch { /* use raw data */ }
            reject(new Error(`SendGrid API ${res.statusCode}: ${msg}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('SendGrid API request timed out')); });
    req.write(payload);
    req.end();
  });

  console.log('[Email/SendGrid] ✅ Password reset sent to', toEmail);
}

/**
 * Send password reset email via Brevo (Sendinblue) HTTP API.
 *
 * Brevo free tier: 300 emails/day, only requires a verified sender email
 * (no domain verification needed). Sign up at brevo.com.
 */
async function sendViaBrevo(toEmail, subject, text, html) {
  const apiKey = getBrevoApiKey();
  const fromRaw = getBrevoFrom();

  // Parse "Name <email>" format or plain email
  let senderName = 'CryptoAlerts';
  let senderEmail = fromRaw;
  const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    senderName = match[1].trim();
    senderEmail = match[2].trim();
  }

  console.log(`[Email/Brevo] Sending to ${toEmail} from ${senderName} <${senderEmail}>`);

  const https = require('https');
  const payload = JSON.stringify({
    sender: { name: senderName, email: senderEmail },
    to: [{ email: toEmail }],
    subject,
    htmlContent: html,
    textContent: text,
  });

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = parsed?.message || parsed?.error || data;
            reject(new Error(`Brevo API ${res.statusCode}: ${msg}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Brevo API request timed out')); });
    req.write(payload);
    req.end();
  });

  console.log('[Email/Brevo] ✅ Password reset sent to', toEmail, '| messageId:', body.messageId);
}

/**
 * Send password reset email via Mailjet HTTP API.
 *
 * Mailjet free tier: 200 emails/day, 6 000/month.
 * Only requires verified sender email — no domain verification.
 * Typically activates immediately after email verification (no manual review).
 * Sign up at mailjet.com.
 */
async function sendViaMailjet(toEmail, subject, text, html) {
  const apiKey = getMailjetApiKey();
  const apiSecret = getMailjetApiSecret();
  const fromRaw = getMailjetFrom();

  // Parse "Name <email>" format or plain email
  let senderName = 'CryptoAlerts';
  let senderEmail = fromRaw;
  const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    senderName = match[1].trim();
    senderEmail = match[2].trim();
  }

  console.log(`[Email/Mailjet] Sending to ${toEmail} from ${senderName} <${senderEmail}>`);

  const https = require('https');
  const payload = JSON.stringify({
    Messages: [
      {
        From: { Email: senderEmail, Name: senderName },
        To: [{ Email: toEmail }],
        Subject: subject,
        TextPart: text,
        HTMLPart: html,
      },
    ],
  });

  // Mailjet uses Basic auth: base64(apiKey:apiSecret)
  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mailjet.com',
        path: '/v3.1/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = parsed?.ErrorMessage || parsed?.Message || parsed?.error || data;
            reject(new Error(`Mailjet API ${res.statusCode}: ${msg}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Mailjet API request timed out')); });
    req.write(payload);
    req.end();
  });

  const msgResult = body?.Messages?.[0];
  const status = msgResult?.Status;
  if (status === 'error') {
    const errMsg = msgResult?.Errors?.map((e) => e.ErrorMessage).join('; ') || 'unknown error';
    throw new Error(`Mailjet delivery error: ${errMsg}`);
  }

  console.log('[Email/Mailjet] ✅ Password reset sent to', toEmail, '| status:', status);
}

/**
 * Send password reset email via Resend HTTP API.
 *
 * Uses RESEND_FROM env var (default: "CryptoAlerts <onboarding@resend.dev>").
 * The "onboarding@resend.dev" sender works on ALL Resend plans without
 * domain verification — it's the recommended way to get started quickly.
 */
async function sendViaResend(toEmail, subject, text, html) {
  const apiKey = getResendApiKey();
  const fromAddress = getResendFrom();

  console.log('[Email/Resend] Sending to', toEmail, 'from', fromAddress);

  // Use Node built-in https (works on Node 14+, no fetch dependency).
  const https = require('https');
  const payload = JSON.stringify({
    from: fromAddress,
    to: [toEmail],
    subject,
    html,
    text,
  });

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = parsed?.message || parsed?.error || data;
            reject(new Error(`Resend API ${res.statusCode}: ${msg}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Resend API request timed out')); });
    req.write(payload);
    req.end();
  });

  console.log('[Email/Resend] ✅ Password reset sent to', toEmail, '| id:', body.id);
}

/**
 * Resolve a hostname to an IPv4 address explicitly.
 * Falls back to the original hostname if resolution fails.
 */
async function resolveIPv4(hostname) {
  return new Promise((resolve) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) {
        console.warn(`[Email/SMTP] dns.resolve4(${hostname}) failed:`, err?.message, '— using hostname as-is');
        resolve(hostname);
      } else {
        console.log(`[Email/SMTP] Resolved ${hostname} → ${addresses[0]} (IPv4)`);
        resolve(addresses[0]);
      }
    });
  });
}

/**
 * Send password reset email via SMTP (nodemailer).
 * Explicitly resolves the SMTP host to IPv4 to avoid ENETUNREACH on
 * cloud providers (Render, Railway) that can't route to Gmail IPv6.
 */
async function sendViaSmtp(toEmail, subject, text, html) {
  const host = getSmtpHost();
  const port = getSmtpPort();
  const secure = getSmtpSecure();
  const user = getSmtpUser();
  const rawPass = getSmtpPass() || '';
  const noSpacePass = rawPass.replace(/\s+/g, '');
  const passCandidates = noSpacePass && noSpacePass !== rawPass
    ? [rawPass, noSpacePass]
    : [rawPass];
  const from = getMailFrom();

  // Resolve hostname to IPv4 IP to avoid IPv6 ENETUNREACH on Render
  const resolvedHost = await resolveIPv4(host);

  console.log(`[Email/SMTP] Sending to ${toEmail} via ${resolvedHost}:${port} (host: ${host}, user: ${user})`);

  const createTransporter = (pass) =>
    nodemailer.createTransport({
      host: resolvedHost,
      port,
      secure,
      auth: { user, pass },
      // When connecting by IP, TLS needs the real hostname for cert verification
      tls: { servername: host },
      connectionTimeout: 10_000,   // 10 s to establish TCP
      greetingTimeout: 10_000,     // 10 s for SMTP greeting
      socketTimeout: 15_000,       // 15 s per socket operation
    });

  // Attempt with one retry per password candidate
  let lastErr;
  for (const candidatePass of passCandidates) {
    const label = candidatePass === rawPass ? 'as-is' : 'without-spaces';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const transporter = createTransporter(candidatePass);
        await transporter.sendMail({ from, to: toEmail, subject, text, html });
        console.log(`[Email/SMTP] ✅ Password reset sent to ${toEmail} (${label})`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(`[Email/SMTP] Attempt ${attempt} failed (${label}):`, err.message);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  throw lastErr || new Error('SMTP send failed');
}

/**
 * Send password reset email.
 * Priority: SendGrid → Brevo → Mailjet → Resend → SMTP.
 *
 * @param {string} toEmail  - Recipient email address
 * @param {string} resetLink - Full reset URL containing the token
 * @returns {Promise<void>}
 */
async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = 'Reset your CryptoAlerts password';
  const text = [
    'You requested a password reset for your CryptoAlerts account.',
    '',
    `Reset link (valid for 1 hour): ${resetLink}`,
    '',
    "If you didn't request this, you can safely ignore this email — your password will not change.",
  ].join('\n');
  const html = buildResetEmailHtml(resetLink);

  const errors = [];

  // 1. SendGrid (industry standard, free 100/day, fast delivery)
  if (isSendGridConfigured()) {
    try {
      await sendViaSendGrid(toEmail, subject, text, html);
      return;
    } catch (err) {
      errors.push(`SendGrid: ${err.message}`);
      console.error('[Email] SendGrid failed:', err.message);
    }
  }

  // 2. Brevo (free 300/day, no domain needed — may require manual account activation)
  if (isBrevoConfigured()) {
    try {
      await sendViaBrevo(toEmail, subject, text, html);
      return;
    } catch (err) {
      errors.push(`Brevo: ${err.message}`);
      console.error('[Email] Brevo failed:', err.message);
    }
  }

  // 3. Mailjet (free 200/day, instant activation, no domain needed)
  if (isMailjetConfigured()) {
    try {
      await sendViaMailjet(toEmail, subject, text, html);
      return;
    } catch (err) {
      errors.push(`Mailjet: ${err.message}`);
      console.error('[Email] Mailjet failed:', err.message);
    }
  }

  // 4. Resend (needs verified domain to send to non-owner emails)
  if (isResendConfigured()) {
    try {
      await sendViaResend(toEmail, subject, text, html);
      return;
    } catch (err) {
      errors.push(`Resend: ${err.message}`);
      console.error('[Email] Resend failed:', err.message);
    }
  }

  // 5. SMTP (blocked on most cloud hosts — Render, Railway, etc.)
  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp(toEmail, subject, text, html);
      return;
    } catch (err) {
      errors.push(`SMTP: ${err.message}`);
      console.error('[Email] SMTP failed:', err.message);
    }
  }

  if (!isSendGridConfigured() && !isBrevoConfigured() && !isMailjetConfigured() && !isResendConfigured() && !isSmtpConfigured()) {
    throw new Error(
      'No email provider configured. Set SENDGRID_API_KEY (recommended) or BREVO_API_KEY or MAILJET_API_KEY+MAILJET_API_SECRET or RESEND_API_KEY or SMTP_* in server/.env (see server/EMAIL_SETUP.md).'
    );
  }

  throw new Error(`All email providers failed — ${errors.join(' | ')}`);
}

/**
 * Diagnostic: try each email provider independently and report results.
 */
async function debugEmailProviders(toEmail) {
  const results = {
    codeVersion: EMAIL_CODE_VERSION,
    nodeVersion: process.version,
    sendgridConfigured: isSendGridConfigured(),
    brevoConfigured: isBrevoConfigured(),
    mailjetConfigured: isMailjetConfigured(),
    resendConfigured: isResendConfigured(),
    smtpConfigured: isSmtpConfigured(),
    frontendUrl: getFrontendUrl(),
    sendgrid: null,
    brevo: null,
    mailjet: null,
    resend: null,
    smtp: null,
  };

  const subject = 'CryptoAlerts — email debug test';
  const text = 'This is a diagnostic email from CryptoAlerts debug-email endpoint.';
  const html = '<p>This is a <strong>diagnostic email</strong> from CryptoAlerts debug-email endpoint.</p>';

  if (isSendGridConfigured()) {
    try {
      await sendViaSendGrid(toEmail, subject, text, html);
      results.sendgrid = { ok: true };
    } catch (err) {
      results.sendgrid = { ok: false, error: err.message };
    }
  }

  if (isBrevoConfigured()) {
    try {
      await sendViaBrevo(toEmail, subject, text, html);
      results.brevo = { ok: true };
    } catch (err) {
      results.brevo = { ok: false, error: err.message };
    }
  }

  if (isMailjetConfigured()) {
    try {
      await sendViaMailjet(toEmail, subject, text, html);
      results.mailjet = { ok: true };
    } catch (err) {
      results.mailjet = { ok: false, error: err.message };
    }
  }

  if (isResendConfigured()) {
    try {
      await sendViaResend(toEmail, subject, text, html);
      results.resend = { ok: true };
    } catch (err) {
      results.resend = { ok: false, error: err.message };
    }
  }

  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp(toEmail, subject, text, html);
      results.smtp = { ok: true };
    } catch (err) {
      results.smtp = { ok: false, error: err.message };
    }
  }

  return results;
}

module.exports = {
  sendPasswordResetEmail,
  debugEmailProviders,
  isEmailConfigured,
  isSendGridConfigured,
  isBrevoConfigured,
  isMailjetConfigured,
  isSmtpConfigured,
  isResendConfigured,
  logEmailStatus,
  getResetLink: (token) => `${getFrontendUrl().replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`,
};
