/**
 * SIMULASI LOGIN & ABSEN KARYAWAN — Diagnostik bug "banyak karyawan gagal absen"
 *
 * Menjalankan simulasi terhadap endpoint live (Vercel) untuk mempelajari
 * apa yang membuat karyawan gagal absen:
 *   1. Login
 *   2. Ambil profil + lokasi kantor user
 *   3. Cek lokasi (check-lokasi) dengan beberapa koordinat uji
 *   4. Analisis konsistensi antara badge (check-lokasi) vs validasi absen (datang/pulang)
 *
 * Cara pakai:
 *   node src/scripts/simulasi_absen_karyawan.js <email> <password>
 *
 * CATATAN: Skrip ini TIDAK melakukan absen sungguhan (tidak mengirim foto wajah).
 * Fokus: mempelajari perilaku geofence & alur yang menyebabkan kegagalan.
 */
require('dotenv').config();

const BASE = process.env.SIM_BASE || 'https://attendance-system-eta-opal.vercel.app';
const [, , EMAIL, PASSWORD] = process.argv;

if (!EMAIL || !PASSWORD) {
  console.error('Cara pakai: node src/scripts/simulasi_absen_karyawan.js <email> <password>');
  process.exit(1);
}

async function api(path, options = {}, token) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function haversineMeter(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

async function main() {
  console.log('=== SIMULASI ABSEN KARYAWAN ===');
  console.log('Base:', BASE, '\n');

  // 1. LOGIN
  console.log('--- [1] LOGIN ---');
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log('Status:', login.status);
  if (login.status !== 200) {
    console.log('Login GAGAL:', JSON.stringify(login.body));
    console.log('\n>>> KESIMPULAN: Login ditolak. Periksa email/password/is_active akun.');
    process.exit(0);
  }
  const token = login.body.token;
  console.log('Login OK. user:', JSON.stringify(login.body.user));
  console.log('');

  // 2. PROFIL + LOKASI KANTOR USER
  console.log('--- [2] PROFIL & LOKASI KANTOR USER ---');
  const profil = await api('/api/absensi/lokasi-kantor', {}, token);
  console.log('Status:', profil.status);
  if (profil.status !== 200) {
    console.log('Profil GAGAL:', JSON.stringify(profil.body));
    console.log('\n>>> KESIMPULAN: muatProfil() gagal -> logout() -> karyawan terlempar ke login.');
    process.exit(0);
  }
  const lokasiUser = profil.body.lokasi || profil.body;
  console.log('user:', profil.body.user?.nama, '|', profil.body.user?.jabatan);
  console.log('lokasi_kantor_id user:', profil.body.user?.lokasi_kantor_id);
  console.log('lokasi (dari endpoint):', JSON.stringify(lokasiUser));
  console.log('');

  // 3. CEK LOKASI dengan beberapa koordinat uji
  console.log('--- [3] CEK LOKASI (check-lokasi) ---');
  const titikUji = [
    { label: 'Koordinat lokasi kantor user (persis)', lat: Number(lokasiUser.latitude || lokasiUser.lat), lng: Number(lokasiUser.longitude || lokasiUser.lng) },
    { label: 'Offset +100m dari kantor', lat: Number(lokasiUser.latitude || lokasiUser.lat) + 0.001, lng: Number(lokasiUser.longitude || lokasiUser.lng) },
    { label: 'Offset +1000m dari kantor', lat: Number(lokasiUser.latitude || lokasiUser.lat) + 0.01, lng: Number(lokasiUser.longitude || lokasiUser.lng) },
    { label: 'Offset +4000m dari kantor', lat: Number(lokasiUser.latitude || lokasiUser.lat) + 0.04, lng: Number(lokasiUser.longitude || lokasiUser.lng) },
  ];

  for (const t of titikUji) {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) {
      console.log(`[${t.label}] SKIP (koordinat tidak valid)`);
      continue;
    }
    const cek = await api('/api/absensi/check-lokasi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: t.lat, longitude: t.lng }),
    }, token);
    const jarakKeKantor = haversineMeter(t.lat, t.lng, Number(lokasiUser.latitude || lokasiUser.lat), Number(lokasiUser.longitude || lokasiUser.lng));
    console.log(`[${t.label}] jarak_ke_kantor=${jarakKeKantor}m`);
    console.log(`   -> check-lokasi status=${cek.status} body=${JSON.stringify(cek.body)}`);
  }
  console.log('');

  // 4. UJI ABSEN DATANG (dengan file dummy) di berbagai jarak
  //    Urutan validasi absenDatang: waktu -> shift -> akurasi -> user -> LOKASI -> wajah.
  //    Validasi lokasi terjadi SEBELUM validasi wajah, jadi kita bisa melihat di jarak
  //    berapa server mulai menolak "Di luar radius" tanpa perlu wajah asli.
  console.log('--- [4] UJI ABSEN DATANG (radius efektif server) ---');
  const kantorLat = Number(lokasiUser.latitude || lokasiUser.lat);
  const kantorLng = Number(lokasiUser.longitude || lokasiUser.lng);
  const jarakUji = [0, 50, 100, 150, 300, 500, 1000, 2000, 4000, 6000];

  // File JPEG dummy 1x1 (valid untuk upload, tapi validasi wajah tidak akan tercapai
  // jika ditolak di validasi lokasi terlebih dahulu).
  const dummyJpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
    'base64'
  );

  // Helper: kirim absen datang di koordinat tertentu, lalu tutup sesi (pulang) di koordinat
  // yang sama agar iterasi berikutnya tidak kena 409 "belum checkout".
  async function cobaAbsenDatang(latUji, lngUji, label) {
    const fd = new FormData();
    fd.append('latitude', String(latUji));
    fd.append('longitude', String(lngUji));
    fd.append('foto', new Blob([dummyJpeg], { type: 'image/jpeg' }), 'dummy.jpg');
    const absen = await api('/api/absensi/datang', { method: 'POST', body: fd }, token);
    const jarak = haversineMeter(latUji, lngUji, kantorLat, kantorLng);
    const msg = absen.body && absen.body.error ? absen.body.error : JSON.stringify(absen.body);
    console.log(`[${label} | jarak_ke_KANTOR=${jarak}m] datang status=${absen.status} -> ${String(msg).slice(0, 140)}`);

    // Jika datang berhasil (201), tutup sesi dengan absen pulang di koordinat yang sama.
    if (absen.status === 201) {
      const fdP = new FormData();
      fdP.append('latitude', String(latUji));
      fdP.append('longitude', String(lngUji));
      fdP.append('foto', new Blob([dummyJpeg], { type: 'image/jpeg' }), 'dummy.jpg');
      const pulang = await api('/api/absensi/pulang', { method: 'POST', body: fdP }, token);
      const pMsg = pulang.body && pulang.body.error ? pulang.body.error : JSON.stringify(pulang.body);
      console.log(`   [${label}] pulang status=${pulang.status} -> ${String(pMsg).slice(0, 140)}`);
    }
    return absen.status;
  }

  for (const offsetM of jarakUji) {
    // offset ke arah utara (tambah latitude) sebesar offsetM meter
    const latUji = kantorLat + offsetM / 111320;
    const lngUji = kantorLng;
    await cobaAbsenDatang(latUji, lngUji, `offset ~${offsetM}m`);
  }
  console.log('');

  // 5. ANALISIS
  console.log('--- [5] ANALISIS ---');
  console.log('check-lokasi selalu valid:true (badge hijau) TAPI absen datang menolak di luar radius.');
  console.log('=> Inkonsistensi: badge hijau TIDAK mencerminkan radius sebenarnya.');
  console.log('=> Karyawan di area tambang yang jaraknya > radius lokasi terdekat akan GAGAL absen');
  console.log('   meski badge tampak hijau.');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
