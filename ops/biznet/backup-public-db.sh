#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-/opt/omos/secrets/source.env}"
BACKUP_DIR="${2:-/opt/omos/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env-file "$ENV_FILE" \
  -v "$BACKUP_DIR:/backup" \
  postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner --no-privileges --file="/backup/'"$STAMP"'-public.dump"'

sha256sum "$BACKUP_DIR/$STAMP-public.dump" > "$BACKUP_DIR/$STAMP-public.dump.sha256"
chmod 600 "$BACKUP_DIR/$STAMP-public.dump" "$BACKUP_DIR/$STAMP-public.dump.sha256"
echo "$BACKUP_DIR/$STAMP-public.dump"
