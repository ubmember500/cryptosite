/**
 * Send password reset link by email.
 *
 * Priority:
 *   1. Resend API  — set RESEND_API_KEY in server/.env  (recommended for production)
 *   2. SMTP        — set SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM  (e.g. Gmail)
 *
 * See server/EMAIL_SETUP.md for setup instructions.
 */

const nodemailer = require('nodemailer');

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  String(process.env.FRONTEND_URLS || '')
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean) ||
  'http://localhost:5173';

// --- Resend ---
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// --- SMTP (Gmail / any SMTP server) ---
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'CryptoAlerts <noreply@cryptoalerts.app>';

function isResendConfigured() {
  return Boolean(RESEND_API_KEY);
}

function isSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function isEmailConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

/**
 * Call once at server startup to log which email provider is active.
 */
function logEmailStatus() {
  if (isResendConfigured()) {
    console.log('📧 Password reset: emails will be sent via Resend API.');
  } else if (isSmtpConfigured()) {
    console.log(`📧 Password reset: emails will be sent via SMTP (${SMTP_HOST}:${SMTP_PORT}).`);
  } else {
    console.log('📧 Password reset: no email provider configured. Add RESEND_API_KEY or SMTP_* vars to server/.env (see server/EMAIL_SETUP.md).');
  }
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
 * Send password reset email via Resend API.
 */
async function sendViaResend(toEmail, subject, text, html) {
  const { Resend } = require('resend');
  const resend = new Resend(RESEND_API_KEY);

  const fromAddress = MAIL_FROM.includes('@') && !MAIL_FROM.includes('<')
    ? `CryptoAlerts <${MAIL_FROM}>`
    : MAIL_FROM;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [toEmail],
    subject,
    html,
    text,
  });

  if (error) {
    console.error('[Email] Resend error:', error);
    throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
  }

  console.log('[Email] Password reset sent via Resend to', toEmail);
}

/**
 * Send password reset email via SMTP (nodemailer).
 */
async function sendViaSmtp(toEmail, subject, text, html) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject,
    text,
    html,
  });

  console.log('[Email] Password reset sent via SMTP to', toEmail);
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

  if (isResendConfigured()) {
    try {
      await sendViaResend(toEmail, subject, text, html);
      return;
    } catch (err) {
      console.error('[Email] Resend failed, will try SMTP fallback if configured:', err.message);
      if (!isSmtpConfigured()) throw err;
    }
  }

  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp(toEmail, subject, text, html);
      return;
    } catch (err) {
      console.error('[Email] SMTP failed:', err.message);
      throw err;
    }
  }

  throw new Error(
    'No email provider configured. Add RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS to server/.env (see server/EMAIL_SETUP.md).'
  );
}

module.exports = {
  sendPasswordResetEmail,
  isEmailConfigured,
  isSmtpConfigured,
  isResendConfigured,
  logEmailStatus,
  getResetLink: (token) => `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`,
};
