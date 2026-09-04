const XLSX = require('xlsx');

const HEADERS = [
  'Nama Karyawan', 'Departemen', 'Jabatan', 'Tanggal Kerja', 'Shift',
  'Datang', 'Status Datang', 'Pulang', 'Status Pulang',
];

function tanggalExcel(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function waktuWibExcel(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + (7 * 60 * 60 * 1000));
}

function buatWorkbookAbsensi(rows, filter = {}) {
  const matrix = [HEADERS];
  rows.forEach((row) => {
    matrix.push([
      row.nama || '-', row.departemen || '-', row.jabatan || '-',
      tanggalExcel(row.tanggal_kerja), row.nama_shift || '-',
      waktuWibExcel(row.waktu_datang), row.status_datang || '-',
      waktuWibExcel(row.waktu_pulang), row.status_pulang || '-',
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(matrix, { cellDates: true });
  const akhirBaris = Math.max(1, rows.length + 1);
  worksheet['!autofilter'] = { ref: `A1:I${akhirBaris}` };
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  worksheet['!cols'] = [
    { wch: 26 }, { wch: 20 }, { wch: 22 }, { wch: 15 }, { wch: 16 },
    { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
  ];

  for (let row = 2; row <= akhirBaris; row += 1) {
    if (worksheet[`D${row}`]) worksheet[`D${row}`].z = 'dd/mm/yyyy';
    if (worksheet[`F${row}`]) worksheet[`F${row}`].z = 'dd/mm/yyyy hh:mm:ss';
    if (worksheet[`H${row}`]) worksheet[`H${row}`].z = 'dd/mm/yyyy hh:mm:ss';
  }

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Data Absensi Karyawan',
    Subject: `Periode ${filter.tanggal_dari || '-'} s/d ${filter.tanggal_sampai || '-'}`,
    Author: 'Attendance System',
    CreatedDate: new Date(),
  };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Absensi');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

module.exports = { HEADERS, buatWorkbookAbsensi };
