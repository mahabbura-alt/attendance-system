const { pool } = require('../config/db');

/** GET /api/admin/lokasi */
async function daftarLokasi(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM lokasi_kantor ORDER BY nama_lokasi');
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/lokasi
 * body: { nama_lokasi, latitude, longitude, radius_meter }
 */
async function buatLokasi(req, res, next) {
  try {
    const { nama_lokasi, latitude, longitude, radius_meter } = req.body;

    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = radius_meter === undefined ? 50 : Number(radius_meter);
    if (!nama_lokasi || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !Number.isInteger(radius) || radius < 1 || radius > 10000) {
      return res.status(400).json({ error: 'nama_lokasi, latitude, dan longitude wajib diisi' });
    }

    const { rows } = await pool.query(
      `INSERT INTO lokasi_kantor (nama_lokasi, latitude, longitude, radius_meter)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [nama_lokasi.trim(), lat, lng, radius]
    );

    res.status(201).json({ message: 'Lokasi kantor berhasil dibuat', lokasi: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/lokasi/:id */
async function updateLokasi(req, res, next) {
  try {
    const { id } = req.params;
    const { nama_lokasi, latitude, longitude, radius_meter } = req.body;

    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radius_meter || 500);

    if (!nama_lokasi || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Nama lokasi, latitude, dan longitude wajib diisi' });
    }

    const { rows } = await pool.query(
      `UPDATE lokasi_kantor
       SET nama_lokasi = $1, latitude = $2, longitude = $3, radius_meter = $4
       WHERE id = $5 RETURNING *`,
      [nama_lokasi.trim(), lat, lng, radius, id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });

    res.json({ message: 'Lokasi berhasil diperbarui', lokasi: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/lokasi/:id */
async function hapusLokasi(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM lokasi_kantor WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });

    res.json({ message: 'Lokasi berhasil dihapus' });
  } catch (err) {
    next(err);
  }
}

module.exports = { daftarLokasi, buatLokasi, updateLokasi, hapusLokasi };
