/**
 * Quick SMTP email test. Run from server/ directory:
 *   node test-email.js your@email.com
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

const to = process.argv[2];
if (!to) {
  console.error('Usage: node test-email.js <recipient@email.com>');
  process.exit(1);
}

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MAIL_FROM } = process.env;

console.log('--- SMTP config ---');
console.log('SMTP_HOST   :', SMTP_HOST || '(not set)');
console.log('SMTP_PORT   :', SMTP_PORT || '587');
console.log('SMTP_USER   :', SMTP_USER || '(not set)');
console.log('SMTP_PASS   :', SMTP_PASS ? `"${SMTP_PASS}" (${SMTP_PASS.length} chars, spaces: ${(SMTP_PASS.match(/ /g)||[]).length})` : '(not set)');
console.log('MAIL_FROM   :', MAIL_FROM || '(not set)');
console.log('-------------------');

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('ERROR: SMTP_HOST, SMTP_USER, SMTP_PASS must all be set in server/.env');
  process.exit(1);
}

const passNoSpaces = SMTP_PASS.replace(/ /g, '');

(async () => {
  console.log(`\nTrying SMTP auth with password as-is (${SMTP_PASS.length} chars)...`);
  const transporter1 = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    await transporter1.verify();
    console.log('✅ SMTP auth OK (with spaces)');
    await transporter1.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to,
      subject: 'CryptoAlerts — Password reset test',
      text: `This is a test email. SMTP is working correctly.\n\nReset link would look like:\nhttps://cryptosite2027.vercel.app/reset-password?token=EXAMPLE_TOKEN`,
      html: `<p>This is a <strong>test email</strong>. SMTP is working correctly.</p><p>Reset link would look like:</p><a href="https://cryptosite2027.vercel.app/reset-password?token=EXAMPLE">https://cryptosite2027.vercel.app/reset-password?token=EXAMPLE</a>`,
    });
    console.log('✅ Test email sent to', to);
  } catch (err1) {
    console.log('❌ Failed with spaces:', err1.message);

    if (passNoSpaces !== SMTP_PASS) {
      console.log(`\nRetrying without spaces (${passNoSpaces.length} chars)...`);
      const transporter2 = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || '587', 10),
        secure: SMTP_SECURE === 'true',
        auth: { user: SMTP_USER, pass: passNoSpaces },
      });
      try {
        await transporter2.verify();
        console.log('✅ SMTP auth OK (without spaces)');
        await transporter2.sendMail({
          from: MAIL_FROM || SMTP_USER,
          to,
          subject: 'CryptoAlerts — Password reset test',
          text: `This is a test email. SMTP is working correctly.\n\nReset link would look like:\nhttps://cryptosite2027.vercel.app/reset-password?token=EXAMPLE_TOKEN`,
          html: `<p>This is a <strong>test email</strong>. SMTP is working correctly.</p><p>Reset link would look like:</p><a href="https://cryptosite2027.vercel.app/reset-password?token=EXAMPLE">https://cryptosite2027.vercel.app/reset-password?token=EXAMPLE</a>`,
        });
        console.log('✅ Test email sent to', to);
        console.log('\n⚠️  Fix: Update SMTP_PASS in server/.env to remove spaces:');
        console.log(`   SMTP_PASS=${passNoSpaces}`);
      } catch (err2) {
        console.error('❌ Failed without spaces too:', err2.message);
        console.log('\n--- Troubleshooting ---');
        console.log('1. Make sure 2-Step Verification is enabled on', SMTP_USER);
        console.log('2. Generate a new App Password: Google Account → Security → App passwords');
        console.log('3. Enter the 16-char password WITHOUT spaces in SMTP_PASS');
        console.log('4. Make sure "Less secure app access" is NOT required (App Password bypasses it)');
      }
    }
  }
})();
