const express = require('express');
const router = express.Router();
const { streamFoto } = require('../services/storage');

// Endpoint untuk mem-proxy (stream) gambar dari MinIO ke klien
router.get('/view', async (req, res) => {
  const objectKey = req.query.key;
  if (!objectKey) {
    return res.status(400).send('Parameter key diperlukan');
  }
  await streamFoto(objectKey, res);
});

module.exports = router;
