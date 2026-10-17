'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildTargetDays,
  buildRangeDays,
  planningReferenceForRange,
  summarizeAssignments,
  findActiveFleetInstances,
  classifyQueueUnit,
  strictDumpTruckCompatibility,
  dumpTruckGuidance,
  isCompatibleDozerUom,
  canShareDozerInArea,
  formatFleetClassLabel,
  summarizeFleetByClassAndJob,
} = require('./unitMapping.core.js');

const monthDays = buildTargetDays(2028, 2, 'month', 1, 1);
assert.strictEqual(monthDays.length, 29, 'Leap year February must expose 29 atomic daily assignments');
assert.deepStrictEqual(buildTargetDays(2027, 1, 'day', 1, 12), [{ year: 2027, month: 1, day: 12 }]);
assert.deepStrictEqual(
  buildTargetDays(2027, 1, 'week', 2, 1, [{ days: [1, 2] }, { days: [3, 4, 5] }]),
  [{ year: 2027, month: 1, day: 3 }, { year: 2027, month: 1, day: 4 }, { year: 2027, month: 1, day: 5 }],
);
assert.deepStrictEqual(
  buildRangeDays('2026-09-29', '2026-10-02'),
  [
    { year: 2026, month: 9, day: 29 },
    { year: 2026, month: 9, day: 30 },
    { year: 2026, month: 10, day: 1 },
    { year: 2026, month: 10, day: 2 },
  ],
  'Embedded Unit Mapping must follow an inclusive Fleet Deployment date range across months',
);
assert.deepStrictEqual(buildRangeDays('2026-10-02', '2026-10-01'), [], 'Inverted ranges must be rejected');
assert.strictEqual(planningReferenceForRange('2026-09-01', '2026-09-30'), '2026-09-30',
  'Unit Mapping must load the latest effective Fleet plan inside the selected range');
assert.strictEqual(planningReferenceForRange('2026-09-01', ''), '2026-09-01');

const summary = summarizeAssignments({
  '2027:1:1': { role: 'support', area: 'PIT 1', fleetPlanId: '' },
  '2027:1:2': { role: 'support', area: 'PIT 1', fleetPlanId: '' },
}, ['2027:1:1', '2027:1:2', '2027:1:3']);
assert.strictEqual(summary.partial, true);
assert.strictEqual(summary.mixed, false);
assert.strictEqual(summary.assignment.area, 'PIT 1');

const mixed = summarizeAssignments({
  '2027:1:1': { role: 'support', area: 'PIT 1', fleetPlanId: '' },
  '2027:1:2': { role: 'support', area: 'PIT 2', fleetPlanId: '' },
}, ['2027:1:1', '2027:1:2']);
assert.strictEqual(mixed.mixed, true, 'One unit mapped to multiple areas in a scope must be flagged mixed');

const plan = { id: 'ob-1', loaderCode: 'EX-01' };
const active = findActiveFleetInstances(
  [plan],
  { 'ob-1': { '2027:1:1': true, '2027:1:2': true } },
  { 'fleet:ex-01': { '2027:1:1': 'PIT 1', '2027:1:2': 'PIT 2' } },
  [{ year: 2027, month: 1, day: 1 }, { year: 2027, month: 1, day: 2 }],
);
assert.strictEqual(active.length, 2, 'A fleet that changes area must create one scoped instance per area');
assert.deepStrictEqual(active.map(item => item.area), ['PIT 1', 'PIT 2']);

assert.strictEqual(classifyQueueUnit({ kelas_alat: 'Dump Truck' }), 'dump-truck');
assert.strictEqual(classifyQueueUnit({ kelas_alat: 'Excavator' }), 'excavator-support');
assert.strictEqual(classifyQueueUnit({ kelas_alat: 'Dozer' }), 'dozer-support');

assert.strictEqual(isCompatibleDozerUom('BCM/Hr'), true);
assert.strictEqual(isCompatibleDozerUom('BCM/Jam'), true);
assert.strictEqual(isCompatibleDozerUom('Ton/Hr'), false);
assert.strictEqual(canShareDozerInArea([{ area: 'PIT 1' }, { area: 'pit 1' }], 'Pit 1'), true);
assert.strictEqual(canShareDozerInArea([{ area: 'PIT 1' }], 'PIT 2'), false, 'A dozer cannot support fleets in two areas on the same day');

