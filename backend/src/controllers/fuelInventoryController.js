'use strict';

/** HTTP tipis untuk Database Fuel P1 — seluruh aturan di services/fuelInventory. */
const fuelInventory = require('../services/fuelInventory');

const kirim = (res, janji) => janji
  .then(data => res.json(data))
  .catch(err => res.status(err.status || 500).json({ error: err.message, ...(err.details ? { code: err.code, details: err.details } : {}) }));

const aktor = req => (req.user && req.user.id) || null;

async function daftarProduk(req, res) { return kirim(res, fuelInventory.listProducts()); }
async function simpanProduk(req, res) {
  return kirim(res, fuelInventory.saveProduct({ ...(req.body || {}), id: req.params.id || req.body?.id }, aktor(req)));
}
async function daftarLokasi(req, res) { return kirim(res, fuelInventory.listLocations()); }
async function simpanLokasi(req, res) {
  return kirim(res, fuelInventory.saveLocation({ ...(req.body || {}), id: req.params.id || req.body?.id }, aktor(req)));
}
async function daftarTransaksi(req, res) {
  return kirim(res, fuelInventory.getLedger({
    dari: req.query.dari || req.query.tanggal_dari || null,
    sampai: req.query.sampai || req.query.tanggal_sampai || null,
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
    type: req.query.type || null,
    status: req.query.status || null,
    search: req.query.search || req.query.q || null,
    limit: req.query.limit || 200,
    offset: req.query.offset || 0,
  }));
}
async function buatDraf(req, res) { return kirim(res, fuelInventory.createDraft(req.body || {}, aktor(req), req.user)); }
async function posting(req, res) { return kirim(res, fuelInventory.postTransaction(req.params.id, aktor(req))); }
async function reversal(req, res) {
  return kirim(res, fuelInventory.reverseTransaction(req.params.id, aktor(req), req.body?.reason || ''));
}
async function batalDraf(req, res) { return kirim(res, fuelInventory.voidDraft(req.params.id, aktor(req), req.body?.reason || null)); }
async function validasiTransfer(req, res) { return kirim(res, fuelInventory.postTransferGroup(req.params.groupId, aktor(req))); }
async function tolakTransfer(req, res) { return kirim(res, fuelInventory.voidTransferGroup(req.params.groupId, aktor(req), req.body?.reason)); }
async function saldo(req, res) {
  return kirim(res, fuelInventory.getBalance({
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
  }).then(balance => ({ balance })));
}
async function daftarMapping(req, res) { return kirim(res, fuelInventory.listMappings()); }
async function simpanMapping(req, res) {
  return kirim(res, fuelInventory.saveMapping({ ...(req.body || {}), id: req.params.id || req.body?.id }, aktor(req)));
}
async function tautkanIssue(req, res) {
  return kirim(res, fuelInventory.linkIssue(req.body || {}, aktor(req)));
}
async function sinkronkanAntrean(req, res) {
  return kirim(res, fuelInventory.syncUnlinkedFuelLogs({ limit: req.body?.limit || 200 }, aktor(req)));
}
async function transfer(req, res) {
  return kirim(res, fuelInventory.transferStock(req.body || {}, aktor(req), req.user));
}
async function lapisanFifo(req, res) {
  return kirim(res, fuelInventory.getFifoLayers({
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
    status: req.query.status || 'open',
  }));
}
async function alokasi(req, res) {
  return kirim(res, fuelInventory.getAllocations({
    outbound_line_id: req.query.outbound_line_id || null,
    transaction_id: req.query.transaction_id || null,
  }));
}
async function rekonsiliasi(req, res) {
  return kirim(res, fuelInventory.getReconciliation({ limit: req.query.limit || 200 }));
}
async function buatOpname(req, res) { return kirim(res, fuelInventory.createOpname(req.body || {}, aktor(req), req.user)); }
async function ubahOpname(req, res) {
  return kirim(res, fuelInventory.updateOpnameDraft(req.params.id, req.body || {}, aktor(req)));
}
async function daftarOpname(req, res) {
  return kirim(res, fuelInventory.listOpnames({
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
    status: req.query.status || null,
    limit: req.query.limit || 200,
  }));
}
async function detailOpname(req, res) { return kirim(res, fuelInventory.getOpname(req.params.id)); }
async function kirimOpname(req, res) { return kirim(res, fuelInventory.submitOpname(req.params.id, aktor(req))); }
async function setujuiOpname(req, res) {
  return kirim(res, fuelInventory.approveOpname(req.params.id, aktor(req), req.body || {}));
}
async function tolakOpname(req, res) {
  return kirim(res, fuelInventory.rejectOpname(req.params.id, aktor(req), req.body?.reason || ''));
}

async function ringkasanStok(req, res) {
  return kirim(res, fuelInventory.getStockSummary({
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
  }));
}
async function arusHarian(req, res) {
  return kirim(res, fuelInventory.getFlowSeries({
    dari: req.query.dari || null,
    sampai: req.query.sampai || null,
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
  }));
}
async function statistikPakai(req, res) {
  return kirim(res, fuelInventory.getUsageStats({
    dari: req.query.dari || null,
    sampai: req.query.sampai || null,
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
  }));
}
async function rekonsiliasiPeriode(req, res) {
  return kirim(res, fuelInventory.getPeriodReconciliation({
    dari: req.query.dari || null,
    sampai: req.query.sampai || null,
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
  }));
}
async function rincianKonsumsi(req, res) {
  return kirim(res, fuelInventory.getConsumptionBreakdown({
    dari: req.query.dari || null,
    sampai: req.query.sampai || null,
    location_id: req.query.location_id || null,
    product_id: req.query.product_id || null,
    group: req.query.group === 'class' ? 'class' : 'unit',
    limit: req.query.limit || 10,
  }));
}
async function ekspor(req, res) {
  try {
    const data = await fuelInventory.buildExport({
      type: req.query.type || 'ledger',
      dari: req.query.dari || null,
      sampai: req.query.sampai || null,
      location_id: req.query.location_id || null,
      product_id: req.query.product_id || null,
      status: req.query.status || null,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
    return res.send(data.csv);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
}
async function laporanIntegritas(req, res) {
  return kirim(res, fuelInventory.getIntegrityReport({ limit: req.query.limit || 50 }));
}

module.exports = {
  daftarProduk, simpanProduk, daftarLokasi, simpanLokasi,
  daftarMapping, simpanMapping, tautkanIssue, rekonsiliasi, sinkronkanAntrean,
  daftarTransaksi, buatDraf, posting, reversal, batalDraf, saldo,
  transfer, validasiTransfer, tolakTransfer, lapisanFifo, alokasi,
  buatOpname, ubahOpname, daftarOpname, detailOpname, kirimOpname, setujuiOpname, tolakOpname,
  ringkasanStok, arusHarian, statistikPakai, ekspor, laporanIntegritas,
  rekonsiliasiPeriode, rincianKonsumsi,
};
