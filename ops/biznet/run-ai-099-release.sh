#!/usr/bin/env sh
# Migrasi 099 (fondasi agen LLM + trial HSE): preflight → backup terverifikasi → migrasi → verifikasi.
# Pemakaian: sh ops/biznet/run-ai-099-release.sh <RELEASE_DIR> [ENV_FILE] [BACKUP_ROOT]
set -eu

RELEASE_DIR="${1:?release directory is required}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
BACKUP_ROOT="${3:-/opt/omos/backups/manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_ROOT/$STAMP-pre-ai-099.dump"
SQL="$RELEASE_DIR/backend/migrations/099_ai_foundation_hse.sql"

test -r "$ENV_FILE"
test -r "$SQL"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

echo "[ai-099] preflight (harus: hazard_reports ada, tabel ai_* belum ada)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(); SELECT to_regclass(\$\$public.hazard_reports\$\$); SELECT to_regclass(\$\$public.hse_risk_matrix_config\$\$); SELECT count(*) FROM pg_tables WHERE schemaname=\$\$public\$\$ AND tablename IN (\$\$ai_settings\$\$,\$\$ai_requests\$\$,\$\$ai_jobs\$\$,\$\$hse_ai_suggestions\$\$,\$\$hse_hazard_merge_log\$\$);"'

echo "[ai-099] backup"
docker run --rm --user "$(id -u):$(id -g)" --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$BACKUP_ROOT:/backup" postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="/backup/'"$STAMP"'-pre-ai-099.dump"'
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
chmod 600 "$BACKUP_FILE" "$BACKUP_FILE.sha256"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:17-alpine \
  pg_restore --list "/backup/$STAMP-pre-ai-099.dump" >/dev/null
echo "[ai-099] backup verified $BACKUP_FILE"

echo "[ai-099] migrate"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" \
  -v "$SQL:/migration.sql:ro" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migration.sql'

echo "[ai-099] verify (harap: 5 / 1 / 0)"
docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM information_schema.tables WHERE table_schema=\$\$public\$\$ AND table_name IN (
      \$\$ai_settings\$\$,\$\$ai_requests\$\$,\$\$ai_jobs\$\$,\$\$hse_ai_suggestions\$\$,\$\$hse_hazard_merge_log\$\$);
    SELECT count(*) FROM information_schema.columns
      WHERE table_schema=\$\$public\$\$ AND table_name=\$\$hazard_reports\$\$ AND column_name=\$\$ai_clean_description\$\$;
    SELECT count(*) FROM ai_settings WHERE enabled;"'

echo "[ai-099] done backup=$BACKUP_FILE (AI tetap MATI sampai diaktifkan di Setup → Asisten AI)"
