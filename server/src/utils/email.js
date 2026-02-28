/**
 * Send password reset link by email.
 *
 * Priority:
 *   1. Resend API  — set RESEND_API_KEY in server/.env  (recommended for production)
 *   2. SMTP        — set SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM  (e.g. Gmail)
 *
 * See server/EMAIL_SETUP.md for setup instructions.
 *
 * NOTE — env vars are read lazily (via helpers) so that hot-reloads and
 * late dotenv calls always pick up the latest values.
 */

const nodemailer = require('nodemailer');

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

function isResendConfigured() {
  return Boolean(getResendApiKey());
}

function isSmtpConfigured() {
  return Boolean(getSmtpHost() && getSmtpUser() && getSmtpPass());
}

function isEmailConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

/**
 * Call once at server startup to log which email provider is active.
 */
function logEmailStatus() {
  if (isResendConfigured()) {
    console.log(`📧 Password reset: emails will be sent via Resend API (from: ${getResendFrom()}).`);
  } else if (isSmtpConfigured()) {
    console.log(`📧 Password reset: emails will be sent via SMTP (${getSmtpHost()}:${getSmtpPort()}).`);
  } else {
    console.log('📧 Password reset: ⚠️  no email provider configured! Add RESEND_API_KEY or SMTP_* vars to server/.env (see server/EMAIL_SETUP.md).');
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

  // Use fetch-based HTTP call directly — avoids SDK version mismatches and
  // gives us full control over error handling.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject,
      html,
      text,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = body?.message || body?.error || JSON.stringify(body);
    console.error('[Email/Resend] API error:', res.status, msg);
    throw new Error(`Resend API ${res.status}: ${msg}`);
  }

  console.log('[Email/Resend] ✅ Password reset sent to', toEmail, '| id:', body.id);
}

/**
 * Send password reset email via SMTP (nodemailer).
 * Includes a connection timeout and one automatic retry so transient
 * cloud-provider hiccups (e.g. Render cold-start DNS) don't break it.
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

  console.log(`[Email/SMTP] Sending to ${toEmail} via ${host}:${port} (user: ${user})`);

  const createTransporter = (pass) =>
    nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
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
 * Uses Resend if RESEND_API_KEY is set, otherwise falls back to SMTP.
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

  if (isResendConfigured()) {
    try {
      await sendViaResend(toEmail, subject, text, html);
      return; // success
    } catch (err) {
      errors.push(`Resend: ${err.message}`);
      console.error('[Email] Resend failed, will try SMTP fallback if configured:', err.message);
    }
  }

  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp(toEmail, subject, text, html);
      return; // success
    } catch (err) {
      errors.push(`SMTP: ${err.message}`);
      console.error('[Email] SMTP failed:', err.message);
    }
  }

  if (!isResendConfigured() && !isSmtpConfigured()) {
    throw new Error(
      'No email provider configured. Set RESEND_API_KEY (easiest) or SMTP_HOST/SMTP_USER/SMTP_PASS in server/.env (see server/EMAIL_SETUP.md).'
    );
  }

  // Both providers were tried and failed
  throw new Error(`All email providers failed — ${errors.join(' | ')}`);
}

module.exports = {
  sendPasswordResetEmail,
  isEmailConfigured,
  isSmtpConfigured,
  isResendConfigured,
  logEmailStatus,
  getResetLink: (token) => `${getFrontendUrl().replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`,
};
