# OMOS Admin Dashboard Rules

This directory is the operational web interface. It must reflect backend truth
and make critical mining data understandable and safe to edit.

- Inspect existing DOM IDs, state, API helpers and module conventions before
  adding UI behavior. Do not introduce parallel state or duplicate endpoints.
- Client-side calculations are display aids unless the backend explicitly owns
  the same calculation; do not make the browser the only source of truth for
  operational KPIs.
- Preserve loading, empty, error, unsaved-change and validation states.
- Make editable versus read-only source-of-truth fields visually clear.
- Keep dense planning tables performant: render only needed periods/details,
  preserve sticky/frozen context where already established, and avoid blocking
  the UI with whole-history recomputation.
- Ensure keyboard and mouse interaction remains usable for data-entry grids.
- Do not expose backend secrets or privileged configuration in frontend code.
- Test the affected flow in the browser after changes, including refresh and
  persistence when the feature writes data.
- Any change to mining units, rates, productivity, fuel, fleet or KPI formulas
  requires the `omos-mining-validation` skill before implementation.

## Mandatory async save feedback

Every new or modified admin-dashboard action that persists data must use the
shared `window.OMOSActionFeedback` helper from `ui-action-feedback.js`. Wrap the
authoritative async request with `OMOSActionFeedback.run(button, task, options)`;
do not create a separate spinner implementation and do not infer save actions
from button text.

- Lock the initiating button for the full request lifetime so repeated mouse,
  touch, or keyboard submissions cannot start overlapping writes.
- Show the standard `Menyimpan…`, `Tersimpan`, and `Gagal` states. Preserve the
  button's original label, dimensions, disabled state, and ARIA attributes.
- Use `resolveDisabled` when the button must remain disabled after a successful
  save because the form no longer has dirty data.
- Use `onRestore` to recompute dynamic labels or draft counters after feedback;
  never leave a successfully saved button showing its stale pre-save count.
- Autosave-only screens must expose an equivalent animated status and coalesce
  rapid edits; they must not invent a fake save button.
- Frontend locking is UX protection, not a replacement for backend uniqueness,
  upsert, transaction, or idempotency guarantees on critical writes.
- Add or update a regression test covering re-entry protection, success, and
  failure restoration whenever the shared helper or its integration changes.
