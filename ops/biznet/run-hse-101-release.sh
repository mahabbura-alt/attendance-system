#!/usr/bin/env sh
# Migrasi 101 (OMOS Safety mobile: sync idempoten, delegator, notifikasi, Pertemuan K3, login Employee ID):
# preflight → backup terverifikasi → migrasi → verifikasi.
# Pemakaian: sh ops/biznet/run-hse-101-release.sh <RELEASE_DIR> [ENV_FILE] [BACKUP_ROOT]
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-hse-101.dump"
SQL="$RELEASE_DIR/backend/migrations/101_hse_mobile_safety.sql"

test -r "$ENV_FILE"
test -r "$SQL"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[hse-101] preflight (harus: tabel prasyarat ada; hse_department_delegators/hse_notifications belum ada)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT current_database();
    SELECT count(*) FROM unnest(ARRAY[\$\$hazard_reports\$\$,\$\$hse_actions\$\$,\$\$workforce_departments\$\$,\$\$incidents\$\$,
      \$\$hse_inspections\$\$,\$\$hse_inspection_answers\$\$,\$\$hse_p5m_events\$\$,\$\$hse_safetytalk_events\$\$,\$\$hse_locations\$\$]) t
      WHERE to_regclass(\$\$public.\$\$||t) IS NOT NULL;
    SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename IN (\$\$hse_department_delegators\$\$,\$\$hse_notifications\$\$);"'

echo "[hse-101] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-hse-101.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-hse-101.dump" >/dev/null
echo "[hse-101] backup verified $BACKUP_FILE"

echo "[hse-101] migrate"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[hse-101] verify (harap: 6 / 7 / 1)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$ AND table_name IN (
      \$\$hse_notifications\$\$,\$\$hse_department_delegators\$\$,\$\$hse_pic_requests\$\$,\$\$hse_hazard_events\$\$,
      \$\$hse_hazard_revisions\$\$,\$\$hse_meetings\$\$);
    SELECT count(*) FROM information_schema.columns WHERE table_schema=\$\$public\$\$ AND (
      (table_name=\$\$hazard_reports\$\$ AND column_name IN (\$\$client_uuid\$\$,\$\$stop_work\$\$,\$\$immediate_action\$\$))
      OR (table_name=\$\$hse_actions\$\$ AND column_name IN (\$\$due_at\$\$,\$\$escalated_at\$\$))
      OR (table_name=\$\$users\$\$ AND column_name=\$\$must_change_password\$\$)
      OR (table_name=\$\$incidents\$\$ AND column_name=\$\$client_uuid\$\$));
    SELECT count(*) FROM pg_constraint WHERE conname=\$\$hazard_reports_status_check\$\$ AND pg_get_constraintdef(oid) LIKE \$\$%CANCELLED%\$\$;"'

echo "[hse-101] done backup=$BACKUP_FILE (rollback: 101_hse_mobile_safety_down.sql)"
