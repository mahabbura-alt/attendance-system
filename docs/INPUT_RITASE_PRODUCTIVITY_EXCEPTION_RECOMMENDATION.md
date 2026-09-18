# OMOS Input Ritase — Productivity Exception

Status: approved direction, implementation initiated 2026-09-07.

## Objective

Turn missed fleet productivity into an auditable operational exception workflow. The feature must distinguish incomplete input, confirmed zero production, non-operating periods, and genuine underperformance.

## Calculation contract

- OB plan: BCM/Hr.
- Coal plan: Ton/Hr.
- Hourly actual: sum of `ritase_count × truck_factor` across the fleet's dump trucks.
- Hourly achievement: `actual production / (fleet productivity plan × active slot hours) × 100%`.
- Preserve full precision in storage/calculation and round only for display.
- Initial configurable visual thresholds: green at least 95%, yellow 85–<95%, red below 85%, gray when inputs or plan are incomplete/non-operating.

## Recommended workflow

1. Save actual ritase first; never discard operational input because the cause is not classified yet.
2. Evaluate productivity per fleet-hour after the hourly data is confirmed.
3. A missed target creates/updates a Productivity Exception snapshot.
4. One exception supports one primary and multiple contributing Problem Productivity codes.
5. Problem choices come from `master_problem_codes` and remain grouped by MACHINE, MAN, METHOD, MATERIAL, and ENVIRO.
6. Capture impact duration, notes, optional evidence URL, actor, timestamps, plan/actual snapshot, unit, achievement, shortfall, and formula version.
7. Require unresolved exceptions to be classified before future shift/report finalization, without blocking raw ritase persistence.

## User experience

- Bold, color-coded hourly Productivity values.
- A `Pdty Problem` row with compact 3D buttons aligned to each hour.
- A floating editor supports multiple problem codes without leaving the grid.
- Bulk/copy-to-next-hour classification is a recommended later enhancement.
- A Productivity History view provides date, shift, area, fleet, JOB, material, hour, plan, actual, achievement, shortfall, problems, duration, notes, evidence, and workflow status.
- Header badges show unresolved exception counts.

## Data integrity and future development

- Store snapshots so later planning changes do not rewrite history.
- Keep problem codes as foreign keys while retaining snapshot labels for audit.
- Use soft delete and actor/timestamp fields.
- Add tenant/project ownership when the current operational schema is migrated to the target multi-client data plane.
- Later recommendations may use Breakdown, Standby, Fleet Match, fuel, cycle-time, road/front conditions, and Unit Mapping as evidence. Automated suggestions must never silently replace supervisor confirmation.

