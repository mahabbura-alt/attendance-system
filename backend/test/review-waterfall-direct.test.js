const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/services/reviewWaterfall');
const U = require('../src/services/reviewUaImpact');
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);
test('owner example: 8h plan, 7h actual, 150 BCM/h gives +150 and unchanged parameter gives zero', () => {
  const cell = W.calculateCell({availablePlanHours:20,delayPlanHours:8,productivityPlan:150,hmActual:8,standbyActual:7,actualProduction:1200});
  assert.equal(cell.dpua,150);
  assert.equal(cell.dppa,-750);
  near(cell.plan+cell.dppa+cell.dpua+cell.dProd,1200);
  const detail=U.buildUaCellImpact({productivityPlan:150,standbyActualHours:7,
    planItems:[{key:'S01',rawHours:5},{key:'S10',rawHours:3}],actualItems:[{key:'S01',hours:4},{key:'S10',hours:3}],authoritativeDelta:150});
  assert.equal(detail.items[1].impact,0);
  assert.equal(detail.total,150);
});
test('invalid input and impossible SPO delay are not fabricated as zero',()=>{
  const base={availablePlanHours:20,delayPlanHours:8,productivityPlan:150,hmActual:8,standbyActual:7,actualProduction:1200};
  for(const patch of [{delayPlanHours:21},{hmActual:null},{productivityPlan:0},{standbyActual:-1}]) assert.equal(W.calculateCell({...base,...patch}),null);
});
test('10000 varying cells close main waterfall and PA detail without residual assignment',()=>{
  let seed=19; const rand=()=>{seed=seed*48271%2147483647;return seed/2147483647;};
  for(let i=0;i<10000;i++){
    const a=24*rand(), s=a*rand(), h=10*rand(), d=10*rand(), bd=4*rand(), q=500*rand()+1,v=5000*rand();
    const cell=W.calculateCell({availablePlanHours:a,delayPlanHours:s,productivityPlan:q,hmActual:h,standbyActual:d,actualProduction:v});
    near(cell.plan+cell.dppa+cell.dpua+cell.dProd,v);
    near(cell.dpua,(s-d)*q);
    const pa=W.aggregatePa(W.paItems({scheduleHours:24,availablePlanHours:a,hmActual:h,standbyActual:d,breakdownActual:bd,productivityPlan:q,actualItems:[{description:'Engine',hours:bd}],unit:'EX'}),cell.dppa);
    assert.equal(pa.reconciled,true); near(pa.total,cell.dppa);
  }
});
