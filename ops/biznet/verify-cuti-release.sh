#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-/opt/omos/secrets/app.env}"
BACKUP_SHA="${2:-/opt/omos/backups/manual/20261007T113742Z-pre-cuti-070.dump.sha256}"

echo "RELEASE=$(readlink -f /opt/omos/current)"
docker ps --filter name=omos-app --format '{{.Names}}|{{.Status}}|{{.Image}}'
printf 'LOCAL_HEALTH='
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
printf 'HTTPS_HEALTH='
curl -ksS -o /dev/null -w '%{http_code}\n' https://127.0.0.1/health
printf 'PUBLIC_HEALTH='
curl -sS -o /dev/null -w '%{http_code}\n' https://omos-mining.com/health
printf 'IP_COMPAT_HEALTH='
curl -ksS -o /dev/null -w '%{http_code}\n' https://103.58.101.240/health
printf 'CUTI_AUTH='
curl -ksS -o /dev/null -w '%{http_code}\n' https://127.0.0.1/api/admin/cuti/dashboard
printf 'CUTI_JS='
curl -ksS -o /dev/null -w '%{http_code}\n' 'https://127.0.0.1/cuti.js?v=2'
printf 'CUTI_CSS='
curl -ksS -o /dev/null -w '%{http_code}\n' 'https://127.0.0.1/cuti.css?v=2'

grep -q 'cuti.js?v=2' /opt/omos/current/admin-dashboard/index.html
echo 'INDEX_V2=YES'
docker exec omos-app grep -q 'PARTIAL' /app/backend/src/services/cuti.js
echo 'SERVICE_REMEDIATION=YES'
sha256sum -c "$BACKUP_SHA"

docker run --rm --network biznet_omos_data --env-file "$ENV_FILE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -Atc "
    SELECT count(*) FROM information_schema.tables
      WHERE table_schema=\$\$public\$\$ AND table_name IN (
        \$\$leave_policy_versions\$\$,\$\$employee_leave_entitlements\$\$,
        \$\$employee_leave_requests\$\$,\$\$employee_leave_realisations\$\$,
        \$\$employee_leave_projections\$\$,\$\$leave_roster_reconciliation\$\$,
        \$\$leave_audit_log\$\$,\$\$leave_roster_snapshots\$\$);
    SELECT count(*) FROM leave_roster_snapshots;"'

if docker logs --since 10m omos-app 2>&1 | grep -Ei 'uncaught|unhandled|fatal|error:'; then
  exit 2
fi
echo 'APP_ERROR_SCAN=CLEAN'
