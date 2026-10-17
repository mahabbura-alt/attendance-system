#!/usr/bin/env sh
# Migrasi 102 (Rekomendasi Perbaikan di hazard → CAPA; status hazard otomatis dari progres CAPA):
# preflight → backup terverifikasi → migrasi → verifikasi. WAJIB dijalankan SEBELUM kode 102 aktif
# (createHazard/updateHazard menulis kolom hazard_reports.recommendation).
# Pemakaian: sh ops/biznet/run-hse-102-release.sh <RELEASE_DIR> [ENV_FILE] [BACKUP_ROOT]
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-hse-102.dump"
SQL="$RELEASE_DIR/backend/migrations/102_hse_hazard_recommendation.sql"

test -r "$ENV_FILE"
test -r "$SQL"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[hse-102] preflight (harus: db, 1 = hse_hazard_events ada (migrasi 101), 0/1 = kolom recommendation)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT current_database();
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$hse_hazard_events\$\$;
    SELECT count(*) FROM information_schema.columns WHERE table_schema=\$\$public\$\$ AND table_name=\$\$hazard_reports\$\$ AND column_name=\$\$recommendation\$\$;"'

echo "[hse-102] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-hse-102.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-hse-102.dump" >/dev/null
echo "[hse-102] backup verified $BACKUP_FILE"

echo "[hse-102] migrate"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[hse-102] verify (harap: 1, lalu jumlah hazard yang rekomendasinya terisi dari CAPA lama)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.columns WHERE table_schema=\$\$public\$\$ AND table_name=\$\$hazard_reports\$\$ AND column_name=\$\$recommendation\$\$;
    SELECT count(*) FROM hazard_reports WHERE recommendation IS NOT NULL;"'

echo "[hse-102] done backup=$BACKUP_FILE (rollback: 102_hse_hazard_recommendation_down.sql)"
