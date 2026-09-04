const PAYROLL_HEADERS = Object.freeze([
  'No', 'Employee ID', 'Nama Karyawan', 'Date In', 'Site', 'Kota', 'Jabatan',
  'Gaji Pokok', 'Tunjangan Kehadiran per Hari', 'Tunjangan Jabatan', 'Insentif HM per Jam',
]);

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function optionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseMoney(value, rowNumber, label) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const normalized = typeof value === 'string'
    ? value.replace(/\s/g, '').replace(/^Rp/i, '').replace(/\./g, '').replace(',', '.')
    : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`Baris ${rowNumber}: ${label} harus berupa angka`);
  if (number < 0) throw new Error(`Baris ${rowNumber}: ${label} tidak boleh negatif`);
  return number;
}

function normalizeDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const id = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (id) return `${id[3]}-${id[2].padStart(2, '0')}-${id[1].padStart(2, '0')}`;
  throw new Error(`Date In "${text}" tidak valid; gunakan format YYYY-MM-DD`);
}

function parsePayrollImportMatrix(matrix, employees) {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) {
    throw new Error('Berkas Excel kosong atau format tidak sesuai');
  }
  const actualHeaders = matrix[0].map((value) => String(value ?? '').trim());
  if (actualHeaders.length !== PAYROLL_HEADERS.length
    || !PAYROLL_HEADERS.every((header, index) => actualHeaders[index] === header)) {
    throw new Error('Format kolom tidak sesuai. Gunakan berkas dari tombol Export Excel sebagai template.');
  }

  const byEmployeeId = new Map();
  const byName = new Map();
  const duplicateNames = new Set();
  for (const employee of employees || []) {
    const employeeId = normalizeText(employee.employee_id);
    if (employeeId) byEmployeeId.set(employeeId, employee);
    const name = normalizeText(employee.nama);
    if (!name) continue;
    if (byName.has(name)) duplicateNames.add(name);
    else byName.set(name, employee);
  }

  const results = [];
  const userIds = new Set();
  for (let index = 1; index < matrix.length; index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    const rowNumber = index + 1;
    const employeeId = normalizeText(row[1]);
    const employeeName = normalizeText(row[2]);
    if (!employeeId && !employeeName && row.every((value) => String(value ?? '').trim() === '')) continue;
    let employee = employeeId ? byEmployeeId.get(employeeId) : null;
    if (!employee && employeeName && !duplicateNames.has(employeeName)) employee = byName.get(employeeName);
    if (!employee) {
      throw new Error(`Baris ${rowNumber}: karyawan "${row[2] || row[1] || '-'}" tidak ditemukan atau tidak aktif`);
    }
    if (userIds.has(employee.id)) throw new Error(`Baris ${rowNumber}: karyawan ${employee.nama} duplikat dalam template`);
    userIds.add(employee.id);
    let dateIn;
    try { dateIn = normalizeDate(row[3]); } catch (error) { throw new Error(`Baris ${rowNumber}: ${error.message}`); }
    results.push({
      user_id: employee.id,
      employee_id: optionalText(employee.employee_id),
      nama_karyawan: String(employee.nama).trim(),
      date_in: dateIn,
      site: optionalText(row[4]),
      kota: optionalText(row[5]),
      jabatan: optionalText(employee.jabatan),
      gaji_pokok: parseMoney(row[7], rowNumber, 'Gaji Pokok'),
      tunjangan_kehadiran_per_hari: parseMoney(row[8], rowNumber, 'Tunjangan Kehadiran per Hari'),
      tunjangan_jabatan: parseMoney(row[9], rowNumber, 'Tunjangan Jabatan'),
      insentif_hm_per_jam: parseMoney(row[10], rowNumber, 'Insentif HM per Jam'),
    });
  }
  if (!results.length) throw new Error('Tidak ada data payroll yang dapat diimpor');
  return results;
}

module.exports = { PAYROLL_HEADERS, parsePayrollImportMatrix };
