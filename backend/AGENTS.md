# OMOS Backend Rules

The backend is the authority for validation, authorization and persistent data.

- Inspect routes, controllers, services, SQL and migrations before changing an
  endpoint or query. Extend established patterns before adding abstractions.
- Do not rely on frontend validation for operational integrity.
- Keep route/controller code focused on HTTP concerns; place reusable mining
  domain calculations and policy decisions outside UI-facing controllers when
  compatible with the existing structure.
- Preserve authentication, authorization, tenant/project scoping, audit and
  predictable error handling for operational writes.
- Use migrations for schema changes. Check foreign keys, indexes, uniqueness,
  backward compatibility, soft deletes and production data impact.
- Writes that can be retried or synchronized must be idempotent where feasible.
- Avoid unsafe broad updates/deletes and never hard-delete operational history
  unless explicitly authorized and proven safe.
- For changes to formulas, units, density, rates, productivity, fuel, standby
  or fleet KPIs, follow the `omos-mining-validation` skill before code edits.
- Verify with targeted tests or endpoint checks; do not treat a successful
  build as proof of data correctness.

