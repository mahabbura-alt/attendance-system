#!/usr/bin/env sh
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-hse-088-091.dump"

test -r "$ENV_FILE"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

for M in 088_hse_hazard_report_targets 089_hse_p5m_safetytalk_targets 090_hse_p5m_safetytalk_events 091_hse_inspection_attachments; do
  test -r "$RELEASE_DIR/backend/migrations/$M.sql"
done

echo "[hse-088-091] preflight"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(); SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$; SELECT to_regclass(\$\$public.hse_p5m_events\$\$); SELECT count(*) FROM hse_safety_talks;"'

echo "[hse-088-091] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-hse-088-091.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-hse-088-091.dump" >/dev/null
echo "[hse-088-091] backup verified $BACKUP_FILE"

for M in 088_hse_hazard_report_targets 089_hse_p5m_safetytalk_targets 090_hse_p5m_safetytalk_events 091_hse_inspection_attachments; do
  echo "[hse-088-091] migrate $M"
  docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
    -v "$RELEASE_DIR/backend/migrations/$M.sql:/migration.sql:ro" postgres:17-alpine \
    sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'
done

echo "[hse-088-091] verify"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.tables
      WHERE table_schema=\$\$public\$\$ AND table_name IN (
        \$\$hse_hazard_report_targets\$\$,\$\$hse_hazard_report_scopes\$\$,
        \$\$hse_p5m_targets\$\$,\$\$hse_p5m_scopes\$\$,
        \$\$hse_safetytalk_targets\$\$,\$\$hse_safetytalk_scopes\$\$,
        \$\$hse_p5m_events\$\$,\$\$hse_p5m_event_attendees\$\$,
        \$\$hse_safetytalk_events\$\$,\$\$hse_safetytalk_event_attendees\$\$);
    SELECT to_regclass(\$\$public.hse_safety_talks\$\$);
    SELECT count(*) FROM information_schema.columns
      WHERE table_name=\$\$hse_inspections\$\$ AND column_name IN (\$\$photos\$\$,\$\$documents\$\$);
    SELECT count(*) FROM pg_proc
      WHERE proname IN (\$\$hse_hazard_effective_quota\$\$,\$\$hse_p5m_effective_quota\$\$,\$\$hse_safetytalk_effective_quota\$\$);
    SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$;"'

echo "[hse-088-091] done backup=$BACKUP_FILE"
