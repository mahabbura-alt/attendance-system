#!/usr/bin/env sh
# Migrasi 105 (hotfix: kolom updated_at fuel_inventory_transactions yang ditulis kode posting/reversal/void):
# preflight → backup terverifikasi → migrasi → verifikasi. Aditif & idempoten.
# Pemakaian: sh ops/biznet/run-fuel-105-hotfix.sh <RELEASE_DIR> [ENV_FILE] [BACKUP_ROOT]
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-fuel-105.dump"
SQL105="$RELEASE_DIR/backend/migrations/105_fuel_tx_updated_at.sql"

test -r "$ENV_FILE"
test -r "$SQL105"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[fuel-105] preflight (db; 1 = fuel_inventory_transactions; 0/1 = kolom updated_at)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT current_database();
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename=\$\$fuel_inventory_transactions\$\$;
    SELECT count(*) FROM information_schema.columns WHERE table_name=\$\$fuel_inventory_transactions\$\$ AND column_name=\$\$updated_at\$\$;"'

echo "[fuel-105] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-fuel-105.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-fuel-105.dump" >/dev/null
echo "[fuel-105] backup verified $BACKUP_FILE"

echo "[fuel-105] migrate 105"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL105:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[fuel-105] verify (harap: 1)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.columns WHERE table_name=\$\$fuel_inventory_transactions\$\$ AND column_name=\$\$updated_at\$\$;"'

echo "[fuel-105] done backup=$BACKUP_FILE (rollback: 105_fuel_tx_updated_at_down.sql)"
