#!/usr/bin/env sh
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-hse-092-workhours.dump"

test -r "$ENV_FILE"
test -r "$RELEASE_DIR/backend/migrations/092_hse_workhours.sql"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[hse-092] preflight"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(); SELECT count(*) FROM pg_tables WHERE tablename LIKE \$\$hse_workhour%\$\$; SELECT to_regclass(\$\$public.hse_manhours\$\$); SELECT to_regclass(\$\$public.absensi\$\$);"'

echo "[hse-092] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-hse-092-workhours.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-hse-092-workhours.dump" >/dev/null
echo "[hse-092] backup verified $BACKUP_FILE"

echo "[hse-092] migrate 092_hse_workhours"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$RELEASE_DIR/backend/migrations/092_hse_workhours.sql:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[hse-092] verify"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.tables
      WHERE table_schema=\$\$public\$\$ AND table_name IN (
        \$\$hse_workhour_standards\$\$,\$\$hse_workhour_periods\$\$,
        \$\$hse_workhour_period_lines\$\$,\$\$hse_workhour_audit\$\$);
    SELECT count(*) FROM information_schema.columns
      WHERE table_schema=\$\$public\$\$ AND table_name=\$\$hse_manhours\$\$ AND column_name=\$\$workhour_period_id\$\$;
    SELECT count(*) FROM pg_indexes
      WHERE schemaname=\$\$public\$\$ AND indexname IN (
        \$\$idx_whs_role\$\$,\$\$idx_whs_emp\$\$,\$\$uq_whp_locked_month\$\$,
        \$\$idx_whp_scope\$\$,\$\$idx_wha_scope\$\$,
        \$\$idx_hse_manhours_workhour_period\$\$,\$\$idx_absensi_tanggal_user\$\$);
    SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$;"'

echo "[hse-092] done backup=$BACKUP_FILE"
