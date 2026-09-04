const assert = require('node:assert/strict');
const { findPeriodConflict, calculateCheckedProduction, summarizePitValues, deduplicateFleetPlans } = require('./fleetCapacity.core.js');

const plans = [
  { id: 'clay', loaderCode: 'EX40666', values: { material: 'CLAY' } },
  { id: 'coal', loaderCode: 'EX40666', values: { material: 'COAL' } },
  { id: 'other', loaderCode: 'EX50001', values: { material: 'CLAY' } },
];
const selections = {
  clay: { '2026:1:1': true },
  coal: {},
  other: { '2026:1:2': true },
};

const sameFleetConflict = findPeriodConflict(plans, selections, 'coal', ['2026:1:1']);
assert.equal(sameFleetConflict?.plan.id, 'clay', 'same excavator must not run two material plans on the same date');
assert.equal(sameFleetConflict?.key, '2026:1:1', 'conflict must report the exact overlapping date');
assert.equal(findPeriodConflict(plans, selections, 'coal', ['2026:1:2']), null, 'different excavator selection must not block the fleet');
assert.equal(findPeriodConflict(plans, selections, 'coal', ['2026:1:3']), null, 'same excavator may run another material on a different date');

assert.equal(
  calculateCheckedProduction(455.125, [10, 12]),
  10012.75,
  'production must sum daily EWH multiplied by full-precision fleet productivity',
);
assert.equal(calculateCheckedProduction(455.125, []), null, 'unchecked periods must not calculate production');
assert.equal(calculateCheckedProduction(455.125, [10, null]), null, 'incomplete EWH source must remain unavailable, not zero');
assert.equal(calculateCheckedProduction(0, [10, 12]), null, 'unavailable fleet productivity must not be interpreted as valid production');

assert.deepEqual(summarizePitValues(['Pit 1', 'Pit 1']), { value: 'Pit 1', mixed: false }, 'same PIT across child days must roll up to one location');
assert.deepEqual(summarizePitValues(['Pit 1', 'Pit 2']), { value: '', mixed: true }, 'different PIT assignments must be shown as Mixed');
assert.deepEqual(summarizePitValues([]), { value: '', mixed: false }, 'period without active days must have no PIT assignment');

const uniqueFleet = deduplicateFleetPlans([
  { loaderCode: 'EX40666', loaderUnit: { class_unit: 'EX 40T' }, type: 'ob' },
  { loaderCode: 'EX40666', loaderUnit: { class_unit: 'EX 40T' }, type: 'coal' },
  { loaderCode: 'EX50001', loaderUnit: { class_unit: 'EX 50T' }, type: 'ob' },
]);
assert.deepEqual(uniqueFleet.map(row => row.loaderCode), ['EX40666', 'EX50001'], 'PIT Area Setup must show one row per unique fleet name regardless of material or JOB');

console.log('fleetCapacity tests passed');
