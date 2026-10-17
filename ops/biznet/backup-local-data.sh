#!/usr/bin/env sh
set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/opt/omos/backups/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="$BACKUP_ROOT/$STAMP-public.dump"
STORAGE_FILE="$BACKUP_ROOT/$STAMP-storage.tar"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

docker exec omos-postgres-staging sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --schema=public --no-owner --no-privileges' \
  >"$DB_FILE"

STORAGE_ROOT="${STORAGE_ROOT:-/opt/omos/storage}"
# Bucket yang wajib ikut backup. fuel-bukti = bukti foto Fuel (migrasi 103),
# people-dokumen = dokumen karyawan. Bucket yang belum dibuat dilewati agar tar tidak gagal.
BUCKETS=""
for bucket in absensi-foto log-activity people-dokumen fuel-bukti; do
  if [ -d "$STORAGE_ROOT/$bucket" ]; then
    BUCKETS="$BUCKETS $bucket"
  else
    printf 'peringatan: bucket %s belum ada, dilewati
' "$bucket" >&2
  fi
done
[ -n "$BUCKETS" ] || { echo "tidak ada bucket storage untuk dibackup" >&2; exit 1; }
# shellcheck disable=SC2086
tar -cf "$STORAGE_FILE" -C "$STORAGE_ROOT" $BUCKETS

sha256sum "$DB_FILE" "$STORAGE_FILE" >"$BACKUP_ROOT/$STAMP.sha256"
chmod 600 "$DB_FILE" "$STORAGE_FILE" "$BACKUP_ROOT/$STAMP.sha256"

# Retain three complete local generations. Off-host backup remains a separate control
# (OPEN: belum ada tujuan di luar VPS — kerusakan VPS = kehilangan DB + seluruh bukti foto).
ls -1t "$BACKUP_ROOT"/*-public.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
ls -1t "$BACKUP_ROOT"/*-storage.tar 2>/dev/null | tail -n +4 | xargs -r rm -f
ls -1t "$BACKUP_ROOT"/*.sha256 2>/dev/null | tail -n +4 | xargs -r rm -f

printf 'database=%s\nstorage=%s\n' "$DB_FILE" "$STORAGE_FILE"
