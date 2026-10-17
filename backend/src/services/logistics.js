'use strict';

const { randomUUID, createHash } = require('crypto');
const ROLES = {
  requester: ['read','request'], storekeeper: ['read','warehouse'], buyer: ['read','purchase','cost'],
  approver: ['read','approve','cost'], manager: ['read','request','warehouse','purchase','approve','master','cost'], auditor: ['read','cost']
};
const TYPES = {
  request: 'request', pr: 'purchase', quote: 'purchase', po: 'purchase', shipment: 'purchase',
  opening: 'warehouse', receipt: 'warehouse', issue: 'warehouse', reservation: 'warehouse', transfer: 'warehouse',
  return: 'warehouse', supplier_return: 'warehouse', count: 'warehouse', adjustment: 'warehouse',
  loan: 'warehouse', tool_return: 'warehouse', component: 'warehouse'
};
const APPROVAL = new Set(['request','pr','po','opening','adjustment','count']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, statusCode=400) => { throw Object.assign(new Error(message), { statusCode }); };
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
function text(value, label, required=true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > 1000) fail(`${label} wajib diisi, maksimum 1.000 karakter.`);
  return result;
}
function number(value, label, zero=false) {
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < (zero ? 0 : 0.000001) || Number(value)>1e9) fail(`${label} tidak valid.`);
  return round(Number(value));
}
function date(value, label, required=true) {
  if (!value && !required) return null;
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10)!==s) fail(`${label} tidak valid.`);
  return s;
}
function id(value, label, required=false) {
  if (!value && !required) return null;
  if (!UUID.test(value || '')) fail(`${label} tidak valid.`);
  return value;
}
function allow(scope, permission) {
  if (!ROLES[scope.role]?.includes(permission)) fail('Anda tidak memiliki hak untuk tindakan ini.',403);
}
function validateMaster(body) {
  if (!['item','warehouse','supplier'].includes(body.kind)) fail('Jenis master tidak valid.');
  const data = body.data || {};
  const result = { kind: body.kind, code: text(body.code,'Kode').toUpperCase(), name: text(body.name,'Nama'), data: {} };
  if (body.kind==='item') {
    result.data = { uom: text(data.uom,'Satuan dasar'), category: text(data.category || 'Spare Part','Kategori'),
      part_number: text(data.part_number,'Part number',false), models: text(data.models,'Model kompatibel',false),
      critical: Boolean(data.critical), min_stock: number(data.min_stock ?? 0,'Minimum stok',true),
      lead_days: number(data.lead_days ?? 0,'Lead time',true), policy: data.policy || 'FIFO',
      serial_tracked: Boolean(data.serial_tracked), ownership: data.ownership || 'owned',
      slow_days:number(data.slow_days??90,'Batas slow-moving'),dead_days:number(data.dead_days??180,'Batas dead stock'),
      warranty_days:number(data.warranty_days??0,'Masa garansi',true),alternate_codes:text(data.alternate_codes,'Alternatif disetujui',false) };
    result.data.valuation_policy=result.data.policy==='FEFO'||result.data.serial_tracked?'specific_batch':'FIFO';
    if(result.data.dead_days<result.data.slow_days)fail('Batas dead stock harus ≥ slow-moving.');
    if (!['FIFO','FEFO'].includes(result.data.policy) || !['owned','consignment'].includes(result.data.ownership)) fail('Kebijakan stok tidak valid.');
  } else result.data = { address: text(data.address,'Alamat/rak',false), contact: text(data.contact,'Kontak',false),parent_id:body.kind==='warehouse'?id(data.parent_id,'Gudang induk'):null };
  return result;
}
function validateDocument(body) {
  if (!TYPES[body.kind]) fail('Jenis dokumen tidak valid.');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length>200) fail('Isi 1–200 baris barang.');
  const seen = new Set();
  const returnedItems=new Set();
  const lines = body.lines.map(line => {
    const itemId = id(line.item_id,'Barang',true);
    const serial = text(line.serial,'Serial',false) || null;
    if(['return','tool_return'].includes(body.kind)&&!serial){if(returnedItems.has(itemId))fail('Gabungkan retur barang non-serial menjadi satu baris per barang.');returnedItems.add(itemId);}
    const key = `${itemId}:${serial || ''}:${line.batch || ''}`;
    if (seen.has(key)) fail('Barang/batch/serial duplikat. Gabungkan kuantitas dalam satu baris.');
    seen.add(key);
    const condition = line.condition || 'good';
    if (!['good','quarantine','damaged'].includes(condition)) fail('Kondisi barang tidak valid.');
    return { item_id:itemId, quantity:number(line.quantity,'Kuantitas',body.kind==='count'),
      unit_cost:line.unit_cost==='' || line.unit_cost==null ? null : number(line.unit_cost,'Harga',true),
      batch:text(line.batch,'Batch',false)||null, serial, expiry:date(line.expiry,'Expiry',false), condition };
  });
  const data = body.data || {};
  return { kind:body.kind, document_date:date(body.document_date,'Tanggal'), due_date:date(body.due_date,'Tanggal kebutuhan/ETA',false),
    source_id:id(body.source_id,'Dokumen sumber'), warehouse_id:id(body.warehouse_id,'Gudang'),
    destination_id:id(body.destination_id,'Gudang tujuan'), supplier_id:id(body.supplier_id,'Supplier'),
    data:{ note:text(data.note,'Catatan',false), equipment_code:text(data.equipment_code,'Kode unit',false),
      work_order_id:id(data.work_order_id,'Work Order'), breakdown_part_id:id(data.breakdown_part_id,'Part Breakdown'),priority:data.priority==='urgent'?'urgent':'normal',
      reason:text(data.reason,'Alasan',false), component_status:text(data.component_status,'Status komponen',false),
      responsible:text(data.responsible,'Penanggung jawab',false),reference:text(data.reference,'Nomor referensi/garansi',false),
      warranty_until:date(data.warranty_until,'Garansi sampai',false) }, lines };
}
const scopeArgs = scope => [scope.tenant_key,scope.project_key];
async function master(db,scope,masterId,kind) {
  if (!masterId) fail(`${kind} wajib dipilih.`);
  const {rows} = await db.query('SELECT * FROM logistics_masters WHERE tenant_key=$1 AND project_key=$2 AND id=$3 AND kind=$4 AND active=TRUE',[...scopeArgs(scope),masterId,kind]);
  if (!rows[0]) fail(`${kind} tidak tersedia dalam project ini.`,404);
  return rows[0];
}
async function audit(db,scope,entityId,action,before,after) {
  await db.query('INSERT INTO logistics_audit(tenant_key,project_key,actor_id,entity_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',[...scopeArgs(scope),scope.user_id,entityId,action,before,after]);
}
async function transact(pool,scope,key,payload,work) {
  id(key,'ID permintaan',true);
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize a project's stock/doc mutations: deterministic FIFO and no double reservation.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`logistics:${scope.tenant_key}:${scope.project_key}`]);
    const old = await db.query('SELECT request_hash,response FROM logistics_idempotency WHERE tenant_key=$1 AND project_key=$2 AND actor_id=$3 AND request_key=$4',[...scopeArgs(scope),scope.user_id,key]);
    if (old.rows[0]) {
      if (old.rows[0].request_hash!==hash) fail('ID retry sudah dipakai untuk data berbeda.',409);
      await db.query('COMMIT'); return old.rows[0].response;
    }
    const result = await work(db);
    await db.query('INSERT INTO logistics_idempotency(tenant_key,project_key,actor_id,request_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[...scopeArgs(scope),scope.user_id,key,hash,result]);
    await db.query('COMMIT'); return result;
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
async function saveMaster(db,scope,body) {
  allow(scope,'master'); const input=validateMaster(body); let before=null;
  if(input.kind==='warehouse'&&input.data.parent_id){
    const parent=await master(db,scope,input.data.parent_id,'warehouse');
    if(parent.data.parent_id||body.id===parent.id)fail('Gudang induk harus lokasi utama dan tidak boleh menunjuk dirinya sendiri.');
  }
  if (body.id) {
    before = await master(db,scope,id(body.id,'ID',true),input.kind);
    if (Number(body.version)!==before.version) fail('Master telah berubah. Muat ulang.',409);
    if (input.kind==='item' && ['uom','policy','serial_tracked','ownership'].some(k=>input.data[k]!==before.data[k])) {
      const used=await db.query('SELECT 1 FROM logistics_lines WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 LIMIT 1',[...scopeArgs(scope),body.id]);
      if(used.rows.length) fail('Satuan, tracking, kepemilikan dan kebijakan barang yang sudah dipakai dikunci.');
    }
  }
  const result=before ? await db.query('UPDATE logistics_masters SET name=$4,data=$5,version=version+1 WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *',[...scopeArgs(scope),before.id,input.name,input.data])
    : await db.query('INSERT INTO logistics_masters(tenant_key,project_key,kind,code,name,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[...scopeArgs(scope),input.kind,input.code,input.name,input.data]);
  await audit(db,scope,result.rows[0].id,'master.save',before,result.rows[0]); return result.rows[0];
}
async function getDocument(db,scope,documentId) {
  const r=await db.query('SELECT * FROM logistics_documents WHERE tenant_key=$1 AND project_key=$2 AND id=$3',[...scopeArgs(scope),id(documentId,'Dokumen',true)]);
  if(!r.rows[0]) fail('Dokumen tidak ditemukan.',404);
  const lines=await db.query('SELECT l.*,m.code,m.name,m.data AS item_data FROM logistics_lines l JOIN logistics_masters m ON m.id=l.item_id AND m.tenant_key=l.tenant_key AND m.project_key=l.project_key WHERE l.tenant_key=$1 AND l.project_key=$2 AND l.document_id=$3 ORDER BY l.id',[...scopeArgs(scope),documentId]);
  return {...r.rows[0],lines:lines.rows};
}
async function saveDocument(db,scope,body) {
  const input=validateDocument(body); allow(scope,TYPES[input.kind]);
  const prior=body.id ? await getDocument(db,scope,id(body.id,'Dokumen',true)):null;
  if(prior && (prior.status!=='draft'||Number(body.version)!==prior.version||prior.kind!==input.kind)) fail('Hanya draft versi terakhir dengan jenis yang sama dapat diedit.',409);
  for(const field of ['warehouse_id','destination_id']) if(input[field]) await master(db,scope,input[field],'warehouse');
  if(input.supplier_id) await master(db,scope,input.supplier_id,'supplier');
  for(const line of input.lines) {
    const item=await master(db,scope,line.item_id,'item');
    if(item.data.serial_tracked && (!line.serial || line.quantity!==1)) fail(`${item.code}: serial wajib, kuantitas harus 1.`);
    if(input.kind==='count' && item.data.serial_tracked) fail('Opname serial dilakukan melalui rekonsiliasi per serial; form hitung agregat hanya untuk barang tanpa serial.');
    if(item.data.policy==='FEFO' && ['opening','receipt'].includes(input.kind) && !line.expiry) fail(`${item.code}: expiry wajib untuk FEFO.`);
  }
  if(input.source_id) await getDocument(db,scope,input.source_id);
  if(input.kind==='count') {
    await master(db,scope,input.warehouse_id,'warehouse');
    input.data.count_snapshot={};
    for(const line of input.lines) {
      if(line.batch || line.serial || line.condition!=='good') fail('Opname menghitung total barang good per gudang; kosongkan batch/serial.');
      if(Object.hasOwn(input.data.count_snapshot,line.item_id)) fail('Satu barang hanya boleh satu baris opname.');
      const balance=await db.query("SELECT COALESCE(SUM(remaining),0) AS qty FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND condition='good' AND (expiry IS NULL OR expiry>=CURRENT_DATE)",[...scopeArgs(scope),line.item_id,input.warehouse_id]);
      input.data.count_snapshot[line.item_id]=Number(balance.rows[0].qty);
    }
  }
  if(input.data.work_order_id) {
    // Legacy maintenance source has only compatibility scope; never expose it to another project.
    const order=await db.query('SELECT id FROM periodic_service_orders WHERE tenant_key=$1 AND project_key=$2 AND id=$3',[...scopeArgs(scope),input.data.work_order_id]);
    if(!order.rows.length) fail('Work Order tidak tersedia pada project ini.',404);
  }
  if(input.data.equipment_code && (scope.tenant_key!=='default'||scope.project_key!=='default')) fail('Equipment legacy belum mempunyai ownership project; gunakan referensi Work Order scoped.');
  if(input.data.breakdown_part_id){
    if(scope.tenant_key!=='default'||scope.project_key!=='default')fail('Breakdown legacy hanya tersedia pada project asal.',403);
    const part=await db.query('SELECT id FROM breakdown_parts WHERE id=$1 AND deleted_at IS NULL',[input.data.breakdown_part_id]);if(!part.rows.length)fail('Part Breakdown tidak ditemukan.',404);
  }
  const documentId=prior?.id||randomUUID(); const no=prior?.number||`${input.kind.toUpperCase()}-${input.document_date.replace(/-/g,'')}-${documentId.slice(0,8).toUpperCase()}`;
  if(input.source_id===documentId) fail('Dokumen tidak boleh merujuk dirinya sendiri.');
  const result=prior ? await db.query(`UPDATE logistics_documents SET source_id=$4,warehouse_id=$5,destination_id=$6,supplier_id=$7,document_date=$8,due_date=$9,data=$10,version=version+1,updated_at=now() WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *`,[...scopeArgs(scope),documentId,input.source_id,input.warehouse_id,input.destination_id,input.supplier_id,input.document_date,input.due_date,input.data])
    : await db.query(`INSERT INTO logistics_documents(id,tenant_key,project_key,kind,number,source_id,warehouse_id,destination_id,supplier_id,document_date,due_date,data,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[documentId,...scopeArgs(scope),input.kind,no,input.source_id,input.warehouse_id,input.destination_id,input.supplier_id,input.document_date,input.due_date,input.data,scope.user_id]);
  if(prior) await db.query('DELETE FROM logistics_lines WHERE tenant_key=$1 AND project_key=$2 AND document_id=$3',[...scopeArgs(scope),documentId]);
  for(const l of input.lines) await db.query(`INSERT INTO logistics_lines(tenant_key,project_key,document_id,item_id,quantity,unit_cost,batch,serial,expiry,condition)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...scopeArgs(scope),documentId,l.item_id,l.quantity,l.unit_cost,l.batch,l.serial,l.expiry,l.condition]);
  await audit(db,scope,documentId,prior?'document.edit':'document.create',prior,{...result.rows[0],lines:input.lines}); return result.rows[0];
}
async function available(db,scope,itemId,warehouseId,exceptReservation=null) {
  const result=await db.query(`SELECT
    COALESCE((SELECT SUM(remaining) FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND condition='good' AND (expiry IS NULL OR expiry>=CURRENT_DATE)),0)
    -COALESCE((SELECT SUM(remaining) FROM logistics_reservations WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND ($5::uuid IS NULL OR document_id<>$5::uuid)),0) AS quantity`,[...scopeArgs(scope),itemId,warehouseId,exceptReservation]);
  return Number(result.rows[0].quantity);
}
async function addLayer(db,scope,doc,line,quantity,cost,warehouse=doc.warehouse_id,origin={}) {
  if(cost==null) fail('Harga penerimaan wajib diisi untuk valuasi FIFO.');
  const r=await db.query(`INSERT INTO logistics_layers(tenant_key,project_key,item_id,warehouse_id,line_id,original_quantity,remaining,unit_cost,batch,serial,expiry,condition,received_at)
    VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now())) RETURNING id`,[...scopeArgs(scope),line.item_id,warehouse,line.id,quantity,cost,origin.batch ?? line.batch,origin.serial ?? line.serial,origin.expiry ?? line.expiry,origin.condition ?? line.condition,origin.received_at || null]);
  await db.query('INSERT INTO logistics_movements(tenant_key,project_key,document_id,line_id,layer_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)',[...scopeArgs(scope),doc.id,line.id,r.rows[0].id,quantity,cost]);
}
async function consume(db,scope,doc,line,quantity,reservation=null) {
  const isReturn=doc.kind==='supplier_return';
  if(!isReturn && await available(db,scope,line.item_id,doc.warehouse_id,reservation)+1e-6<quantity) fail(`${line.code}: stok tersedia tidak cukup (setelah reservasi).`,409);
  const r=await db.query(`SELECT l.*,
    COALESCE((SELECT SUM(r.remaining) FROM logistics_reservations r WHERE r.layer_id=l.id AND ($10::uuid IS NULL OR r.document_id<>$10::uuid)),0) AS other_reserved,
    COALESCE((SELECT SUM(r.remaining) FROM logistics_reservations r WHERE r.layer_id=l.id AND r.document_id=$10::uuid),0) AS own_reserved
    FROM logistics_layers l WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND remaining>0 AND condition=$8 AND ($9::boolean OR expiry IS NULL OR expiry>=CURRENT_DATE)
    AND ($5::text IS NULL OR serial=$5) AND ($6::text IS NULL OR batch=$6)
    AND ($11::uuid IS NULL OR l.line_id IN (SELECT id FROM logistics_lines WHERE document_id=$11::uuid))
    ORDER BY CASE WHEN $7='FEFO' THEN expiry END ASC NULLS LAST,received_at,id FOR UPDATE`,[...scopeArgs(scope),line.item_id,doc.warehouse_id,line.serial,line.batch,line.item_data.policy,isReturn?line.condition:'good',isReturn,reservation,isReturn?doc.source_id:null]);
  let remaining=quantity;
  for(const layer of r.rows) {
    if(remaining<=0) break;
    const qty=Math.min(remaining,Number(layer.remaining)-Number(layer.other_reserved),reservation?Number(layer.own_reserved):Infinity);
    if(qty<=0)continue;
    await db.query('UPDATE logistics_layers SET remaining=remaining-$2 WHERE id=$1',[layer.id,qty]);
    await db.query('INSERT INTO logistics_movements(tenant_key,project_key,document_id,line_id,layer_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)',[...scopeArgs(scope),doc.id,line.id,layer.id,-qty,layer.unit_cost]);
    remaining=round(remaining-qty);
    if(reservation)await db.query('UPDATE logistics_reservations SET remaining=remaining-$5 WHERE tenant_key=$1 AND project_key=$2 AND document_id=$3 AND layer_id=$4',[...scopeArgs(scope),reservation,layer.id,qty]);
  }
  if(remaining>0) fail(`${line.code}: batch/serial yang dipilih tidak cukup.`,409);
}
async function checkSourceQuantity(db,scope,doc,line,source,allowedKinds,statuses) {
  if(!source || !allowedKinds.includes(source.kind) || !statuses.includes(source.status)) fail(`Dokumen sumber harus ${allowedKinds.join('/')} dengan status ${statuses.join('/')}.`);
  const sourceQty=source.lines.filter(l=>l.item_id===line.item_id).reduce((s,l)=>s+Number(l.quantity),0);
  const result=await db.query(`SELECT COALESCE(SUM(l.quantity),0) AS used FROM logistics_lines l JOIN logistics_documents d ON d.id=l.document_id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.source_id=$3 AND l.item_id=$4 AND d.kind=$5 AND d.id<>$6 AND d.status IN ('posted','dispatched','received')`,[...scopeArgs(scope),source.id,line.item_id,doc.kind,doc.id]);
  const currentQty=doc.lines.filter(l=>l.item_id===line.item_id).reduce((s,l)=>s+Number(l.quantity),0);
  if(round((doc.kind==='quote'?0:Number(result.rows[0].used))+currentQty)>sourceQty) fail(`${line.code}: jumlah kumulatif melebihi dokumen sumber.`,409);
}
async function transition(db,scope,documentId,body) {
  const doc=await getDocument(db,scope,documentId); const action=body.action;
  if(Number(body.version)!==doc.version) fail('Dokumen telah berubah. Muat ulang sebelum melanjutkan.',409);
  let status;
  if(action==='update-delivery') {
    allow(scope,'purchase'); if(!['po','shipment'].includes(doc.kind)||doc.status!=='posted') fail('Hanya PO/pengiriman aktif dapat diperbarui.');
    const due=date(body.due_date,'ETA'); const reason=text(body.reason,'Alasan pembaruan ETA');
    const updated=await db.query('UPDATE logistics_documents SET due_date=$4,version=version+1,updated_at=now() WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *',[...scopeArgs(scope),doc.id,due]);
    await audit(db,scope,doc.id,action,doc,{...updated.rows[0],reason});return updated.rows[0];
  }
  if(action==='kit-ready'){
    allow(scope,'warehouse');if(doc.kind!=='reservation'||doc.status!=='posted')fail('Kitting memerlukan reservasi aktif.');
    const updated=await db.query("UPDATE logistics_documents SET data=jsonb_set(data,'{kit_status}','\"ready\"'),version=version+1,updated_at=now() WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *",[...scopeArgs(scope),doc.id]);
    await audit(db,scope,doc.id,action,doc,updated.rows[0]);return updated.rows[0];
  }
  if(action==='submit') {
    allow(scope,TYPES[doc.kind]); if(doc.status!=='draft') fail('Hanya draft dapat diajukan.'); status='submitted';
  } else if(action==='approve'||action==='reject') {
    allow(scope,'approve'); if(doc.status!=='submitted') fail('Dokumen belum diajukan.');
    if(doc.created_by===scope.user_id) fail('Persetujuan memerlukan pengguna lain.',403);
    if(action==='reject'&&!String(body.reason||'').trim()) fail('Alasan penolakan wajib diisi.');
    status=action==='approve'?'approved':'rejected';
  } else if(action==='cancel') {
    allow(scope,TYPES[doc.kind]); if(!['draft','submitted','approved','rejected'].includes(doc.status)) fail('Dokumen sudah efektif; gunakan transaksi koreksi.'); status='cancelled';
  } else if(action==='release') {
    allow(scope,'warehouse'); if(doc.kind!=='reservation'||doc.status!=='posted') fail('Reservasi tidak aktif.');
    await db.query('UPDATE logistics_reservations SET remaining=0 WHERE tenant_key=$1 AND project_key=$2 AND document_id=$3',[...scopeArgs(scope),doc.id]); status='closed';
  } else if(action==='receive') {
    allow(scope,'warehouse'); if(doc.kind!=='transfer'||doc.status!=='dispatched') fail('Transfer belum dalam perjalanan.');
    for(const line of doc.lines) {
      const moved=await db.query('SELECT m.quantity,m.unit_cost,l.* FROM logistics_movements m JOIN logistics_layers l ON l.id=m.layer_id WHERE m.tenant_key=$1 AND m.project_key=$2 AND m.document_id=$3 AND m.line_id=$4 AND m.quantity<0',[...scopeArgs(scope),doc.id,line.id]);
      for(const origin of moved.rows) await addLayer(db,scope,doc,line,-Number(origin.quantity),origin.unit_cost,doc.destination_id,origin);
    }
    status='received';
  } else if(action==='post') {
    allow(scope,TYPES[doc.kind]);
    if(doc.status!==(APPROVAL.has(doc.kind)?'approved':'draft')) fail(APPROVAL.has(doc.kind)?'Persetujuan diperlukan sebelum posting.':'Dokumen sudah diproses.');
    const source=doc.source_id ? await getDocument(db,scope,doc.source_id):null;
    const stockKinds=['opening','receipt','issue','reservation','transfer','return','supplier_return','count','adjustment','loan','tool_return'];
    if(stockKinds.includes(doc.kind)) await master(db,scope,doc.warehouse_id,'warehouse');
    const postedDate=doc.document_date instanceof Date?doc.document_date.toISOString().slice(0,10):String(doc.document_date).slice(0,10);
    const currentDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(stockKinds.includes(doc.kind)&&postedDate>currentDate)fail('Pergerakan stok tidak dapat diposting untuk tanggal di masa depan.');
    if(doc.kind==='transfer') {
      await master(db,scope,doc.destination_id,'warehouse'); if(doc.destination_id===doc.warehouse_id) fail('Gudang tujuan harus berbeda.');
    }
    if(['po','quote','shipment'].includes(doc.kind)) await master(db,scope,doc.supplier_id,'supplier');
    if(doc.kind==='po') await master(db,scope,doc.warehouse_id,'warehouse');
    if(['opening','adjustment'].includes(doc.kind)&&!doc.data.reason) fail('Alasan saldo awal/adjustment wajib diisi.');
    if(doc.kind==='component'&&!['installed','removed','repair','ready','scrapped'].includes(doc.data.component_status)) fail('Pilih status komponen.');
    if(doc.kind==='loan'&&(!doc.data.responsible||!doc.due_date))fail('Peminjaman wajib penanggung jawab dan tanggal pengembalian.');
    for(const line of doc.lines) {
      if(doc.kind==='component'){
        if(!line.serial||Number(line.quantity)!==1)fail('Komponen memerlukan serial unik dengan kuantitas 1.');
        const previous=(await db.query(`SELECT d.data FROM logistics_documents d JOIN logistics_lines l ON l.document_id=d.id WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='component' AND d.status='posted' AND l.item_id=$3 AND l.serial=$4 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,[...scopeArgs(scope),line.item_id,line.serial])).rows[0];
        const current=previous?.data.component_status||'ready';
        const allowed={ready:['installed','repair','scrapped'],installed:['removed'],removed:['repair','ready','scrapped'],repair:['ready','scrapped'],scrapped:[]};
        if(!allowed[current]?.includes(doc.data.component_status))fail(`Transisi komponen ${current} → ${doc.data.component_status} tidak valid.`);
        if(doc.data.component_status==='installed'){
          if(!doc.data.equipment_code)fail('Pemasangan komponen wajib kode unit.');
          if(!source||source.kind!=='issue'||source.status!=='posted'||!source.lines.some(l=>l.item_id===line.item_id&&l.serial===line.serial))fail('Pemasangan harus merujuk pengeluaran serial yang sama.');
        }
      }
      if(['opening','receipt','adjustment'].includes(doc.kind)) {
        if(doc.kind==='receipt') {
          await checkSourceQuantity(db,scope,doc,line,source,['po'],['posted']);
          if(source.warehouse_id && source.warehouse_id!==doc.warehouse_id)fail('Gudang penerimaan harus sesuai tujuan PO.');
          if(source.supplier_id && doc.supplier_id && source.supplier_id!==doc.supplier_id)fail('Supplier penerimaan tidak sesuai PO.');
        }
        if(line.serial){const known=await db.query('SELECT id FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND serial=$4 LIMIT 1',[...scopeArgs(scope),line.item_id,line.serial]);if(known.rows.length)fail('Serial sudah tercatat dalam histori. Gunakan pengembalian/transfer dengan dokumen sumber.',409);}
        await addLayer(db,scope,doc,line,Number(line.quantity),line.unit_cost);
      } else if(['issue','loan','transfer','supplier_return'].includes(doc.kind)) {
        if(doc.kind==='supplier_return') {
          await checkSourceQuantity(db,scope,doc,line,source,['receipt'],['posted']);
          if(source.warehouse_id!==doc.warehouse_id)fail('Retur supplier harus berasal dari gudang penerimaan sumber.');
        }
        if(doc.kind==='issue'&&source?.kind==='reservation'&&source.warehouse_id!==doc.warehouse_id) fail('Gudang issue tidak sesuai reservasi.');
        await consume(db,scope,doc,line,Number(line.quantity),source?.kind==='reservation'?source.id:null);
      } else if(doc.kind==='reservation') {
        if(await available(db,scope,line.item_id,doc.warehouse_id)<Number(line.quantity)) fail(`${line.code}: stok tidak cukup untuk reservasi.`,409);
        const layers=await db.query(`SELECT l.*,l.remaining-COALESCE((SELECT SUM(r.remaining) FROM logistics_reservations r WHERE r.layer_id=l.id),0) AS free
          FROM logistics_layers l WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND condition='good' AND remaining>0 AND (expiry IS NULL OR expiry>=CURRENT_DATE)
          AND ($5::text IS NULL OR serial=$5) AND ($6::text IS NULL OR batch=$6)
          ORDER BY CASE WHEN $7='FEFO' THEN expiry END NULLS LAST,received_at,id FOR UPDATE`,[...scopeArgs(scope),line.item_id,doc.warehouse_id,line.serial,line.batch,line.item_data.policy]);
        let remaining=Number(line.quantity);
        for(const layer of layers.rows){const qty=Math.min(remaining,Number(layer.free));if(qty>0){
          await db.query(`INSERT INTO logistics_reservations(tenant_key,project_key,document_id,item_id,warehouse_id,layer_id,remaining) VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(document_id,item_id,layer_id) DO UPDATE SET remaining=logistics_reservations.remaining+EXCLUDED.remaining`,[...scopeArgs(scope),doc.id,line.item_id,doc.warehouse_id,layer.id,qty]);remaining=round(remaining-qty);
        }if(!remaining)break;}
        if(remaining>0)fail('Batch/serial tidak cukup untuk reservasi.',409);
      } else if(['return','tool_return'].includes(doc.kind)) {
        await checkSourceQuantity(db,scope,doc,line,source,doc.kind==='tool_return'?['loan']:['issue'],['posted']);
        const sourceMoves=await db.query(`SELECT m.quantity,m.unit_cost,l.* FROM logistics_movements m JOIN logistics_layers l ON l.id=m.layer_id WHERE m.tenant_key=$1 AND m.project_key=$2 AND m.document_id=$3 AND l.item_id=$4 AND m.quantity<0 AND ($5::text IS NULL OR l.serial=$5) ORDER BY m.created_at,m.id`,[...scopeArgs(scope),source.id,line.item_id,line.serial]);
        const previous=await db.query(`SELECT COALESCE(SUM(rl.quantity),0) AS qty FROM logistics_documents r JOIN logistics_lines rl ON rl.document_id=r.id WHERE r.tenant_key=$1 AND r.project_key=$2 AND r.source_id=$3 AND r.kind=$4 AND r.status='posted' AND rl.item_id=$5 AND ($6::text IS NULL OR rl.serial=$6)`,[...scopeArgs(scope),source.id,doc.kind,line.item_id,line.serial]);
        let skip=Number(previous.rows[0].qty),remaining=Number(line.quantity);
        for(const origin of sourceMoves.rows){let qty=-Number(origin.quantity);const used=Math.min(skip,qty);skip=round(skip-used);qty=round(qty-used);const take=Math.min(qty,remaining);if(take>0){await addLayer(db,scope,doc,line,take,origin.unit_cost,doc.warehouse_id,{...origin,condition:line.condition});remaining=round(remaining-take);}if(!remaining)break;}
        if(remaining>0)fail('Qty/serial retur melebihi alokasi pengeluaran sumber.',409);
      } else if(doc.kind==='count') {
        const balance=await db.query(`SELECT COALESCE(SUM(remaining),0) AS qty FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND warehouse_id=$4 AND condition='good' AND (expiry IS NULL OR expiry>=CURRENT_DATE)`,[...scopeArgs(scope),line.item_id,doc.warehouse_id]);
        const delta=round(Number(line.quantity)-Number(balance.rows[0].qty));
        if(doc.data.count_snapshot?.[line.item_id]!==Number(balance.rows[0].qty)) fail('Stok berubah setelah snapshot opname. Buat ulang hitungan agar transaksi sela tidak tertimpa.',409);
        if(delta>0) await addLayer(db,scope,doc,line,delta,line.unit_cost);
        if(delta<0) await consume(db,scope,doc,line,-delta);
      } else if(doc.kind==='pr') await checkSourceQuantity(db,scope,doc,line,source,['request'],['posted']);
      else if(doc.kind==='po') {
        await checkSourceQuantity(db,scope,doc,line,source,['pr','quote'],['posted']);
        const pr=source.kind==='pr'?source:await getDocument(db,scope,source.source_id);
        const rootQty=pr.lines.filter(l=>l.item_id===line.item_id).reduce((sum,l)=>sum+Number(l.quantity),0);
        const committed=await db.query(`SELECT COALESCE(SUM(l.quantity),0) AS qty FROM logistics_documents p JOIN logistics_lines l ON l.document_id=p.id
          LEFT JOIN logistics_documents q ON q.id=p.source_id AND q.kind='quote'
          WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.kind='po' AND p.id<>$3 AND p.status='posted' AND l.item_id=$4 AND (p.source_id=$5 OR q.source_id=$5)`,[...scopeArgs(scope),doc.id,line.item_id,pr.id]);
        const qty=doc.lines.filter(l=>l.item_id===line.item_id).reduce((sum,l)=>sum+Number(l.quantity),0);
        if(Number(committed.rows[0].qty)+qty>rootQty)fail('Total PO dari seluruh penawaran melebihi PR asal.',409);
        if(line.unit_cost==null) fail('Harga PO wajib diisi.');
      } else if(doc.kind==='quote') await checkSourceQuantity(db,scope,doc,line,source,['pr'],['posted']);
      else if(doc.kind==='shipment') await checkSourceQuantity(db,scope,doc,line,source,['po'],['posted']);
    }
    status=doc.kind==='transfer'?'dispatched':'posted';
  } else fail('Aksi tidak dikenal.');
  const result=await db.query('UPDATE logistics_documents SET status=$4,version=version+1,updated_at=now() WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *',[...scopeArgs(scope),doc.id,status]);
  await audit(db,scope,doc.id,action,doc,{...result.rows[0],reason:body.reason||null}); return result.rows[0];
}
async function quality(db,scope,layerId,body){
  allow(scope,'warehouse'); const condition=body.condition;
  if(!['good','quarantine','damaged'].includes(condition))fail('Kondisi tidak valid.');
  const reason=text(body.reason,'Alasan QC');
  const r=await db.query('SELECT * FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND id=$3 AND remaining>0 FOR UPDATE',[...scopeArgs(scope),id(layerId,'Layer',true)]);
  const layer=r.rows[0];if(!layer)fail('Batch stok tidak ditemukan.',404);
  if(layer.condition==='good' && condition!=='good'){
    const reserved=await db.query('SELECT 1 FROM logistics_reservations WHERE layer_id=$1 AND remaining>0 LIMIT 1',[layer.id]);
    if(reserved.rows.length)fail('Lepaskan reservasi terkait sebelum mengarantina batch ini.',409);
  }
  const updated=await db.query('UPDATE logistics_layers SET condition=$4 WHERE tenant_key=$1 AND project_key=$2 AND id=$3 RETURNING *',[...scopeArgs(scope),layerId,condition]);
  await audit(db,scope,layerId,'quality.change',layer,{...updated.rows[0],reason});return {id:layerId,condition};
}
module.exports={ROLES,TYPES,APPROVAL,fail,round,allow,validateMaster,validateDocument,scopeArgs,transact,saveMaster,saveDocument,getDocument,transition,quality};
