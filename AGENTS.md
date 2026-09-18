# OMOS Engineering Constitution

Project: **OMOS — One Mining Operating System**.

OMOS is evolving from an operational mining application into a configurable,
secure, auditable, offline-aware, multi-client operating platform. Treat the
repository as the source of truth for current implementation; architecture
documents define the approved direction, not proof that a feature already
exists.

## Architecture and scope

OMOS has four responsibility boundaries:

1. **Control Plane** — client lifecycle, subscription, entitlement,
   provisioning, deployment, release/version and support.
2. **Client Data Plane** — isolated operational data for each client.
3. **Core Platform** — identity, RBAC, MDM, configuration, workflow, audit,
   data quality, import, policy, sync, security and observability.
4. **Mining Modules and Intelligence** — People, Production, Commercial,
   Maintenance, HSE, Fleet, AI Vision, Operational Intelligence and Predictive
   Mining.

- Do not design features as single-client or single-project by default.
- Do not create client-specific source-code forks. Prefer configuration,
  policy, metadata, workflow definitions, versioned schemas, feature flags or
  entitlements.
- Keep responsibilities in their appropriate boundary. Domain mining rules do
  not belong in UI components, Vercel adapters or model-provider code.
- If a task changes an architecture boundary, frozen decision, deployment
  model, critical compliance requirement, or introduces a new system boundary,
  stop and ask the project owner before implementing it.

## Data, security and operations

- Preserve tenant/project isolation whenever the current implementation
  provides those scopes. Never trust tenant, project, role or ownership data
  supplied only by the client.
- Treat correctness, data integrity, authorization, auditability and security
  as higher priority than implementation speed.
- Never expose, log, commit or copy secrets, credentials, tokens, passwords or
  production connection strings.
- Prefer reversible changes, migrations, validation, soft-delete/tombstone
  patterns and explicit error handling over destructive actions.
- Field-facing workflows must be evaluated for degraded/offline operation,
  retry, idempotency, conflict/reconciliation and data lineage where relevant.
- Shift-based records must preserve operational-date semantics; calendar date
  alone may not represent the operational day.

## Mining calculation safeguard

Before changing any formula, unit, density, production rate, productivity,
fleet capacity, fuel KPI, delay/standby KPI or measurement logic, load and
follow the `omos-mining-validation` skill. If the requested unit or formula is
ambiguous/anomalous, present the discrepancy to the project owner before
implementation.

## How to work

For non-trivial tasks:

1. Inspect the actual relevant code, API and database/migrations first.
2. Identify the affected layer, dependencies, data ownership, security and
   offline/sync implications.
3. Reuse or extend existing patterns; do not duplicate a working subsystem.
4. Make the smallest architecturally correct change.
5. Run proportionate verification, including the affected API/UI flow when
   feasible.
6. Report changed files, tests, user-visible behavior and remaining risks.

Do not claim that a history or handover document proves implementation status.
Verify implementation against the repository and deployed environment.

## UI/Frontend browser review (wajib)

Setiap selesai mengubah UI/frontend, buka browser preview localhost, tampilkan
halaman yang berubah, cek layout dan console error, lalu laporkan hasil visual
review sebelum menyatakan task selesai. Review visual ini wajib selesai sebelum
deploy ke server; jangan deploy perubahan frontend yang belum lolos review
browser.

## Dynamic context map

Load only what is relevant to the task:

| Need | Read / use |
| --- | --- |
| Architecture, tenant boundary, deployment or enterprise design | `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md` |
| AI/LiteLLM design | `OMOS_LITELLM_PROJECT_HANDOVER.md` and `Litellm/AGENTS.md` |
| Migration history or production handover | `HISTORI_CHAT_MIGRASI.md`, `OMOS_handoff_2026-09-05.md` |
| Mining formula/KPI | `omos-mining-validation` skill |
| Backend/API/database | `backend/AGENTS.md` |
| Admin dashboard | `admin-dashboard/AGENTS.md` |
| Mobile web | `mobile-web/AGENTS.md` |
| Vercel entry/routing | `api/AGENTS.md` |
| Data Produksi / fuel allocation / density snapshots | `docs/DATA_PRODUKSI_IMPLEMENTATION.md` |
| Cross-platform history, completed task status, known issues, or handover | `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md` |

Keep responses concise and in Bahasa Indonesia unless the user asks otherwise.
