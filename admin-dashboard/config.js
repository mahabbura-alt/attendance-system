// Konfigurasi URL API Backend untuk Admin Dashboard
// Otomatis terhubung ke Render.com jika diakses via cloud URL, atau fallback ke backend local
const API_BASE_URL = window.__ATTENDANCE_CONFIG__?.apiBaseUrl || (
  window.location.hostname.includes('onrender.com') || window.location.hostname.includes('vercel.app')
    ? 'https://absensi-backend.onrender.com'
    : (window.location.origin.includes('8080') ? 'http://' + window.location.hostname + ':3000' : window.location.origin)
);
