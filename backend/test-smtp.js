// Run with: node test-smtp.js
// Tests SMTP connection directly — no TypeScript, no backend required
const nodemailer = require('nodemailer');

const config = {
  host: 'smtpout.secureserver.net',
  port: 465,
  secure: true,
  auth: {
    type: 'LOGIN',
    user: 'sales@lyraenterprise.co.in',
    pass: 'Lyrasales@2026',   // plain password, no quotes
  },
  tls: { rejectUnauthorized: false },
};

console.log('Testing SMTP connection...');
console.log('Host:', config.host, '| Port:', config.port, '| User:', config.auth.user);

const transporter = nodemailer.createTransport(config);

transporter.verify((err, success) => {
  if (err) {
    console.error('\n❌ FAILED:', err.message);
    console.error('Full error:', err);
  } else {
    console.log('\n✅ SMTP connection verified! Credentials are correct.');
    console.log('Sending test email...');
    transporter.sendMail({
      from: '"LyraCore Sales" <sales@lyraenterprise.co.in>',
      to: 'sales@lyraenterprise.co.in',
      subject: 'SMTP Test - LyraCore',
      text: 'If you receive this, SMTP is working correctly.',
    }, (e2, info) => {
      if (e2) console.error('Send failed:', e2.message);
      else console.log('✅ Email sent! MessageId:', info.messageId);
    });
  }
});
