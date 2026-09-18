# OMOS Working Context and Handover

Status: active cross-platform reference.
Last consolidated: 2026-09-17.
Scope: `D:\OneDrive\Desktop\ONE MINING` only.

## Purpose and Rules

Use this document before non-trivial OMOS work that needs prior task history,
known issues, deployment context, or cross-platform continuity. It is shared by
Codex and Kilo VS Code; it is not a transcript and must not contain secrets.

Repository and deployed behavior remain the source of truth. Architecture,
handover, and chat history define direction or evidence only. Every ledger row
uses one of these evidence labels:

- `VERIFIED_REPO`: confirmed against current source, migration, test, or live check.
- `HISTORICAL_CHAT`: reported by a prior Codex/Kilo session; re-verify before changing it.
- `DESIGNED` / `PLANNED`: approved direction only, not proof of implementation.

After a material task, update the task ledger with its status, affected files,
verification, and remaining risk. Do not paste raw chat transcripts or tokens.

## Project Identity

- Product: OMOS, One Mining Operating System.
- Canonical workspace: `D:\OneDrive\Desktop\ONE MINING`.
- Historical workspace: `D:\OneDrive\Desktop\PROJECT`, merged into ONE MINING;
  do not implement against it.
- Production Vercel project: `attendance-system`; historical alias:
  `attendance-system-eta-opal.vercel.app`.
- Vercel entry: `api/index.js` loads `backend/src/server`.
- Data platform: Supabase PostgreSQL and storage. Read configuration from approved
  local environment files; never copy a credential into this document or a chat.

## Architecture and Working Contract

OMOS has four boundaries: Control Plane, Client Data Plane, Core Platform, and
Mining Modules plus Intelligence. Keep tenant/project isolation, auditability,
offline/retry implications, and operational-date semantics intact.

Before changing a mining formula, unit, density, production rate, productivity,
fleet capacity, fuel KPI, standby/breakdown KPI, or measurement logic, load the
`omos-mining-validation` skill. Stop for an owner decision when the request
changes a frozen architecture boundary, deployment model, security/compliance
requirement, or system boundary.

Layer pointers:

| Need | Read first |
| --- | --- |
| Architecture, tenancy, enterprise direction | `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md` |
| Migration/deployment handover | `HISTORI_CHAT_MIGRASI.md`, `OMOS_handoff_2026-09-05.md` |
| Backend/API/database | `backend/AGENTS.md` and relevant migration/controller/service |
| Admin dashboard | `admin-dashboard/AGENTS.md` |
| Mobile/offline | `mobile-web/AGENTS.md` |
| Vercel routing | `api/AGENTS.md`, `vercel.json` |
| AI/LiteLLM | `OMOS_LITELLM_PROJECT_HANDOVER.md`, `Litellm/AGENTS.md` |
| Production data/fuel/density | `docs/DATA_PRODUKSI_IMPLEMENTATION.md` |

## Verified Current Implementation Snapshot

| Area | Current behavior | Evidence |
| --- | --- | --- |
| Absensi initial load | Dashboard defaults start and end date to current WIB day, requests `tanggal_dari` and `tanggal_sampai`, and loads filter master data independently. | `VERIFIED_REPO`: `admin-dashboard/app.js:621-700` |
| Log Activity | No `logActivity`, `logScheduler`, or `muatLogActivity` implementation remains in ONE MINING. | `VERIFIED_REPO`: repository search 2026-09-16 |
| Productivity planning | Legacy representative-truck code remains in `planProductivity.core.js`; active workspace payload v6 separates Loader per excavator+material, Hauler rows, and JOB-specific Setting Fleet. Backend calculates the authoritative heterogeneous Fleet target. | `VERIFIED_REPO`: `admin-dashboard/planProductivity.workspace.js`; `backend/src/services/productivityPlanning.js`; `backend/src/controllers/production.controller.js` |
| Report Breakdown | JPEG report module, asset, lazy-loader registration, and six-case unit test are documented as delivered. | `HISTORICAL_CHAT` + `HANDOVER_FITUR_REPORT_BREAKDOWN_2026-09-09.md` |

### Productivity Formula Note

Legacy frontend planning derives one truck's rate as:

`(60 / cycleTimeTruckMinutes) x effectiveCapacity x workEffFleet x density`

where cycle time is loading time plus loaded haul, empty return, and spot/dump.
OB uses BCM/Hr (`density = 1`); Coal converts to Ton/Hr with density. Fleet rate
in this representative model is `truckRate x numberOfTruck` capped by loader
productivity.

