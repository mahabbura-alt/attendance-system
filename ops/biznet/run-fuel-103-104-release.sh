#!/usr/bin/env sh
# Migrasi 103 (bukti foto Fuel) + 104 (APK OMOS Fuel: ID scan, akun PIN, perangkat, sesi shift):
# preflight → backup terverifikasi → migrasi → verifikasi. Aditif & idempoten; aman untuk kode lama.
# Pemakaian: sh ops/biznet/run-fuel-103-104-release.sh <RELEASE_DIR> [ENV_FILE] [BACKUP_ROOT]
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-fuel-103-104.dump"
SQL103="$RELEASE_DIR/backend/migrations/103_fuel_evidence.sql"
SQL104="$RELEASE_DIR/backend/migrations/104_fuel_mobile.sql"

test -r "$ENV_FILE"
test -r "$SQL103"
test -r "$SQL104"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[fuel-103-104] preflight (db; 1 = fuel_inventory_transactions; 1 = fuel_stock_opnames; 0/1 = fuel_attachments; 0/1 = fuel_devices)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT current_database();
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_inventory_transactions\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_stock_opnames\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_attachments\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_devices\$\$;"'

echo "[fuel-103-104] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-fuel-103-104.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-fuel-103-104.dump" >/dev/null
echo "[fuel-103-104] backup verified $BACKUP_FILE"

echo "[fuel-103-104] migrate 103"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL103:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[fuel-103-104] migrate 104"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL104:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[fuel-103-104] verify (harap: 1,1,1,1,1, slot>=11, equipment tanpa scan_id = 0, lokasi tanpa scan_id = 0)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_attachments\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_evidence_slots\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_devices\$\$;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_shift_sessions\$\$;
    SELECT count(*) FROM fuel_mobile_settings;
    SELECT count(*) FROM fuel_evidence_slots;
    SELECT count(*) FROM equipment WHERE scan_id IS NULL;
    SELECT count(*) FROM fuel_storage_locations WHERE scan_id IS NULL;"'

echo "[fuel-103-104] done backup=$BACKUP_FILE (rollback: 104_fuel_mobile_down.sql lalu 103_fuel_evidence_down.sql)"
