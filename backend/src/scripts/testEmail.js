require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

transporter.sendMail({
  from: process.env.SMTP_FROM,
  to: process.env.SMTP_USER,
  subject: '[TEST] Konfigurasi Email Absensi Karyawan',
  text: 'Email tes berhasil! Konfigurasi SMTP untuk fitur Lupa Password sudah berjalan dengan benar. Token reset 6 digit akan dikirim ke email karyawan.',
  html: `
    <div style="font-family:sans-serif;max-width:480px;padding:24px;border:1px solid #e0e0e0;border-radius:8px;">
      <h2 style="color:#1a1a2e">Konfigurasi Email Berhasil!</h2>
      <p>SMTP untuk fitur <b>Lupa Password</b> sudah berjalan dengan benar.</p>
      <div style="background:#f4f4f8;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
        <p style="margin:0 0 8px;color:#666">Contoh token reset password</p>
        <code style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1a1a2e">482931</code>
        <p style="color:#999;font-size:12px;margin:8px 0 0">Berlaku 60 menit</p>
      </div>
      <p style="color:#999;font-size:12px;">Email ini dikirim otomatis dari sistem absensi karyawan.</p>
    </div>
  `,
}, (err, info) => {
  if (err) {
    console.log('GAGAL kirim email:', err.message);
    process.exit(1);
  } else {
    console.log('Email tes berhasil terkirim!');
    console.log('Message ID:', info.messageId);
    console.log('Cek inbox / spam di:', process.env.SMTP_USER);
  }
});
