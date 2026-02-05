import nodemailer from 'nodemailer';

export function createTransport() {
  if (process.env.EMAIL_MODE === 'console') {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

export async function sendDownloadEmail({ to, subject, html, text }) {
  if (process.env.EMAIL_MODE === 'console') {
    console.log('EMAIL_MODE=console');
    console.log('TO:', to);
    console.log('SUBJECT:', subject);
    console.log('TEXT:', text);
    return;
  }

  const transporter = createTransport();
  if (!transporter) return;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html
  });
}
