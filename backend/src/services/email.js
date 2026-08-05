/**
 * Email service menggunakan Nodemailer
 * Dipakai untuk: reset password
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Kirim email reset password
 * @param {string} toEmail - alamat email tujuan
 * @param {string} namaUser - nama karyawan
 * @param {string} token - token reset (satu pakai, berlaku 1 jam)
 */
async function kirimEmailResetPassword(toEmail, namaUser, token) {
  const expiresMenit = process.env.RESET_TOKEN_EXPIRES_MINUTES || 60;
  const from = process.env.SMTP_FROM || `"Absensi Karyawan" <${process.env.SMTP_USER}>`;

  await getTransporter().sendMail({
    from,
    to: toEmail,
    subject: 'Reset Password — Aplikasi Absensi Karyawan',
    text: [
      `Halo ${namaUser},`,
      '',
      'Kami menerima permintaan reset password untuk akun Anda.',
      '',
      `Token reset password Anda: ${token}`,
      '',
      `Token ini berlaku selama ${expiresMenit} menit.`,
      'Masukkan token ini di aplikasi pada layar "Reset Password".',
      '',
      'Jika Anda tidak merasa meminta reset password, abaikan email ini.',
      'Password Anda tidak akan berubah.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Reset Password</h2>
        <p style="color: #555;">Halo <strong>${namaUser}</strong>,</p>
        <p style="color: #555;">Kami menerima permintaan reset password untuk akun Anda.</p>
        <div style="background: #f4f4f8; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
          <p style="color: #666; margin: 0 0 8px;">Token Reset Password</p>
          <code style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #1a1a2e;">${token}</code>
          <p style="color: #999; font-size: 12px; margin: 8px 0 0;">Berlaku selama <strong>${expiresMenit} menit</strong></p>
        </div>
        <p style="color: #555;">Masukkan token ini di aplikasi pada layar <em>Reset Password</em>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Jika Anda tidak merasa meminta reset password, abaikan email ini. Password Anda tidak akan berubah.</p>
      </div>
    `,
  });
}

module.exports = { kirimEmailResetPassword };
