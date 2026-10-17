# LOGISTIK — implementation contract

Owner approved the recommendation on 2026-10-04. This workspace integrates
procurement, warehousing and maintenance demand; it does not change OMOS plane
boundaries or replace the existing Fuel inventory ledger.

## Delivery scope

- Control Center and role-based task navigation.
- Item, warehouse and supplier master data; base UoM and compatible models.
- Material requests, PR, supplier quotation, PO, shipment and receipt/QC.
- Ledger-backed opening/receipt, issue, reservation, transfer, return and count.
- FIFO cost lineage; FIFO/FEFO physical selection, batch, expiry and serial.
- Maintenance requirement matching and explicit mapping to catalog items.
- Inventory aging, reorder proposals, supplier performance, integrity review.
- Tools loans, repairable component events and warranty/return references.
- CSV export and validated tab-separated grid input.
- Local form drafts, explicit retry with stable idempotency keys; server owns
  balances, approval, stock and posting. A draft never reserves or consumes stock.

## Operational rules

- Quantities are expressed in the catalog base UoM; no inferred conversion.
- FIFO applies to regular FIFO stock. FEFO and serial-tracked items use actual
  selected batch cost (specific identification); the catalog exposes that policy.
  Independent physical FEFO with financial FIFO and weighted-average costing
  are not implemented. Fuel retains its existing valuation and ownership.
  No historical fuel copying or recosting.
- Item stock policy selects FIFO/FEFO; expiry, quarantine and reservations constrain
  availability. Unknown procurement cost is not silently valued as zero.
- Approved requests/reservations are distinct from posted stock issues.
- Posted documents are immutable. Corrections use referenced compensating records.
- Transfers reduce source stock on dispatch and increase destination on receipt.
- Every data-access path resolves an authorized scope on the server. Membership
  is explicit; the migration seeds only existing superadmins into legacy default.
- Legacy equipment/maintenance links are enabled only for the legacy default
  scope until their source tables have native project ownership.

## Verification / release

Track actual completion and limitations in the working handover. A migration file
is not evidence that migration ran. Browser fixture data is not production data.
