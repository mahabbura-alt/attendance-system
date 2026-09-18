# OMOS Vercel API Entry Rules

This directory is the Vercel adapter/entry boundary.

- Keep this layer thin: routing/bootstrap only. Do not place mining business
  logic, credentials or tenant-policy decisions here.
- Preserve compatibility with `vercel.json` and the backend server export.
- Before modifying deployment routing or runtime behavior, inspect the current
  Vercel configuration and backend startup path.
- Treat deployment, environment variables, secrets and production routing as
  high-impact. Verify through an appropriate health/API check after a change.

