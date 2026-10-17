'use strict';

/** Mesin kompresi foto HSE: semua foto masuk dikompres, foto kecil tidak dikompres ulang, gambar rusak besar ditolak. */

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  compressPhotoDataUrl, compressHsePhotos, compressNewPhotos, dataUrlBytes, PHOTO_TARGET_MAX_BYTES,
} = require('../src/services/hsePhotoCompress');

async function bigPhoto(format = 'png', size = 2400) {
  // Gambar acak 2400×1800 (sulit dikompres) agar ukuran jauh di atas target.
  const raw = Buffer.alloc(size * Math.round(size * 0.75) * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const buf = await sharp(raw, { raw: { width: size, height: Math.round(size * 0.75), channels: 3 } })[format]().toBuffer();
  return `data:image/${format};base64,${buf.toString('base64')}`;
}

test('foto besar (PNG / TIFF / GIF) dikompres ke WebP/JPEG ≤ target, sisi terpanjang ≤ 1200 px', async () => {
  for (const format of ['png', 'tiff', 'gif']) {
    const input = await bigPhoto(format);
    assert.ok(dataUrlBytes(input) > PHOTO_TARGET_MAX_BYTES, `${format} input harus besar`);
    const out = await compressPhotoDataUrl(input);
    assert.match(out, /^data:image\/(webp|jpeg);base64,/, format);
    const meta = await sharp(Buffer.from(out.split(',')[1], 'base64')).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 1200, `${format} dimensi ${meta.width}x${meta.height}`);
    assert.ok(dataUrlBytes(out) <= PHOTO_TARGET_MAX_BYTES * 1.6, `${format} ukuran ${dataUrlBytes(out)}`);
  }
});

test('foto WebP/JPEG yang sudah kecil tidak dikompres ulang; URL biasa dibiarkan', async () => {
  const small = await compressPhotoDataUrl(await bigPhoto('png', 400));
  assert.equal(await compressPhotoDataUrl(small), small);
  assert.equal(await compressPhotoDataUrl('/uploads/hse/a.jpg'), '/uploads/hse/a.jpg');
});

test('lampiran bukan gambar atau gambar rusak berukuran besar ditolak (tidak disimpan mentah)', async () => {
  await assert.rejects(compressPhotoDataUrl('data:application/pdf;base64,JVBERi0x'), { statusCode: 422 });
  const junk = `data:image/heic;base64,${Buffer.alloc(300 * 1024, 7).toString('base64')}`;
  await assert.rejects(compressPhotoDataUrl(junk), { statusCode: 422, message: /HEIC tidak dapat diproses/ });
});

test('compressNewPhotos: foto lama yang masih besar ikut dikompres, yang sudah kecil dipertahankan', async () => {
  const legacyBig = await bigPhoto('png');
  const small = await compressPhotoDataUrl(await bigPhoto('png', 400));
  const out = await compressNewPhotos([legacyBig, small], [legacyBig, small]);
  assert.notEqual(out[0], legacyBig);
  assert.ok(dataUrlBytes(out[0]) < dataUrlBytes(legacyBig));
  assert.equal(out[1], small);
  await assert.rejects(compressHsePhotos([small, small, small, small]), { statusCode: 422 });
});
