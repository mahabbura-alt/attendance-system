\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT format(
  'SELECT %L || ''|'' || count(*) FROM %I.%I;',
  tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
