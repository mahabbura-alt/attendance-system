# OMOS Engineering Constitution

Project: **OMOS — One Mining Operating System**.

## Start here (all agents, all platforms)

Before any non-trivial task, read `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md`
first — it holds verified implementation status, completed work, known issues,
and prior owner decisions, so you don't re-screen the whole directory. After
completing a task, update that file (context summary, new/edited files and
scripts, new features). The repository stays the source of truth; the handover
guides, it never replaces verification.

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

## UI/UX and Frontend Design Standard (Taste Skill & Awesome DESIGN.md)

Setiap agen yang mengerjakan tugas dalam hal generate tampilan, desain UI/UX, styling, layout, redesign, mockup visual, atau pembuatan komponen frontend (baik Web maupun Mobile) **WAJIB** membaca dan menerapkan panduan dari:
1. **Taste Skill** (`.codex/skills/taste-skill/SKILL.md` atau varian terkait di `.codex/skills/`):
   - **Anti-Slop Guard**: Mencegah output UI generic, monoton, atau template AI slop.
   - **Craftsmanship**: Menerapkan visual hierarchy yang tegas, tipografi berkarakter dan proporsional, rhythm spacing yang konsisten, micro-interactions yang halus, serta contrast ratio yang nyaman untuk operasional mining.
   - **Tuning Dial**: Sesuaikan tiga parameter dial (`DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`) sesuai konteks enterprise dashboard/mobile lapangan.
   - **Pilihan Varian Sesuai Kebutuhan**:
     - `taste-skill` (`.codex/skills/taste-skill/SKILL.md`): Standar frontend UI & layout utama.
     - `redesign-skill` (`.codex/skills/redesign-skill/SKILL.md`): Audit dan pembaruan antarmuka eksisting.
     - `image-to-code-skill` (`.codex/skills/image-to-code-skill/SKILL.md`): Implementasi frontend dari referensi desain visual.
     - `imagegen-frontend-web` / `imagegen-frontend-mobile` (`.codex/skills/`): Desain visual mockup web/mobile.
2. **Awesome DESIGN.md Systems** (`.codex/design-md/`):
   - **74+ Curated Brand Design Systems**: Memanfaatkan analisis design tokens, palet warna (`canvas`, `surface`, `primary`, `hairline`), skala tipografi, border radius, shadow, dan pola komponen dari brand ternama (`linear.app`, `supabase`, `vercel`, `stripe`, `sentry`, `posthog`, `raycast`, `apple`, dll.).
   - **Kesesuaian Desain**: Bila pengguna meminta gaya desain atau tema tertentu, gunakan acuan token dan aturan spesifik dari `.codex/design-md/<brand>/DESIGN.md`.

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

## Dynamic context map

Load only what is relevant to the task:

| Need | Read / use |
| --- | --- |
| Architecture, tenant boundary, deployment or enterprise design | `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md` |
| AI/LiteLLM design | `OMOS_LITELLM_PROJECT_HANDOVER.md` and `Litellm/AGENTS.md` |
| Migration history or production handover | `HISTORI_CHAT_MIGRASI.md`, `OMOS_handoff_2026-09-05.md` |
| Mining formula/KPI | `omos-mining-validation` skill |
| UI/UX design, frontend styling, redesign, visual mockups, brand systems | Taste Skill (`.codex/skills/taste-skill/SKILL.md`) dan Awesome DESIGN.md (`.codex/design-md/`) |
| Backend/API/database | `backend/AGENTS.md` |
| Admin dashboard | `admin-dashboard/AGENTS.md` |
| Mobile web | `mobile-web/AGENTS.md` |
| Vercel entry/routing | `api/AGENTS.md` |
| Data Produksi / fuel allocation / density snapshots | `docs/DATA_PRODUKSI_IMPLEMENTATION.md` |
| Cross-platform history, completed task status, known issues, or handover | `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md` |

Keep responses concise and in Bahasa Indonesia unless the user asks otherwise.
