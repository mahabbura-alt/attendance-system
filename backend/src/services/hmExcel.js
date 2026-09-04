const { validateDateRange } = require('./hmDaily');

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmployeeId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseHmNumber(value, rowNumber, date) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = typeof value === 'string' && value.includes(',') && !value.includes('.')
    ? value.replace(',', '.')
    : value;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Baris ${rowNumber}, tanggal ${date}: nilai HM harus berupa angka`);
  }
  if (numeric < 0) {
    throw new Error(`Baris ${rowNumber}, tanggal ${date}: nilai HM tidak boleh negatif`);
  }
  return numeric;
}

function parseHmImportMatrix(matrix, employees) {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) {
    throw new Error('Berkas Excel kosong atau format tidak sesuai');
  }

  const headers = matrix[0].map((value) => String(value ?? '').trim());
  const normalizedHeaders = headers.map(normalizeText);
  const employeeIdIndex = normalizedHeaders.indexOf('employee id');
  const employeeNameIndex = normalizedHeaders.indexOf('nama karyawan');
  if (employeeIdIndex < 0 && employeeNameIndex < 0) {
    throw new Error('Template wajib memiliki kolom Employee ID atau Nama Karyawan');
  }

  const dateColumns = headers
    .map((header, index) => ({ date: header, index }))
    .filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (!dateColumns.length) {
    throw new Error('Template wajib memiliki sedikitnya satu kolom tanggal berformat YYYY-MM-DD');
  }

  const dates = dateColumns.map(({ date }) => date);
  if (new Set(dates).size !== dates.length) {
    throw new Error('Template memiliki kolom tanggal duplikat');
  }
  const sortedDates = [...dates].sort();
  validateDateRange(sortedDates[0], sortedDates[sortedDates.length - 1]);

  const byEmployeeId = new Map();
  const byName = new Map();
  const duplicateNames = new Set();
  for (const employee of employees || []) {
    const employeeId = normalizeEmployeeId(employee.employee_id);
    if (employeeId) byEmployeeId.set(employeeId, employee);
    const name = normalizeText(employee.nama);
    if (!name) continue;
    if (byName.has(name)) duplicateNames.add(name);
    else byName.set(name, employee);
  }

  const entries = [];
  const entryKeys = new Set();
  let importedRows = 0;

  for (let index = 1; index < matrix.length; index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    const rowNumber = index + 1;
    const employeeId = employeeIdIndex >= 0 ? normalizeEmployeeId(row[employeeIdIndex]) : '';
    const employeeName = employeeNameIndex >= 0 ? normalizeText(row[employeeNameIndex]) : '';
    const hasDailyValue = dateColumns.some(({ index: columnIndex }) => {
      const value = row[columnIndex];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
    if (!employeeId && !employeeName && !hasDailyValue) continue;

    let employee = employeeId ? byEmployeeId.get(employeeId) : null;
    if (!employee && employeeName && !duplicateNames.has(employeeName)) {
      employee = byName.get(employeeName);
    }
    if (!employee) {
      throw new Error(`Baris ${rowNumber}: karyawan "${row[employeeNameIndex] || row[employeeIdIndex] || '-'}" tidak ditemukan`);
    }

    let rowHasEntry = false;
    for (const { date, index: columnIndex } of dateColumns) {
      const jamOperasi = parseHmNumber(row[columnIndex], rowNumber, date);
      if (jamOperasi === null) continue;
      const key = `${employee.id}:${date}`;
      if (entryKeys.has(key)) {
        throw new Error(`Baris ${rowNumber}: data ${employee.nama} untuk tanggal ${date} duplikat`);
      }
      entryKeys.add(key);
      entries.push({ user_id: employee.id, tanggal: date, jam_operasi: jamOperasi });
      rowHasEntry = true;
    }
    if (rowHasEntry) importedRows += 1;
  }

  if (!entries.length) {
    throw new Error('Tidak ada nilai HM harian yang dapat diimpor');
  }

  return { dates, entries, importedRows };
}

module.exports = { parseHmImportMatrix };
