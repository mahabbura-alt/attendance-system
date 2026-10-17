'use strict';
const express=require('express');
const {pool}=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const service=require('../services/logistics');
const read=require('../services/logisticsRead');
const router=express.Router();
router.use(requireAuth);
const handle=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){
  if(e.code==='42P01') return res.status(503).json({error:'LOGISTIK belum diaktifkan. Migration 062 diperlukan.',code:'MIGRATION_REQUIRED'});
  if(e.code==='23505') return res.status(409).json({error:'Kode atau serial sudah digunakan.'});
  if(e.statusCode) return res.status(e.statusCode).json({error:e.message}); next(e);
}};
router.get('/scopes',handle(async req=>(await pool.query('SELECT tenant_key,project_key,role FROM logistics_memberships WHERE user_id=$1 ORDER BY tenant_key,project_key',[req.user.id])).rows));
router.use(async(req,res,next)=>{
  try {
    if(req.body?.expected_actor_id && req.body.expected_actor_id!==req.user.id)return res.status(409).json({error:'Draft berasal dari akun berbeda. Masuk dengan akun pembuat draft.'});
    const rows=(await pool.query('SELECT * FROM logistics_memberships WHERE user_id=$1 AND tenant_key=$2 AND project_key=$3',[req.user.id,req.query.tenant||'default',req.query.project||'default'])).rows;
    if(!rows[0]) return res.status(403).json({error:'Project LOGISTIK tidak tersedia untuk akun Anda.'});
    req.logisticsScope={...rows[0],legacy_fuel:rows[0].tenant_key==='default'&&rows[0].project_key==='default'&&req.user.role==='admin'&&(req.user.is_super_admin||req.user.permissions?.includes('produksi'))}; next();
  }catch(e){if(e.code==='42P01')return res.status(503).json({error:'LOGISTIK belum diaktifkan. Migration 062 diperlukan.',code:'MIGRATION_REQUIRED'});next(e);}
});
router.get('/dashboard',handle(req=>read.dashboard(pool,req.logisticsScope,req.query)));
router.get('/maintenance',handle(req=>read.maintenance(pool,req.logisticsScope)));
router.get('/members',handle(async req=>{
  service.allow(req.logisticsScope,'master');
  return (await pool.query('SELECT m.user_id,m.role,u.nama,u.email FROM logistics_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_key=$1 AND m.project_key=$2 ORDER BY u.nama',service.scopeArgs(req.logisticsScope))).rows;
}));
router.post('/members',handle(async req=>{
  service.allow(req.logisticsScope,'master');
  if(!req.user.is_super_admin)service.fail('Hanya Admin Utama dapat mengatur akses project.',403);
  if(!Object.hasOwn(service.ROLES,req.body.role))service.fail('Peran tidak valid.');
  return service.transact(pool,req.logisticsScope,req.body.request_key,{route:'member',...req.body},async db=>{
    const user=(await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND is_active=TRUE',[String(req.body.email||'').trim()])).rows[0];
    if(!user)service.fail('Akun aktif tidak ditemukan.',404);
    if(user.id===req.user.id)service.fail('Peran akun sendiri tidak dapat diturunkan melalui form ini.');
    const args=[...service.scopeArgs(req.logisticsScope),user.id];
    const before=(await db.query('SELECT role FROM logistics_memberships WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3',args)).rows[0]||null;
    await db.query('INSERT INTO logistics_memberships(tenant_key,project_key,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,tenant_key,project_key) DO UPDATE SET role=EXCLUDED.role',[...args,req.body.role]);
    await db.query('INSERT INTO logistics_audit(tenant_key,project_key,actor_id,entity_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',[...service.scopeArgs(req.logisticsScope),req.user.id,user.id,'membership.change',before,{role:req.body.role}]);
    return {user_id:user.id,role:req.body.role};
  });
}));
router.get('/documents/:id',handle(req=>read.detail(pool,req.logisticsScope,req.params.id)));
router.post('/masters',handle(req=>service.transact(pool,req.logisticsScope,req.body.request_key,{route:'master',...req.body},db=>service.saveMaster(db,req.logisticsScope,req.body))));
router.post('/layers/:id/quality',handle(req=>service.transact(pool,req.logisticsScope,req.body.request_key,{route:req.params.id,...req.body},db=>service.quality(db,req.logisticsScope,req.params.id,req.body))));
router.post('/documents',handle(req=>service.transact(pool,req.logisticsScope,req.body.request_key,{route:'document',...req.body},db=>service.saveDocument(db,req.logisticsScope,req.body))));
router.post('/documents/:id/actions',handle(req=>service.transact(pool,req.logisticsScope,req.body.request_key,{route:req.params.id,...req.body},db=>service.transition(db,req.logisticsScope,req.params.id,req.body))));
module.exports=router;
