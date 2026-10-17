# OMOS People — Enterprise Workforce Management (Option C)

Status: **FUTURE MILESTONE / NOT YET IMPLEMENTED**  
Source design: `docs/omos-modul-karyawan.md`  
Current implementation target: Option B (Modular Operations)

## Objective

Evolve OMOS People from operational employee movements and manpower planning
into a configurable, multi-client workforce platform without coupling mining
business policy to authentication records or client-specific source forks.

## Target capabilities

1. Configurable multi-level approval workflows per tenant, project, department,
   movement type, employment type, and value/risk threshold.
2. Employee self-service for resignation, transfer requests, profile changes,
   document submission, and approval tracking.
3. Contract, probation, competency, medical, induction, SIMPER/SIO, training,
   and HSE certification lifecycle with configurable expiry alerts.
4. Recruitment pipeline from approved MPP gap through request, candidate,
   onboarding, effective hire, and time-to-fill measurement.
5. Forward-looking workforce projections for planned hires, contract expiry,
   scheduled exits, transfers, roster demand, and critical-position coverage.
6. Notification orchestration through in-app, email, and approved enterprise
   messaging adapters with idempotent delivery and audit evidence.
7. Payroll, roster, attendance, access-control, training, HSE, and external HRIS
   integration through versioned events and explicit reconciliation.
8. Cross-project and tenant-scoped analytics for headcount, turnover, retention,
   span of control, vacancy risk, workforce cost, and MPP accuracy.
9. Offline-capable onboarding and document capture for remote mine sites with
   encrypted local drafts, retry, conflict detection, and reconciliation.
10. Enterprise SSO, delegated administration, policy-driven field visibility,
    retention, legal hold, and privacy/data-subject workflows.

## Architecture direction

- `users` remains Core Identity; it must not become the HR domain aggregate.
- Employee profile, effective assignment, movement event, approval, document,
  certification, contract, and planning data belong to OMOS People.
- Current state is maintained as effective-dated snapshots; immutable events and
  audit records preserve how and why the state changed.
- Tenant and project scope is always derived and authorized by the backend.
- Workflow definitions, checklist templates, reason codes, notification rules,
  and KPI thresholds are configuration—not client-specific code.
- Cross-module effects are emitted as versioned, idempotent domain events and
  reconciled; People must not update unrelated module tables silently.

## Prerequisites

1. Core Tenant, Project, Organization, RBAC, Workflow, Audit, and Object Storage
   services are authoritative and use stable UUID ownership.
2. Option B employee profile/assignment/movement history is deployed and its
   legacy compatibility scope is migrated to Core tenant/project ownership.
3. Data classification, retention, attachment malware scanning, encryption,
   backup, and recovery policies are approved.
4. Payroll and HSE integration contracts are versioned and reconciliation-ready.
5. Edge/offline schema compatibility and conflict policies are frozen.

## Proposed delivery slices

### C1 — Configurable governance

- Workflow designer, approval policies, delegation, SLA/escalation, and a
  permission matrix down to field/action scope.

### C2 — Contract and competency lifecycle

- Contract/probation, competency, MCU, induction, SIMPER/SIO, certification,
  expiry alerts, and evidence documents.

### C3 — Recruitment and workforce projection

- Candidate pipeline, requisition fulfillment, planned supply/demand, vacancy
  risk, time-to-fill, and workforce-cost outlook.

### C4 — Employee self-service and notifications

- Mobile-first self-service, signed acknowledgements, notification adapters,
  offline drafts, retry, sync status, and reconciliation.

### C5 — Enterprise intelligence and integrations

- Cross-project analytics, external HRIS/payroll/access/HSE integration, SSO,
  data warehouse feeds, privacy workflows, and controlled AI recommendations.

## Explicit exclusions from Option B

Option B must not present these future capabilities as already available. In
particular, it does not include a generic workflow designer, recruitment ATS,
certification engine, employee self-service, offline movement sync, external
HRIS connectors, or cross-tenant analytics.

