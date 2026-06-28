const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const APP_URL = process.env.APP_URL || "https://zxk-cpm-tracker.onrender.com";

async function sendClipperCredentialsEmail({ name, email, password }) {
  const loginUrl = `${APP_URL}/login.html`;
  await transporter.sendMail({
    from: `"ZXK Network" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "You're approved — your ZXK Network clipper account",
    text:
      `Hey ${name},\n\n` +
      `You've been approved as a clipper for ZXK Network. Here's how to log in and start tracking your stats:\n\n` +
      `Login page: ${loginUrl}\n` +
      `Email: ${email}\n` +
      `Password: ${password}\n\n` +
      `See you in the dashboard,\nZXK Network`,
    html:
      `<p>Hey ${name},</p>` +
      `<p>You've been approved as a clipper for <strong>ZXK Network</strong>. Here's how to log in and start tracking your stats:</p>` +
      `<p><a href="${loginUrl}">${loginUrl}</a><br>` +
      `Email: ${email}<br>` +
      `Password: ${password}</p>` +
      `<p>See you in the dashboard,<br>ZXK Network</p>`,
  });
}

module.exports = { sendClipperCredentialsEmail };
