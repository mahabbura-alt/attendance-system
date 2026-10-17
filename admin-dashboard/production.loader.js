/*
 * P1 Performance: modul Mining Production tidak lagi menjadi beban startup
 * untuk pengguna Absensi/HR. Semua dependency dimuat berurutan saat tab
 * produksi pertama kali dibuka sehingga kontrak global dashboard tetap sama.
 */
(function (global) {
  'use strict';

  const VERSION = '2';
  const productionModules = [
    'planProductivity.core.js?v=24',
    'planProductivity.workspace.js?v=8',
    'spo.core.js?v=56',
    'paUaEwh.core.js?v=19',
    'fuelBudgeting.core.js?v=5',
    'fleetCapacity.core.js?v=16',
    'fleetDeployment.core.js?v=3',
    'fleetDeployment.js?v=6',
    'unitMapping.core.js?v=17',
    'rainfall.core.js?v=3',
    'ritaseNonProd.core.js?v=1',
    'fuelEvidence.ui.js?v=2',
    'fuelAccess.ui.js?v=1',
    'production.js?v=105',
    'periodicService.js?v=14',
    'productionData.js?v=13',
    'reviewProduksi.core.js?v=3',
    'reviewPareto.core.js?v=2',
    'reviewPaWaterfall.core.js?v=2',
    'reviewPaWaterfall.js?v=7',
    'reviewUaWaterfall.core.js?v=4',
    'reviewUaWaterfall.js?v=9',
    'reviewProduksi.js?v=17',
    'ritaseReport.js?v=8',
    'breakdownReport.js?v=4',
    'databaseFuel.workspace.js?v=1',
    'productivityReport.js?v=6',
    'mtdReport.js?v=2',
    'surveyReport.js?v=8',
    'fuelOperationsHub.js?v=1',
  ];
  const librarySources = {
    xlsx: 'vendor/xlsx.full.min.js?v=2',
    chart: 'https://cdn.jsdelivr.net/npm/chart.js',
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  };
  const libraryGlobals = { xlsx: 'XLSX', chart: 'Chart', html2canvas: 'html2canvas' };
  const loads = new Map();
  let productionReady = false;

  function loadScript(src, key) {
    const cacheKey = key || src;
    if (loads.has(cacheKey)) return loads.get(cacheKey);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-omos-asset="${cacheKey}"]`);
      if (existing) {
        if (existing.dataset.omosLoaded === 'true') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Gagal memuat ${cacheKey}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.omosAsset = cacheKey;
      script.onload = () => { script.dataset.omosLoaded = 'true'; resolve(); };
      script.onerror = () => reject(new Error(`Gagal memuat ${cacheKey}`));
      document.head.appendChild(script);
    }).catch((error) => {
      loads.delete(cacheKey);
      throw error;
    });
    loads.set(cacheKey, promise);
    return promise;
  }

  global.OMOSLoadLibrary = async function OMOSLoadLibrary(name) {
    const library = String(name || '').toLowerCase();
    if (!librarySources[library]) throw new Error(`Library OMOS "${library}" tidak dikenal.`);
    if (global[libraryGlobals[library]]) return global[libraryGlobals[library]];
    await loadScript(librarySources[library], `library-${library}-${VERSION}`);
    if (!global[libraryGlobals[library]]) throw new Error(`Library ${library} tidak tersedia setelah dimuat.`);
    return global[libraryGlobals[library]];
  };

  global.OMOSLoadProductionModules = async function OMOSLoadProductionModules() {
    if (productionReady && typeof global.bukaTabProduksi === 'function' && global.bukaTabProduksi !== lazyOpenProductionTab) return;
    for (const src of productionModules) await loadScript(src, `production-${src}`);
    productionReady = true;
  };

  async function lazyOpenProductionTab(tabName) {
    try {
      await global.OMOSLoadProductionModules();
      if (global.bukaTabProduksi === lazyOpenProductionTab) throw new Error('Router Mining Production belum tersedia.');
      return global.bukaTabProduksi(tabName);
    } catch (error) {
      console.error('[OMOS Production Loader]', error);
      const host = document.getElementById(`tab-${tabName}`) || document.querySelector('.konten');
      if (host) host.innerHTML = `<div class="tabel__kosong">Modul Mining Production gagal dimuat. Periksa koneksi lalu coba lagi.</div>`;
      throw error;
    }
  }

  global.bukaTabProduksi = lazyOpenProductionTab;
})(window);