Current workspace v6 and backend both calculate every selected truck from its
Hauler row, explicit `BCM`/`Ton` capacity UoM, material, loader-derived Loading
Time, and common benchmark distance; they sum truck rates and cap by Loader
Productivity. The legacy module remains as a compatibility layer.

## Task Ledger

| Date / source | Work | Status and evidence | Remaining note |
| --- | --- | --- | --- |
| Pre-2026-09-05, migration handover | PROJECT merged into ONE MINING; production Vercel deployment and security history cleanup recorded. | `HISTORICAL_CHAT`: `HISTORI_CHAT_MIGRASI.md` | Re-check remote/push and production state before release work. |
| 2026-08-10, Codex session `019feab3` | Equipment master gained capacity value/UoM, equipment class, Support type, Excel import/export, templates, and related migrations. | `HISTORICAL_CHAT`: Codex history; migrations were reported run locally. | Verify schema and UI before extending import/equipment data. |
| 2026-08-11 to 12, Codex session `019ff1d7` | Manual attendance was reconciled with portal/dashboard, duplicate daily attendance fixed, synthetic manual times removed, and 18-hour checkout-overdue rule added. | `HISTORICAL_CHAT`: Codex final reports cite backend tests and Vercel deployments. | APK session/update work was reported as code-ready but APK build/publish deferred. |
| 2026-08-31 to 09-02, Codex session `01a0554c` | Breakdown/Standby sequence changed; breakdown workflow, status timeline, history/export, Calendar PA, and standby KPI interactions were implemented. | `HISTORICAL_CHAT`: Codex history; `OMOS_handoff_2026-09-05.md` verifies delete workflow and standby-code restore. | Calendar PA is an interim basis; KPI definition changes require mining validation. |
| 2026-09-05, handover | Active breakdown delete, PostgreSQL outer-join lock bug, and standby-code restoration completed. | `HISTORICAL_CHAT`: `OMOS_handoff_2026-09-05.md`; E2E delete 6/6 and database restore checks reported. | Preserve soft-delete for STB-01..07; retain STB-SYS-01. |
| 2026-09-09, Roo/VS Code handover | Report Breakdown JPEG delivered. | `HISTORICAL_CHAT`: `HANDOVER_FITUR_REPORT_BREAKDOWN_2026-09-09.md`; six unit cases reported passed. | Run `node --test admin-dashboard/breakdown-report.test.js` before modifying it. |
| 2026-09-16, Kilo session | Cross-platform context map and this canonical handover were created; current Absensi behavior and productivity formulas inspected. | `VERIFIED_REPO` for current code references above. | Keep this document concise and update only verified task outcomes. |
| 2026-09-16, Codex Fleet/Hauler database v5 | OB/Coal planning UI stored unique excavator/material Fleet entries and excavator/truck/material Hauler inputs in effective version JSONB. Fleet target is the minimum of loader and summed selected truck productivity. | `VERIFIED_REPO`: `admin-dashboard/planProductivity.workspace.js`, `backend/src/services/productivityPlanning.js`, `backend/src/controllers/production.controller.js`; backend 112/112, dashboard targeted 19/19, local browser fixture observed. | v5 production deployment was reported in prior turn; re-check live behavior before release work. |
| 2026-09-17, Codex Loader/Setting Fleet v6 | Loader record per excavator+material supports multiple SPO JOBs; Setting Fleet holds JOB, distance and selected trucks. Backend recalculates `fleetCatalog` for Ritase/JPEG. | `VERIFIED_REPO`: planning workspace, service, controller, tests; 113 backend and 17 targeted tests pass. Local browser fixture: 4 desktop cards, 2 JOBs on one Loader, save/refresh persistence, no console warning/error. | v6 not deployed; authenticated production API/database E2E not yet verified. |
| 2026-09-17, Codex Hauler workspace v7 | Hauler rows per Dump Truck × material, fixed OB BCM / Coal Ton Capacity, dynamic 100 m distance headers, excavator-to-excavator copy/paste, period Note and dirty-only save. Inherited setup remains editable through deployed SPO period end; backend preserves effective-date revisions and blocks writes after end. | `VERIFIED_REPO`: `admin-dashboard/planProductivity.workspace.js`, `backend/src/controllers/production.controller.js`, tests. Local browser fixture observed 8 rows for 2 trucks × 4 materials, OB BCM / Coal Ton, copy/paste, Note, dirty-only save, and no console warning/error. Full dashboard/backend suite passed 175/175. | Not deployed; authenticated production API/DB end-to-end and live SPO period data not yet verified. |
| 2026-09-17, Codex Input Ritase fleet identity | Fleet tables now distinguish the same excavator on date/shift by PIT/Area + JOB + material. Add rejects an identical normalized context; Edit sends `fleet_mapping_id` and updates the selected table while rejecting collision with another table. Migration 039 supplies a matching partial unique index for race protection. | `VERIFIED_REPO`: `admin-dashboard/production.js`, `backend/src/controllers/production.controller.js`, `backend/migrations/039_fleet_mapping_operational_context_unique.sql`; local modal review clean; full suite 178/178; Vercel production deployment `dpl_Gi4k6CbAQ9Q2U5rGUtWV8SqwycKg` READY and `/health` returns OK. | Local production DB credentials were unavailable (Vercel secrets are intentionally not pullable), so migration 039 needs a production DB execution/check before it can be marked applied. |
| 2026-09-17, Codex Input Ritase combined JPEG | Lapor groups all JOBs in one area into one JPEG, retaining separate BCM/Ton KPI, hourly fleet table, productivity-problem panel, and DT ritase panel per JOB. Table and chart span the complete shift; future hours after cutoff remain blank. Coal factor lookup is case-normalized and missing factors are rejected. | `VERIFIED_REPO`: `admin-dashboard/ritaseReport.js`, `admin-dashboard/ritase-report.test.js`; targeted report/distance tests 18/18 and full dashboard test command passed. Localhost browser fixture showed OB and CG with equal table/chart widths, no console warning/error; html2canvas JPEG render produced 2400×3025 canvas. Production deployment `dpl_8pszxo24PrFf24k7CRviQ4c7yapa` READY; alias health 200, served report hash equals local and loader uses `v=7`. | Authenticated production data for 16 September was not accessed in this release verification; migration 039 status remains separate from this frontend release. |
| 2026-09-17/18, Codex Database HM Input Data | New daily matrix and worklog detail derive HM from Input Data by operational date, operator ID and equipment ID. Normal/warning submitted validated logs count automatically; draft/unvalidated/critical require review. Admin review preserves source HM, reason and immutable audit; Excel export and review import are version-checked. Payroll and employee HM recap use Input Data from the migration cutover date, legacy daily HM before it. | `VERIFIED_PRODUCTION`: migrations 040 and 041 applied to connected Supabase. Migration 041 safely moved the cutover to first eligible source date, `2026-09-01`, without updating Input Data; draft rows with valid operator/HM may now be explicitly verified, while automatic payable remains submitted normal/warning only. Backend suite 125/125 passes; local preview showed enabled Edit for eligible draft row with no console error. Production deployment `dpl_Hsv2BpYBZdPTL2h79QzfHhbuVacU` READY; alias health 200 and deployed HM edit logic confirmed. | Authenticated production UI/API verification of one real admin review remains recommended. Records prior to `2026-09-01` remain legacy payroll history. |
| 2026-09-18, Codex Kalkulasi Payroll HM visibility | Kalkulasi Payroll now returns and displays `HM sumber`, `HM dibayar`, and `HM perlu verifikasi` independently. Draft HM is visible as source/pending but remains excluded from incentive/THP until automatic eligibility or explicit Database HM review; CSV and slip detail carry the same distinction. | `VERIFIED_REPO`: `backend/src/services/hmWorklog.js`, `backend/src/controllers/kalkulasiPayrollController.js`, `admin-dashboard/app.js`; backend 126/126 tests pass. Local browser fixture displayed readable fixed-width table and no console errors. `VERIFIED_PRODUCTION`: deployment `dpl_5eycJwZPFn2T5NZXZvEnKVJmgQ3t` READY, alias health 200, served payroll UI contains the new fields; Vercel error scan clean. | An authenticated admin should refresh the calculation to view live source/pending values; admin review is still required before draft HM becomes payroll incentive. |
| 2026-09-18, Codex Database HM direct-to-payroll rule | Local implementation supersedes the two HM rules above: removes the Database HM verification/status UI and payroll pending column/gate. Every non-deleted post-cutover Input Data Work Log with an operator and nonnegative numeric total HM is payable regardless of draft/anomaly/validation status. The effective value uses an existing admin correction only while its source version matches; otherwise it falls back to current source HM. Effective HM strictly above 10 hours per Work Log displays `HM Over, perlu verifikasi` as an informational note, not a pay blocker. Admin corrections and audit history remain; pre-cutover payroll continues using historical daily HM. | `VERIFIED_REPO`: backend suite 126/126 and admin save-feedback integration 5/5 passed; syntax checks passed. Local browser previews of Database HM and Payroll were inspected at 1600px: tables readable, status/pending columns absent, over-10 note visible. No production deployment or authenticated live payroll calculation was performed for this change. | Deploy only when explicitly requested. Historical table/endpoint internals retain their legacy names for non-destructive compatibility; the new user-facing operation is a correction, not verification. |
| 2026-09-18, Codex Database HM simplified display | Database HM now presents one effective `Total HM` column; it uses the current admin correction when applicable, otherwise Input Data HM. The source remains immutable and correction reason/history stay available. The filter dropdown was removed. Payroll table header is also `Total HM`, without an inline source value. | `VERIFIED_PRODUCTION`: dashboard integration 5/5 passed; local 1600px preview showed the simplified table, no filter control, and no console error. Production deployment `dpl_32QqZpPrvSmEmuuh7QRv1myZdteG` READY and alias health returned 200/OK; served index has `app.js?v=41`, `hm-worklog.js?v=3`, Total HM header, and no status filter. Vercel error-log scan returned no logs. | Export/import keeps its separate source and correction columns to preserve audited Excel correction workflow. |
| 2026-09-18, Codex Database HM KPI quick filters | `Data dikoreksi` and `HM di atas 10 jam` KPI cards are accessible toggle buttons. Each filters only the matrix and detail rows; clicking the active card again resets the filter. KPI counts remain period totals so the displayed count does not disappear when the result set narrows. | `VERIFIED_PRODUCTION`: dashboard integration 6/6 passed; local 1600px screenshot and browser accessibility preview showed both cards as clickable controls and the simplified nine-column detail table. Production deployment `dpl_82vYVTs5LgdZ1gtEK98WafEBD2fG` READY; alias health is OK and served assets expose both cards plus `hm-worklog.js?v=4` filter code. Vercel error-log scan returned no logs. | Cache versions `hm-worklog.css?v=3` and `hm-worklog.js?v=4` are required for this release. |
| 2026-09-18, Codex Input Data history limit | Input Data now requests up to 2,000 monthly Work Logs; the API validates and caps an optional `limit` parameter at 2,000 while preserving the 200-row default for other consumers. This fixes the prior behavior where descending query order truncated the view at 10 September and excluded earlier dates. | `VERIFIED_REPO`: `admin-dashboard/production.js`, `backend/src/controllers/production.controller.js`, `backend/test/production-hm-total.test.js`; backend suite 127/127 passed and local login preview loaded cleanly. | Not deployed; live authenticated Input Data review remains required after release. |

