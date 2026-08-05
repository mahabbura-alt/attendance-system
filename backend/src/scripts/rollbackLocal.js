/**
 * Automated Rollback Script: Reverts environment to Local PostgreSQL configuration
 * Usage: node src/scripts/rollbackLocal.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
const localEnvContent = `# ============================================================
# ROLLBACK ENVIRONMENT - LOCAL POSTGRESQL
# ============================================================
PORT=3000
TZ=Asia/Jakarta
CORS_ORIGINS=http://localhost:5500,http://localhost:8080,http://127.0.0.1:8080,http://192.168.1.82:8080
LOGIN_RATE_LIMIT_MAX=100

# Local PostgreSQL Configuration
DATABASE_URL=postgres://postgres:postgres@localhost:5432/attendance_db

# Security & Services
JWT_SECRET=super_secret_attendance_jwt_key_2026_antigravity_ganti_ini
JWT_EXPIRES_IN=8h
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=Absensi123!
MINIO_BUCKET=absensi-foto
MINIO_PRESIGNED_URL_EXPIRY=900
COMPREFACE_BASE_URL=http://localhost:8000
COMPREFACE_RECOGNITION_API_KEY=dev_compreface_key_123456789
FACE_MATCH_THRESHOLD=0.85
`;

try {
  fs.writeFileSync(envPath, localEnvContent, 'utf8');
  console.log('✅ [ROLLBACK OK] File .env berhasil dikembalikan ke konfigurasi PostgreSQL lokal.');
  console.log('🔄 Silakan restart backend server untuk menerapkan perubahan.');
} catch (err) {
  console.error('❌ [ROLLBACK ERROR]:', err.message);
  process.exit(1);
}
