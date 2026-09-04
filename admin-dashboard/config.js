// Konfigurasi URL API Backend untuk Admin Dashboard (Server Lokal)
const API_BASE_URL = window.__ATTENDANCE_CONFIG__?.apiBaseUrl || (
  window.location.protocol === 'file:' || window.location.port === '8080' || window.location.port === '5500'
    ? 'http://' + (window.location.hostname || 'localhost') + ':3000'
    : window.location.origin
);
