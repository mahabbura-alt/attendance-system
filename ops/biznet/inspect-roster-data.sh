#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-/opt/omos/secrets/app.env}"
START_DATE="${2:-$(date +%Y-%m-01)}"
END_DATE="${3:-$(date -d "$START_DATE +1 month -1 day" +%Y-%m-%d)}"

case "$START_DATE:$END_DATE" in
  ????-??-??:????-??-??) ;;
  *) echo "Tanggal harus YYYY-MM-DD" >&2; exit 2 ;;
esac

docker run --rm -i --network biznet_omos_data --env-file "$ENV_FILE" \
  -e ROSTER_START_DATE="$START_DATE" -e ROSTER_END_DATE="$END_DATE" postgres:17-alpine \
  sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v start_date="$ROSTER_START_DATE" -v end_date="$ROSTER_END_DATE" -P pager=off' <<'SQL'
\echo '=== ROSTER PERIOD ==='
SELECT :'start_date' AS start_date, :'end_date' AS end_date;

\echo '=== ACTIVE EMPLOYEES / ASSIGNMENTS / DAILY COVERAGE ==='
WITH active_employee AS (
  SELECT id, COALESCE(NULLIF(trim(jabatan), ''), 'Tanpa Jabatan') AS jabatan
  FROM users WHERE role='karyawan' AND is_active=TRUE
), assignment AS (
  SELECT DISTINCT a.user_id
  FROM employee_roster_assignments a
  WHERE a.is_active=TRUE
    AND a.effective_from <= :'end_date'::date
    AND (a.effective_to IS NULL OR a.effective_to >= :'start_date'::date)
), coverage AS (
  SELECT rd.user_id, count(*)::int AS covered_days
  FROM employee_roster_daily rd
  WHERE rd.tanggal BETWEEN :'start_date'::date AND :'end_date'::date
  GROUP BY rd.user_id
)
SELECT count(*) AS active_employees,
       count(*) FILTER (WHERE a.user_id IS NOT NULL) AS with_assignment,
       count(*) FILTER (WHERE a.user_id IS NULL) AS without_assignment,
       count(*) FILTER (WHERE COALESCE(c.covered_days,0)=0) AS without_daily_rows
FROM active_employee e
LEFT JOIN assignment a ON a.user_id=e.id
LEFT JOIN coverage c ON c.user_id=e.id;

\echo '=== GAP BY JOB TITLE ==='
WITH dates AS (
  SELECT generate_series(:'start_date'::date, :'end_date'::date, interval '1 day')::date AS tanggal
), active_employee AS (
  SELECT id, COALESCE(NULLIF(trim(jabatan), ''), 'Tanpa Jabatan') AS jabatan
  FROM users WHERE role='karyawan' AND is_active=TRUE
)
SELECT e.jabatan,
       count(DISTINCT e.id)::int AS employees,
       count(*)::int AS expected_cells,
       count(rd.id)::int AS filled_cells,
       (count(*)-count(rd.id))::int AS missing_cells
FROM active_employee e CROSS JOIN dates d
LEFT JOIN employee_roster_daily rd ON rd.user_id=e.id AND rd.tanggal=d.tanggal
GROUP BY e.jabatan
HAVING count(*)-count(rd.id) > 0
ORDER BY missing_cells DESC, e.jabatan;

\echo '=== DAILY ROW SOURCE / STATUS ==='
SELECT source, status, count(*)::int AS rows
FROM employee_roster_daily
WHERE tanggal BETWEEN :'start_date'::date AND :'end_date'::date
GROUP BY source,status ORDER BY source,status;

\echo '=== DATA INTEGRITY CHECKS ==='
SELECT
  count(*) FILTER (WHERE status IN ('S','M') AND shift_id IS NULL) AS work_without_shift,
  count(*) FILTER (WHERE status NOT IN ('S','M') AND shift_id IS NOT NULL) AS nonwork_with_shift,
  count(*) FILTER (WHERE source='generated' AND assignment_id IS NULL) AS generated_without_assignment,
  count(*) FILTER (WHERE source='leave_sync' AND leave_realisation_id IS NULL) AS leave_without_realisation
FROM employee_roster_daily
WHERE tanggal BETWEEN :'start_date'::date AND :'end_date'::date;

\echo '=== ACTIVE POLICY / JOB TITLE COVERAGE ==='
WITH jobs AS (
  SELECT COALESCE(NULLIF(trim(jabatan), ''), 'Tanpa Jabatan') AS jabatan,
         lower(regexp_replace(trim(COALESCE(NULLIF(jabatan,''),'Tanpa Jabatan')), '\s+', ' ', 'g')) AS jabatan_key,
         count(*)::int AS employees
  FROM users WHERE role='karyawan' AND is_active=TRUE
  GROUP BY 1,2
)
SELECT j.jabatan,j.employees,
       count(p.id)::int AS active_policies
FROM jobs j
LEFT JOIN roster_jabatan_policies p ON p.jabatan_key=j.jabatan_key AND p.is_active=TRUE
  AND p.effective_from <= :'end_date'::date
  AND (p.effective_to IS NULL OR p.effective_to >= :'start_date'::date)
GROUP BY j.jabatan,j.employees
ORDER BY active_policies,j.jabatan;

\echo '=== SHIFT MASTER ==='
SELECT nama_shift, operational_start, operational_end, lintas_hari
FROM shifts ORDER BY operational_start, nama_shift;
SQL