const plannedTruck = { tipe_alat: 'CAT 777E', class_unit: 'DT 100 T' };
const compatiblePlan = {
  job: 'OB Removal',
  dumpTruckModel: 'cat 777e',
  dumpTruckClass: 'dt 100 t',
  dumpTruckUnit: plannedTruck,
};
assert.strictEqual(strictDumpTruckCompatibility({ kelas_alat: 'Dump Truck', tipe_alat: 'CAT 777E', class_unit: 'DT 100 T' }, compatiblePlan, 'OB Removal').ok, true);
const differentModel = strictDumpTruckCompatibility({ kelas_alat: 'Dump Truck', tipe_alat: 'HD 785', class_unit: 'DT 100 T' }, compatiblePlan, 'OB Removal');
assert.strictEqual(differentModel.ok, true, 'Same Class must be assignable even when the model differs');
assert.strictEqual(differentModel.modelWarning, true, 'Different model must remain visible as an operational warning');
const differentClassAndJob = strictDumpTruckCompatibility(
  { id: 'dt-free', kelas_alat: 'Dump Truck', tipe_alat: 'HD 785', class_unit: 'DT 60 T' },
  { ...compatiblePlan, dumpTruckIds: ['dt-planned'] },
  'Coal Getting',
);
assert.strictEqual(differentClassAndJob.ok, true, 'All Dump Trucks must be freely assignable across fleet JOB, Class, Model, and planning checklist');
assert.strictEqual(differentClassAndJob.classWarning, true, 'Class differences remain advisory only');
assert.strictEqual(differentClassAndJob.selectionWarning, true, 'Planning checklist differences remain advisory only');
assert.strictEqual(strictDumpTruckCompatibility({ kelas_alat: 'Excavator' }, compatiblePlan).ok, false, 'Non-Dump-Truck equipment must remain blocked');
assert.ok(dumpTruckGuidance({ dumpTruckUnit: plannedTruck }).includes('tidak membatasi plotting'));

assert.strictEqual(formatFleetClassLabel('EX 40T'), '40 T Class');
assert.strictEqual(formatFleetClassLabel('EXC 80 Ton'), '80 T Class');
const fleetClassSummary = summarizeFleetByClassAndJob([
  { plan: { type: 'ob', job: 'OB Removal', loaderCode: 'EX40999', loaderUnit: { class_unit: 'EX 40T' }, values: { material: 'CLAY' } } },
  { plan: { type: 'ob', job: 'OB Removal', loaderCode: 'EX40999', loaderUnit: { class_unit: 'EX 40T' }, values: { material: 'PASIR' } } },
  { plan: { type: 'ob', job: 'OB Removal', loaderCode: 'EX80', loaderUnit: { class_unit: 'EX 80T' }, values: { material: 'SOIL' } } },
  { plan: { type: 'coal', job: 'Coal Getting', loaderCode: 'EXC-02', loaderUnit: { class_unit: 'EX 80T' }, values: { material: 'seam 1' } } },
]);
assert.deepStrictEqual(fleetClassSummary.OB, [
  { classLabel: '40 T Class', count: 1 },
  { classLabel: '80 T Class', count: 1 },
], 'Same loader, JOB, and Class with different materials must count as one fleet');
assert.deepStrictEqual(fleetClassSummary.CG, [{ classLabel: '80 T Class', count: 1 }]);

const source = fs.readFileSync(path.join(__dirname, 'unitMapping.core.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
assert.match(source, /class="um-truck-drop-pocket" data-unit-drop="fleet"/, 'Every active fleet must expose a dedicated Dump Truck drop column');
assert.match(source, /Drag Dump Truck ke kolom ini/, 'Empty Dump Truck column must give visible drag guidance');
assert.match(source, /class="um-loader-anchor"/, 'Loader anchor must be visually separated from the Dump Truck drop column');
assert.match(styles, /\.um-truck-drop-pocket\.is-drag-over/, 'Dedicated Dump Truck column must expose drag-over feedback');

console.log('unitMapping tests passed');
