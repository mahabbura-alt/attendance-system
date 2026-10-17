'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');
const S=require('../src/services/logistics');
const {redact}=require('../src/services/logisticsRead');
test('logistics quantities reject missing, negative, nonfinite and duplicate item rows',()=>{
  const item=randomUUID();const doc={kind:'issue',document_date:'2026-10-04',lines:[{item_id:item,quantity:2}]};
  assert.equal(S.validateDocument(doc).lines[0].quantity,2);
  for(const quantity of ['',null,-1,'NaN',Infinity])assert.throws(()=>S.validateDocument({...doc,lines:[{item_id:item,quantity}]}));
  assert.throws(()=>S.validateDocument({...doc,lines:[...doc.lines,...doc.lines]}),/duplikat/);
  assert.throws(()=>S.validateDocument({...doc,document_date:'2026-02-30'}),/Tanggal/);
});
test('logistics roles deny warehouse posting to requester and cost is removed recursively',()=>{
  assert.throws(()=>S.allow({role:'requester'},'warehouse'),{statusCode:403});
  assert.throws(()=>S.allow({role:'auditor'},'approve'),{statusCode:403});
  S.allow({role:'storekeeper'},'warehouse');
  assert.deepEqual(redact({stock_value:100,rows:[{unit_cost:10,quantity:3}],value:9},{role:'requester'}),{rows:[{quantity:3}]});
});
test('logistics catalog requires explicit base unit and validates policy',()=>{
  assert.throws(()=>S.validateMaster({kind:'item',code:'a',name:'b',data:{}}),/Satuan/);
  assert.throws(()=>S.validateMaster({kind:'item',code:'a',name:'b',data:{uom:'pcs',policy:'guess'}}),/Kebijakan/);
  assert.equal(S.validateMaster({kind:'item',code:' of-1 ',name:'Oil Filter',data:{uom:'pcs'}}).code,'OF-1');
});
