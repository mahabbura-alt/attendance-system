#!/usr/bin/env sh
set -eu

MIGRATION_FILE="${1:?migration SQL path is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-cuti-070.dump"

test -r "$MIGRATION_FILE"
test -r "$ENV_FILE"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[cuti-070] preflight"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(); SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$; SELECT COALESCE(to_regclass(\$\$public.employee_leave_requests\$\$)::text,\$\$missing\$\$);"'

echo "[cuti-070] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-cuti-070.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-cuti-070.dump" >/dev/null

echo "[cuti-070] migrate"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$MIGRATION_FILE:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[cuti-070] verify"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.tables
      WHERE table_schema=\$\$public\$\$ AND table_name IN (
        \$\$leave_policy_versions\$\$,\$\$employee_leave_entitlements\$\$,
        \$\$employee_leave_requests\$\$,\$\$employee_leave_realisations\$\$,
        \$\$employee_leave_projections\$\$,\$\$leave_roster_reconciliation\$\$,
        \$\$leave_audit_log\$\$,\$\$leave_roster_snapshots\$\$);
    SELECT count(*) FROM information_schema.columns
      WHERE table_schema=\$\$public\$\$ AND table_name=\$\$employee_roster_daily\$\$
        AND column_name IN (\$\$leave_request_id\$\$,\$\$leave_realisation_id\$\$);
    SELECT count(*) FROM information_schema.columns
      WHERE table_schema=\$\$public\$\$ AND table_name=\$\$employee_leave_realisations\$\$
        AND column_name=\$\$counting_status\$\$;
    SELECT count(*) FROM information_schema.columns
      WHERE table_schema=\$\$public\$\$ AND table_name=\$\$employee_leave_requests\$\$
        AND column_name=\$\$cycle_no\$\$;"'

echo "[cuti-070] backup=$BACKUP_FILE"
