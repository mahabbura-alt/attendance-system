const express = require('express');
const router = express.Router();
const FuelInventoryController = require('../controllers/fuelInventoryController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Database Fuel P1: master + ledger. Admin only, mengikuti pola production.routes.
router.use(requireAuth, requireAdmin);

router.get('/products', FuelInventoryController.daftarProduk);
router.post('/products', FuelInventoryController.simpanProduk);
router.patch('/products/:id', FuelInventoryController.simpanProduk);

router.get('/locations', FuelInventoryController.daftarLokasi);
router.post('/locations', FuelInventoryController.simpanLokasi);
router.patch('/locations/:id', FuelInventoryController.simpanLokasi);

router.get('/transactions', FuelInventoryController.daftarTransaksi);
router.post('/transactions', FuelInventoryController.buatDraf);
router.post('/transactions/:id/post', FuelInventoryController.posting);
router.post('/transactions/:id/reverse', FuelInventoryController.reversal);
router.post('/transactions/:id/void', FuelInventoryController.batalDraf);

router.get('/balance', FuelInventoryController.saldo);

router.get('/mappings', FuelInventoryController.daftarMapping);
router.post('/mappings', FuelInventoryController.simpanMapping);
router.patch('/mappings/:id', FuelInventoryController.simpanMapping);

router.post('/issues/link', FuelInventoryController.tautkanIssue);
router.get('/reconciliation', FuelInventoryController.rekonsiliasi);
router.post('/reconciliation/sync', FuelInventoryController.sinkronkanAntrean);

router.post('/transfers', FuelInventoryController.transfer);
router.post('/transfers/:groupId/post', FuelInventoryController.validasiTransfer);
router.post('/transfers/:groupId/void', FuelInventoryController.tolakTransfer);
router.get('/fifo-layers', FuelInventoryController.lapisanFifo);
router.get('/allocations', FuelInventoryController.alokasi);

router.post('/opnames', FuelInventoryController.buatOpname);
router.get('/opnames', FuelInventoryController.daftarOpname);
router.get('/opnames/:id', FuelInventoryController.detailOpname);
router.put('/opnames/:id', FuelInventoryController.ubahOpname);
router.post('/opnames/:id/submit', FuelInventoryController.kirimOpname);
router.post('/opnames/:id/approve', FuelInventoryController.setujuiOpname);
router.post('/opnames/:id/reject', FuelInventoryController.tolakOpname);

router.get('/stock-summary', FuelInventoryController.ringkasanStok);
router.get('/flow-series', FuelInventoryController.arusHarian);
router.get('/usage-stats', FuelInventoryController.statistikPakai);
router.get('/export', FuelInventoryController.ekspor);
router.get('/integrity-report', FuelInventoryController.laporanIntegritas);

module.exports = router;
