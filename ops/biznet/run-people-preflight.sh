#!/usr/bin/env sh
# Pre-flight READ-ONLY OMOS People v2 (sebelum migrasi 093–098).
# SQL dibaca dari stdin dan dijalankan dalam transaksi READ ONLY + ROLLBACK — tidak mengubah data.
#
# Dari laptop (Git Bash, folder OMOS) — kirim SQL lewat stdin ke docker di server:
#   ssh -i omos-key.pem adminbiznet@103.58.101.240 \
#     "docker run --rm -i --network biznet_omos_data --env-file /opt/omos/secrets/app.env postgres:17-alpine \
#      sh -ec 'psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -P pager=off'" \
#     < docs/drafts/karyawan_preflight_readonly.sql > preflight.txt
#
# Di server (bila file SQL sudah ada di rilis):
#   sh ops/biznet/run-people-preflight.sh /opt/omos/releases/<REL>/docs/drafts/karyawan_preflight_readonly.sql
set -eu

SQL_FILE="${1:?path ke karyawan_preflight_readonly.sql wajib}"
ENV_FILE="${2:-/opt/omos/secrets/app.env}"
test -r "$SQL_FILE"
test -r "$ENV_FILE"
grep -q "BEGIN TRANSACTION READ ONLY" "$SQL_FILE" || { echo "SQL bukan pre-flight read-only" >&2; exit 2; }

docker run --rm -i --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off' < "$SQL_FILE"
