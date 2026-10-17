'use strict';
const {scopeArgs,ROLES,getDocument,fail}=require('./logistics');
function redact(value,scope) {
  if(ROLES[scope.role]?.includes('cost')) return value;
  if(Array.isArray(value)) return value.map(v=>redact(v,scope));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!['unit_cost','stock_value','value','purchase_value'].includes(k)).map(([k,v])=>[k,redact(v,scope)]));
  return value;
}
async function dashboard(db,scope,filter={}) {
  const args=scopeArgs(scope);
  const masters=(await db.query('SELECT * FROM logistics_masters WHERE tenant_key=$1 AND project_key=$2 ORDER BY kind,code',args)).rows;
  const documents=(await db.query(`SELECT d.*,COALESCE((SELECT SUM(l.quantity*l.unit_cost) FROM logistics_lines l WHERE l.document_id=d.id),0) AS purchase_value,
    (SELECT COUNT(*)::int FROM logistics_lines l WHERE l.document_id=d.id) AS line_count
    FROM logistics_documents d WHERE tenant_key=$1 AND project_key=$2 ORDER BY created_at DESC LIMIT 1000`,args)).rows;
  const stocks=(await db.query(`SELECT i.id AS item_id,i.code,i.name,i.data AS item_data,w.id AS warehouse_id,w.name AS warehouse,
    COALESCE(SUM(l.remaining),0)::float AS on_hand,
    COALESCE(SUM(l.remaining) FILTER(WHERE l.condition='good' AND (l.expiry IS NULL OR l.expiry>=CURRENT_DATE)),0)::float AS usable,
    COALESCE(SUM(l.remaining) FILTER(WHERE l.condition<>'good'),0)::float AS quarantine,
    COALESCE(SUM(l.remaining) FILTER(WHERE l.expiry<CURRENT_DATE),0)::float AS expired,
    COALESCE(SUM(l.remaining*l.unit_cost) FILTER(WHERE i.data->>'ownership'='owned'),0)::float AS stock_value,
    COALESCE((SELECT SUM(r.remaining) FROM logistics_reservations r WHERE r.tenant_key=$1 AND r.project_key=$2 AND r.item_id=i.id AND r.warehouse_id=w.id),0)::float AS reserved
    FROM logistics_masters i CROSS JOIN logistics_masters w
    LEFT JOIN logistics_layers l ON l.tenant_key=$1 AND l.project_key=$2 AND l.item_id=i.id AND l.warehouse_id=w.id
    WHERE i.tenant_key=$1 AND i.project_key=$2 AND i.kind='item' AND i.active=TRUE AND w.tenant_key=$1 AND w.project_key=$2 AND w.kind='warehouse' AND w.active=TRUE
    GROUP BY i.id,w.id ORDER BY i.code,w.code`,args)).rows.map(row=>({...row,available:row.usable-row.reserved,reorder:Math.max(0,Number(row.item_data.min_stock||0)-(row.usable-row.reserved))}));
  const layers=(await db.query(`SELECT l.*,i.code,i.name,i.data AS item_data,w.name AS warehouse, d.number AS receipt_number,
    EXTRACT(DAY FROM now()-l.received_at)::int AS age_days,
    EXTRACT(DAY FROM now()-GREATEST(l.received_at,COALESCE((SELECT MAX(m.created_at) FROM logistics_movements m JOIN logistics_documents md ON md.id=m.document_id JOIN logistics_layers ml ON ml.id=m.layer_id WHERE m.tenant_key=l.tenant_key AND m.project_key=l.project_key AND ml.item_id=l.item_id AND ml.warehouse_id=l.warehouse_id AND m.quantity<0 AND md.kind='issue'),l.received_at)))::int AS idle_days
    FROM logistics_layers l JOIN logistics_masters i ON i.id=l.item_id JOIN logistics_masters w ON w.id=l.warehouse_id
    JOIN logistics_lines dl ON dl.id=l.line_id JOIN logistics_documents d ON d.id=dl.document_id
    WHERE l.tenant_key=$1 AND l.project_key=$2 AND l.remaining>0 ORDER BY l.received_at LIMIT 2000`,args)).rows.map(l=>({...l,stock_class:l.idle_days>=Number(l.item_data.dead_days||180)?'Dead stock':l.idle_days>=Number(l.item_data.slow_days||90)?'Slow moving':'Aktif'}));
  const integrity=(await db.query(`SELECT l.id,i.code,l.remaining,COALESCE(SUM(m.quantity),0) AS ledger_quantity
    FROM logistics_layers l JOIN logistics_masters i ON i.id=l.item_id LEFT JOIN logistics_movements m ON m.layer_id=l.id
    WHERE l.tenant_key=$1 AND l.project_key=$2 GROUP BY l.id,i.code HAVING l.remaining<>COALESCE(SUM(m.quantity),0)`,args)).rows;
  const supplierReview=(await db.query(`SELECT s.id,s.name,
    COUNT(DISTINCT d.id) FILTER(WHERE d.kind='po' AND d.status='posted')::int AS orders,
    COUNT(DISTINCT r.id) FILTER(WHERE r.status='posted')::int AS receipts,
    COUNT(DISTINCT r.id) FILTER(WHERE r.status='posted' AND r.document_date<=d.due_date)::int AS on_time,
    COUNT(DISTINCT r.id) FILTER(WHERE r.status='posted' AND d.due_date IS NOT NULL)::int AS measured_receipts
    FROM logistics_masters s LEFT JOIN logistics_documents d ON d.supplier_id=s.id AND d.kind='po'
    LEFT JOIN logistics_documents r ON r.source_id=d.id AND r.kind='receipt'
    WHERE s.tenant_key=$1 AND s.project_key=$2 AND s.kind='supplier' GROUP BY s.id ORDER BY s.name`,args)).rows;
  const poProgress=(await db.query(`WITH ordered AS (
    SELECT d.id,l.item_id,SUM(l.quantity) AS qty FROM logistics_documents d JOIN logistics_lines l ON l.document_id=d.id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='po' AND d.status='posted' GROUP BY d.id,l.item_id
  ), received AS (
    SELECT d.source_id,l.item_id,SUM(l.quantity) AS qty FROM logistics_documents d JOIN logistics_lines l ON l.document_id=d.id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='receipt' AND d.status='posted' GROUP BY d.source_id,l.item_id
  ) SELECT o.id,COUNT(*)::int AS ordered_items,COUNT(*) FILTER(WHERE COALESCE(r.qty,0)>=o.qty)::int AS fulfilled_items
    FROM ordered o LEFT JOIN received r ON r.source_id=o.id AND r.item_id=o.item_id GROUP BY o.id`,args)).rows;
  const dateString=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const d of documents) {
    const p=poProgress.find(p=>p.id===d.id); if(p) d.fulfillment=p;
    d.document_date=dateString(d.document_date); d.due_date=d.due_date?dateString(d.due_date):null;
    d.overdue=Boolean(d.kind==='po'&&d.status==='posted'&&d.due_date&&d.due_date<today&&p&&p.fulfilled_items<p.ordered_items);
  }
  const totals=(await db.query(`SELECT COUNT(*) FILTER(WHERE status='submitted')::int AS pending,COUNT(*) FILTER(WHERE status='dispatched')::int AS transit FROM logistics_documents WHERE tenant_key=$1 AND project_key=$2`,args)).rows[0];
  const overdue=(await db.query(`SELECT COUNT(*)::int AS qty FROM logistics_documents d WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='po' AND d.status='posted' AND d.due_date<CURRENT_DATE AND EXISTS(
    SELECT 1 FROM logistics_lines l WHERE l.document_id=d.id GROUP BY l.item_id HAVING SUM(l.quantity)>COALESCE((SELECT SUM(rl.quantity) FROM logistics_documents rd JOIN logistics_lines rl ON rl.document_id=rd.id WHERE rd.source_id=d.id AND rd.kind='receipt' AND rd.status='posted' AND rl.item_id=l.item_id),0))`,args)).rows[0];
  const visibleStocks=filter.warehouse ? stocks.filter(s=>s.warehouse_id===filter.warehouse):stocks;
  const consumption=(await db.query(`SELECT l.item_id,d.warehouse_id,SUM(l.quantity)::float AS quantity_30d,
    MAX(d.document_date) AS last_issue FROM logistics_documents d JOIN logistics_lines l ON l.document_id=d.id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='issue' AND d.status='posted' AND d.document_date BETWEEN CURRENT_DATE-29 AND CURRENT_DATE
    GROUP BY l.item_id,d.warehouse_id`,args)).rows;
  const incoming=(await db.query(`WITH ordered AS (
    SELECT p.id,p.warehouse_id,l.item_id,SUM(l.quantity) AS qty FROM logistics_documents p JOIN logistics_lines l ON l.document_id=p.id
    WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.kind='po' AND p.status='posted' GROUP BY p.id,p.warehouse_id,l.item_id
  ), received AS (
    SELECT r.source_id,l.item_id,SUM(l.quantity) AS qty FROM logistics_documents r JOIN logistics_lines l ON l.document_id=r.id
    WHERE r.tenant_key=$1 AND r.project_key=$2 AND r.kind='receipt' AND r.status='posted' GROUP BY r.source_id,l.item_id
  ) SELECT o.warehouse_id,o.item_id,SUM(GREATEST(0,o.qty-COALESCE(r.qty,0)))::float AS quantity
    FROM ordered o LEFT JOIN received r ON r.source_id=o.id AND r.item_id=o.item_id GROUP BY o.warehouse_id,o.item_id`,args)).rows;
  const planning=visibleStocks.map(s=>{const usage=consumption.find(c=>c.item_id===s.item_id&&c.warehouse_id===s.warehouse_id);const adu=(usage?.quantity_30d||0)/30;const openPo=incoming.find(c=>c.item_id===s.item_id&&c.warehouse_id===s.warehouse_id)?.quantity||0;const target=Math.max(Number(s.item_data.min_stock||0),adu*Number(s.item_data.lead_days||0));return {...s,consumption_30d:usage?.quantity_30d||0,adu,reorder_point:target,open_po:openPo,suggested_qty:Math.max(0,target-s.available-openPo),days_cover:adu>0?s.available/adu:null};});
  const loans=(await db.query(`SELECT d.id,d.number,d.due_date,d.data,l.item_id,i.code,i.name,i.data AS item_data,SUM(l.quantity)::float AS issued,
    COALESCE((SELECT SUM(rl.quantity) FROM logistics_documents r JOIN logistics_lines rl ON rl.document_id=r.id WHERE r.source_id=d.id AND r.kind='tool_return' AND r.status='posted' AND rl.item_id=l.item_id),0)::float AS returned
    FROM logistics_documents d JOIN logistics_lines l ON l.document_id=d.id JOIN logistics_masters i ON i.id=l.item_id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.kind='loan' AND d.status='posted' GROUP BY d.id,l.item_id,i.id`,args)).rows;
  const quotes=(await db.query(`SELECT q.id,q.number,q.due_date,pr.number AS request_number,s.name AS supplier,i.code,i.name,i.data->>'uom' AS uom,l.quantity,l.unit_cost,
    l.quantity*l.unit_cost AS value FROM logistics_documents q JOIN logistics_lines l ON l.document_id=q.id JOIN logistics_masters i ON i.id=l.item_id
    JOIN logistics_masters s ON s.id=q.supplier_id LEFT JOIN logistics_documents pr ON pr.id=q.source_id
    WHERE q.tenant_key=$1 AND q.project_key=$2 AND q.kind='quote' AND q.status='posted' ORDER BY pr.number,i.code,l.unit_cost NULLS LAST LIMIT 1000`,args)).rows;
  return redact({scope:{tenant:scope.tenant_key,project:scope.project_key,user_id:scope.user_id,role:scope.role,capabilities:ROLES[scope.role],fuel_enabled:Boolean(scope.legacy_fuel)},
    masters,documents,stocks:visibleStocks,layers,integrity,supplierReview,planning,loans,quotes,
    counts:{critical:visibleStocks.filter(s=>s.item_data.critical&&s.available<=Number(s.item_data.min_stock||0)).length,
      pending:totals.pending,overdue:overdue.qty,
      transit:totals.transit,stock_value:visibleStocks.reduce((s,r)=>s+r.stock_value,0)},
    generated_at:new Date().toISOString(),limits:{documents:1000,layers:2000}},scope);
}
async function detail(db,scope,documentId) {
  const doc=await getDocument(db,scope,documentId);
  const events=(await db.query('SELECT action,before_data,after_data,created_at FROM logistics_audit WHERE tenant_key=$1 AND project_key=$2 AND entity_id=$3 ORDER BY id',[...scopeArgs(scope),documentId])).rows;
  const movements=(await db.query(`SELECT m.*,l.batch,l.serial,l.expiry,l.warehouse_id FROM logistics_movements m JOIN logistics_layers l ON l.id=m.layer_id WHERE m.tenant_key=$1 AND m.project_key=$2 AND m.document_id=$3 ORDER BY m.created_at`,[...scopeArgs(scope),documentId])).rows;
  return redact({...doc,events,movements},scope);
}
async function maintenance(db,scope) {
  if(scope.tenant_key!=='default'||scope.project_key!=='default') return {orders:[],notice:'Equipment legacy belum memiliki ownership project. Integrasi sumber ini dibatasi pada project legacy.'};
  const rows=(await db.query(`SELECT o.id,o.status,o.scheduled_date,e.kode_alat,i.item_code,i.item_name,i.uom,i.planned_qty,
    m.id AS item_id,m.data AS item_data
    FROM periodic_service_orders o JOIN equipment e ON e.id=o.equipment_id
    JOIN periodic_service_order_items i ON i.order_id=o.id AND i.item_type<>'task'
    LEFT JOIN logistics_masters m ON m.tenant_key=o.tenant_key AND m.project_key=o.project_key AND m.kind='item' AND m.active=TRUE AND UPPER(m.code)=UPPER(i.item_code)
    WHERE o.tenant_key=$1 AND o.project_key=$2 AND o.status IN ('scheduled','in_progress','awaiting_verification') ORDER BY o.scheduled_date,e.kode_alat`,scopeArgs(scope))).rows;
  const result=[];
  for(const row of rows) {
    const r=row.item_id ? await db.query(`SELECT COALESCE((SELECT SUM(remaining) FROM logistics_layers WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3 AND condition='good' AND (expiry IS NULL OR expiry>=CURRENT_DATE)),0)-COALESCE((SELECT SUM(remaining) FROM logistics_reservations WHERE tenant_key=$1 AND project_key=$2 AND item_id=$3),0) AS available`,[...scopeArgs(scope),row.item_id]):null;
    result.push({...row,available:r?Number(r.rows[0].available):null,mapped:Boolean(row.item_id && row.uom===row.item_data.uom)});
  }
  const breakdown=(await db.query(`SELECT p.id,p.breakdown_id,p.part_detail,p.po_number,p.quantity,p.po_status,p.eta_date,e.kode_alat
    FROM breakdown_parts p JOIN breakdown_logs b ON b.id=p.breakdown_id JOIN equipment e ON e.id=b.equipment_id
    WHERE p.deleted_at IS NULL AND b.deleted_at IS NULL AND b.status<>'resolved' AND p.po_status NOT IN ('arrived','cancelled') ORDER BY p.eta_date NULLS LAST,p.created_at`,[])).rows;
  return {orders:result,breakdown,notice:'Pencocokan kode barang + satuan persis. Ketersediaan per kebutuhan belum merupakan reservasi. Part Breakdown memerlukan pemilihan barang master secara eksplisit.'};
}
module.exports={dashboard,detail,maintenance,redact};
