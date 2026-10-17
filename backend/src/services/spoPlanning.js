'use strict';

const PRODUCTION_MODES = Object.freeze({ PROD: 'prod', NON_PROD: 'non_prod' });
const MATERIAL_TYPES = Object.freeze({ OB: 'ob', COAL: 'coal' });
const LEGACY_PRODUCTION_JOB_CODES = new Set(['OB', 'CG', 'FOT']);
const LEGACY_MATERIAL_TYPES = new Map([['OB', MATERIAL_TYPES.OB], ['CG', MATERIAL_TYPES.COAL], ['FOT', MATERIAL_TYPES.COAL]]);

function normalizePlanningJob(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function decodePlanningHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function htmlAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return decodePlanningHtml(match?.[2] || '');
}

function resolvePlanningJob(rawValue, jobs = []) {
  const key = normalizePlanningJob(rawValue);
  if (!key) return null;
  return jobs.find(job => normalizePlanningJob(job.job_code) === key
    || normalizePlanningJob(job.job_desc) === key
    || (String(job.job_code).toUpperCase() === 'OB' && key === 'ob removal')) || null;
}

function normalizeProductionMode(value, jobCode = '') {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (mode === PRODUCTION_MODES.PROD) return PRODUCTION_MODES.PROD;
  if (mode === PRODUCTION_MODES.NON_PROD || mode === 'nonprod') return PRODUCTION_MODES.NON_PROD;
  return LEGACY_PRODUCTION_JOB_CODES.has(String(jobCode || '').trim().toUpperCase())
    ? PRODUCTION_MODES.PROD : null;
}

function normalizeMaterialType(value, jobCode = '', productionMode = PRODUCTION_MODES.PROD) {
  if (productionMode !== PRODUCTION_MODES.PROD) return null;
  const type = String(value || '').trim().toLowerCase();
  if (type === MATERIAL_TYPES.OB) return MATERIAL_TYPES.OB;
  if (type === MATERIAL_TYPES.COAL) return MATERIAL_TYPES.COAL;
  return LEGACY_MATERIAL_TYPES.get(String(jobCode || '').trim().toUpperCase()) || null;
}

