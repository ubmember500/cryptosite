/**
 * Send password reset link by email. Uses SMTP (e.g. Gmail).
 * Set SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM in server/.env.
 */

const nodemailer = require('nodemailer');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@cryptoalerts.local';

function isSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

/**
 * Call once at server startup.
 */
function logEmailStatus() {
  if (isSmtpConfigured()) {
    console.log(`📧 Password reset: emails will be sent to users (SMTP ${SMTP_HOST}:${SMTP_PORT}).`);
  } else {
    console.log('📧 Password reset: add Gmail SMTP to server/.env to send reset link by email (see server/EMAIL_SETUP.md).');
  }
}

/**
 * Send password reset email.
 * @param {string} toEmail - Recipient email
 * @param {string} resetLink - Full URL with token
 * @returns {Promise<void>}
 */
async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = 'Reset your CryptoAlerts password';
  const text = `You requested a password reset. Click the link below to set a new password (valid for 1 hour):\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <p>You requested a password reset.</p>
    <p><a href="${resetLink}">Reset your password</a> (link valid for 1 hour).</p>
    <p>If you didn't request this, you can ignore this email.</p>
  `;

  // 1) SMTP (e.g. Gmail) — set SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM in .env to send reset emails to users
  if (isSmtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    try {
      await transporter.sendMail({
        from: MAIL_FROM,
        to: toEmail,
        subject,
        text,
        html,
      });
      console.log('[Email] Password reset sent to', toEmail);
    } catch (err) {
      console.error('[Email] SMTP failed:', err.message);
      throw err;
    }
    return;
  }

  throw new Error('SMTP not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM to server/.env to send reset emails (see server/EMAIL_SETUP.md).');
}

module.exports = {
  sendPasswordResetEmail,
  isEmailConfigured: isSmtpConfigured,
  isSmtpConfigured,
  logEmailStatus,
  getResetLink: (token) => `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`,
};