## Known Issues and Guardrails

- Attendance investigation remains relevant: see
  `docs/ATTENDANCE_DEEP_INVESTIGATION_2026-09-09.md` for false-pending-session
  and GPS threshold findings; do not assume the report proves fixes exist.
- Performance roadmap still lists dynamic module split, safe master-data cache,
  database index audit, pagination/virtual rendering, Speed Insights, and
  repository slow-query timing as unfinished. See
  `docs/OMOS_PLATFORM_PERFORMANCE_ROADMAP.md`.
- PostgreSQL outer joins: lock only the non-nullable target with
  `FOR UPDATE OF <alias>`; do not lock an entire nullable `LEFT JOIN` result.
- Do not reuse one PostgreSQL placeholder for different column types.
- On Windows, quote paths containing spaces. Prefer exact patches over deleting
  arbitrary line ranges in large JavaScript files; after a large JS edit, run
  syntax checks and confirm template literals were not cut.
- Browser cache can mask deployed static changes. Validate with hard refresh
  before diagnosing source behavior.

## Verification and Release Baseline

1. Inspect the relevant implementation, route, migration, API contract, and
   ownership boundary before editing.
2. Use existing patterns; backend is authoritative and UI save actions use
   `window.OMOSActionFeedback` where applicable.
3. Run proportionate verification. Backend baseline is `npm test` from
   `backend/`; production/dashboard modules have targeted `node --test` files.
4. For deploys explicitly requested by the owner, use the linked Vercel project,
   validate `/health`, and report the deployment URL. Deploy preview by default;
   production requires explicit instruction.
5. Report files changed, tests actually run, data/API/security impact, and
   remaining risks. Never report a chat claim as a verified result.

## Cross-Platform Handover Protocol

- **Kilo VS Code:** root `AGENTS.md` points here for history/status work.
- **Codex:** global `~/.codex/AGENTS.md` points here when the workspace is OMOS.
- **Both:** read this document when task history, current status, known issues,
  or prior decisions matter; then load only the domain-specific references
  listed above.
- Update this file only after a material task reaches a checkable outcome.
  Use evidence labels and preserve the distinction between verified, historical,
  designed, and planned work.