function extractDeployedJobs(plan = {}, jobs = []) {
  const deployed = new Map();
  const add = (value, productionMode, materialType) => {
    const resolved = resolvePlanningJob(value, jobs);
    if (!resolved) return;
    const jobCode = String(resolved.job_code).trim().toUpperCase();
    const mode = normalizeProductionMode(productionMode, jobCode);
    const type = normalizeMaterialType(materialType, jobCode, mode);
    const current = deployed.get(jobCode);
    if (current && current.productionMode && mode && current.productionMode !== mode) {
      current.classificationConflict = true;
      return;
    }
    if (current && current.materialType && type && current.materialType !== type) {
      current.materialTypeConflict = true;
      return;
    }
    deployed.set(jobCode, {
      jobCode,
      jobDescription: String(resolved.job_desc || ''),
      productionMode: current?.productionMode || mode,
      materialType: current?.materialType || type,
      classificationSource: productionMode ? 'spo' : 'legacy_default',
      materialTypeSource: materialType ? 'spo' : (type ? 'legacy_default' : 'missing'),
      classificationConflict: Boolean(current?.classificationConflict),
      materialTypeConflict: Boolean(current?.materialTypeConflict),
    });
  };
  const data = plan.data_json && typeof plan.data_json === 'object' ? plan.data_json : {};
  if (Array.isArray(data.deployedJobs)) {
    data.deployedJobs.forEach(job => add(job?.jobCode || job?.job_code || job,
      job?.productionMode || job?.production_mode, job?.materialType || job?.material_type));
  }
  Object.values(data.tables || {}).forEach(table => {
    if (table?.deployed) add(table.jobCode || table.job_code || table.jobDescription,
      table.productionMode || table.production_mode, table.materialType || table.material_type);
  });

  // Compatibility untuk SPO sebelum planningData v5/v6.
  if (!deployed.size && plan.content_html) {
    const html = String(plan.content_html);
    const starts = [...html.matchAll(/<div\b[^>]*class=(["'])[^"']*\bspo-table\b[^"']*\1[^>]*>/gi)]
      .map(match => match.index);
    starts.forEach((start, index) => {
      const segment = html.slice(start, starts[index + 1] ?? html.length);
      if (!/data-spo-status[^>]*>\s*Deployed\s*</i.test(segment)) return;
      const control = segment.match(/<(?:input|select)\b[^>]*data-spo-job\b[^>]*>/i)?.[0] || '';
      let value = htmlAttribute(control, 'value');
      if (!value && /^<select/i.test(control)) {
        const selectBlock = segment.match(/<select\b[^>]*data-spo-job\b[^>]*>[\s\S]*?<\/select>/i)?.[0] || '';
        const selectedOption = selectBlock.match(/<option\b[^>]*selected[^>]*>/i)?.[0] || '';
        value = htmlAttribute(selectedOption, 'value');
      }
      if (!value) value = segment.match(/data-spo-job-label[^>]*>\s*([^<]+)</i)?.[1] || '';
      const mode = segment.match(/data-spo-production-mode\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      const type = segment.match(/data-spo-material-type\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      add(decodePlanningHtml(value), decodePlanningHtml(mode), decodePlanningHtml(type));
    });
  }
  return [...deployed.values()];
}

function extractDeployedJobCodes(plan = {}, jobs = []) {
  return new Set(extractDeployedJobs(plan, jobs).map(job => job.jobCode));
}

function extractProductionJobCodes(plan = {}, jobs = []) {
  return new Set(extractDeployedJobs(plan, jobs)
    .filter(job => job.productionMode === PRODUCTION_MODES.PROD && job.materialType
      && !job.classificationConflict && !job.materialTypeConflict)
    .map(job => job.jobCode));
}

function validatePlanningData(data = {}, jobs = [], options = {}) {
  const next = JSON.parse(JSON.stringify(data && typeof data === 'object' ? data : {}));
  const requestedVersion = Number(next.version) || 0;
  const standbyCodes = Array.isArray(options.standbyCodes) ? options.standbyCodes : [];
  const standbyById = new Map(standbyCodes
    .filter(code => code?.id && !code.deleted_at && !code.is_system)
    .map(code => [String(code.id), code]));
  const requiresStandbyMapping = requestedVersion >= 7
    || Object.values(next.tables || {}).some(table => Array.isArray(table?.parameters));
  const previousTables = options.previousData?.tables && typeof options.previousData.tables === 'object'
    ? options.previousData.tables : {};
  const previousModesByJob = new Map();
  const previousMaterialTypesByJob = new Map();
  const previousParametersByJob = new Map();
  Object.values(previousTables).forEach(previousTable => {
    if (!previousTable?.deployed) return;
    const previousJob = resolvePlanningJob(previousTable.jobCode || previousTable.job_code
      || previousTable.jobDescription, jobs);
    const previousJobCode = String(previousJob?.job_code || '').trim().toUpperCase();
    const previousMode = normalizeProductionMode(previousTable.productionMode
      || previousTable.production_mode, previousJobCode);
    const previousMaterialType = normalizeMaterialType(previousTable.materialType
      || previousTable.material_type, previousJobCode, previousMode);
    if (previousJobCode && previousMode) previousModesByJob.set(previousJobCode, previousMode);
    if (previousJobCode && previousMaterialType) previousMaterialTypesByJob.set(previousJobCode, previousMaterialType);
    if (previousJobCode && Array.isArray(previousTable.parameters) && previousTable.parameters.length) {
      previousParametersByJob.set(previousJobCode, previousTable.parameters.map(parameter => ({
        rowId: String(parameter?.rowId || '').trim(),
        standbyCodeId: String(parameter?.standbyCodeId || '').trim(),
      })));
    }
  });
  const classifications = new Map();
  for (const [tableId, table] of Object.entries(next.tables || {})) {
    const resolved = resolvePlanningJob(table?.jobCode || table?.job_code || table?.jobDescription, jobs);
    if (!resolved && table?.deployed) throw Object.assign(new Error(`JOB tabel SPO ${tableId} tidak tersedia di Master JOB.`), { status: 400 });
    const jobCode = String(resolved?.job_code || '').trim().toUpperCase();
    const explicitMode = String(table?.productionMode || table?.production_mode || '').trim();
    const mode = normalizeProductionMode(explicitMode, jobCode);
    const explicitMaterialType = String(table?.materialType || table?.material_type || '').trim();
    const materialType = normalizeMaterialType(explicitMaterialType, jobCode, mode);
    if (table?.deployed && !mode) throw Object.assign(new Error(`Klasifikasi Prod/Non Prod wajib dipilih untuk JOB ${jobCode || tableId}.`), { status: 422 });
    if (jobCode && mode && previousModesByJob.has(jobCode) && mode !== previousModesByJob.get(jobCode)) {
      throw Object.assign(new Error(`Klasifikasi JOB ${jobCode} tidak dapat diubah setelah tabel SPO di-deploy.`), { status: 409 });
    }
    if (jobCode && materialType && previousMaterialTypesByJob.has(jobCode)
      && materialType !== previousMaterialTypesByJob.get(jobCode)) {
      throw Object.assign(new Error(`Jenis Material JOB ${jobCode} tidak dapat diubah setelah tabel SPO di-deploy.`), { status: 409 });
    }
    const previousTable = previousTables[tableId];
    if (previousTable?.deployed) {
      const previousJob = resolvePlanningJob(previousTable.jobCode || previousTable.job_code
        || previousTable.jobDescription, jobs);
      const previousJobCode = String(previousJob?.job_code || '').trim().toUpperCase();
      const previousMode = normalizeProductionMode(previousTable.productionMode
        || previousTable.production_mode, previousJobCode);
      const previousMaterialType = normalizeMaterialType(previousTable.materialType
        || previousTable.material_type, previousJobCode, previousMode);
      if (previousMode && mode !== previousMode) {
        throw Object.assign(new Error(`Klasifikasi JOB ${previousJobCode || tableId} tidak dapat diubah setelah tabel SPO di-deploy.`), { status: 409 });
      }
      if (previousMaterialType && materialType !== previousMaterialType) {
        throw Object.assign(new Error(`Jenis Material JOB ${previousJobCode || tableId} tidak dapat diubah setelah tabel SPO di-deploy.`), { status: 409 });
      }
    }
    if (table?.deployed && mode === PRODUCTION_MODES.PROD && !materialType) {
      throw Object.assign(new Error(`Jenis Material OB/Coal wajib dipilih untuk JOB Prod ${jobCode || tableId}.`), { status: 422 });
    }
    if (mode) table.productionMode = mode;
    if (mode === PRODUCTION_MODES.PROD && materialType) table.materialType = materialType;
    else delete table.materialType;
    if (requiresStandbyMapping) {
      const parameters = Array.isArray(table?.parameters) ? table.parameters : [];
      if (table?.deployed && !parameters.length) {
        throw Object.assign(new Error(`Parameter tabel SPO ${jobCode || tableId} wajib menggunakan Standby Codes.`), { status: 422 });
      }
      const rowIds = new Set();
      const standbyCodeIds = new Set();
      table.parameters = parameters.map((parameter, index) => {
        const rowId = String(parameter?.rowId || '').trim();
        const standbyCodeId = String(parameter?.standbyCodeId || '').trim();
        const master = standbyById.get(standbyCodeId);
        if (!rowId) throw Object.assign(new Error(`Baris parameter ke-${index + 1} pada SPO ${jobCode || tableId} tidak valid.`), { status: 422 });
        if (rowIds.has(rowId)) throw Object.assign(new Error(`ID baris parameter ${rowId} duplikat pada SPO ${jobCode || tableId}.`), { status: 409 });
        if (!master) throw Object.assign(new Error(`Standby Code pada baris ${rowId} SPO ${jobCode || tableId} tidak aktif atau tidak tersedia.`), { status: 422 });
        if (standbyCodeIds.has(standbyCodeId)) throw Object.assign(new Error(`Standby Code ${master.kode} duplikat pada SPO ${jobCode || tableId}.`), { status: 409 });
        rowIds.add(rowId);
        standbyCodeIds.add(standbyCodeId);
        return {
          rowId,
          standbyCodeId: String(master.id),
          codeSnapshot: String(master.kode || '').trim().toUpperCase(),
          descriptionSnapshot: String(master.deskripsi || master.kategori || '').trim(),
          planningTypeSnapshot: String(master.planning_type || 'unplanned'),
          controlClassSnapshot: String(master.control_class || 'controllable'),
          ownerDepartmentSnapshot: String(master.owner_department || 'Production'),
        };
      });
      const lockedParameters = previousParametersByJob.get(jobCode);
      if (table?.deployed && lockedParameters) {
        const currentIdentity = table.parameters.map(parameter => `${parameter.rowId}:${parameter.standbyCodeId}`);
        const lockedIdentity = lockedParameters.map(parameter => `${parameter.rowId}:${parameter.standbyCodeId}`);
        if (currentIdentity.length !== lockedIdentity.length
          || currentIdentity.some((identity, index) => identity !== lockedIdentity[index])) {
          throw Object.assign(new Error(`Parameter SPO ${jobCode || tableId} tidak dapat ditambah, dihapus, diurutkan ulang, atau diganti setelah tabel di-deploy. Hanya jam delay yang dapat diubah.`), { status: 409 });
        }
      }
    }
    if (!table?.deployed || !jobCode || !mode) continue;
    const previous = classifications.get(jobCode);
    if (previous && previous.productionMode !== mode) throw Object.assign(new Error(`JOB ${jobCode} memiliki klasifikasi Prod/Non Prod yang bertentangan.`), { status: 409 });
    if (previous && previous.materialType !== materialType) throw Object.assign(new Error(`JOB ${jobCode} memiliki Jenis Material yang bertentangan.`), { status: 409 });
    classifications.set(jobCode, { productionMode: mode, materialType });
  }
  next.version = Math.max(8, requestedVersion);
  next.deployedJobs = [...classifications].map(([jobCode, classification]) => {
    const resolved = resolvePlanningJob(jobCode, jobs);
    return { jobCode, jobDescription: String(resolved?.job_desc || ''), ...classification };
  });
  return next;
}

module.exports = { normalizePlanningJob, decodePlanningHtml, htmlAttribute,
  resolvePlanningJob, normalizeProductionMode, normalizeMaterialType, extractDeployedJobs,
  extractDeployedJobCodes, extractProductionJobCodes, PRODUCTION_MODES,
  MATERIAL_TYPES, LEGACY_PRODUCTION_JOB_CODES, LEGACY_MATERIAL_TYPES, validatePlanningData };
