---
name: omos-mining-validation
description: Validate OMOS mining-productivity requests before implementation. Use when a request changes mining formulas, units, density, production rates, fleet logic, capacity, material conversion, or dashboard KPI definitions; flag anomalies and obtain a decision before making a potentially incorrect change.
---

# OMOS Mining Validation

Validate the request before editing code or data.

1. Identify the operational quantity, its unit, and its time basis.
2. Check dimensional consistency across the requested formula. Treat `Ton/BCM` as density or conversion factor, and `Ton/Hr` or `BCM/Hr` as productivity rate.
3. Confirm whether a value is manual, derived, or sourced from List Equipment. Do not allow manual overrides of declared source-of-truth fields without explicit approval.
4. Retain full precision for intermediate calculations; round only display values unless the user explicitly specifies another policy.
5. If an anomaly, ambiguity, or conflict is found, stop before implementation and present a concise confrontation dialog: requested change, inconsistency/risk, recommended correction, and options.
6. Continue only after the user confirms the intended choice, then state the assumption in the implementation handoff.

Apply this validation to both OB and Coal planning. Treat Coal density as the multiplier that converts volume-based productivity into mass-based productivity.
