package com.omos.fuel.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Foto bukti per slot. client_uuid tetap → unggah ulang idempoten; sha256 dari file terkompres (Q21). */
data class PhotoRef(
    val slot: String, val ref: String, val clientUuid: String, val sha256: String, val capturedAt: String,
    val gpsLat: Double? = null, val gpsLng: Double? = null, val attachmentId: String? = null,
)

/**
 * Foto dari aplikasi kamera (bukan galeri), dikompres di HP ke ≤1600 px / ±300 KB (lapis 1 kompresi),
 * disimpan internal sampai terkirim. Server mengecek ulang dan mengompres bila masih melewati batas.
 */
class PhotoStore(private val context: Context) {
    private val dir = File(context.filesDir, "photos").apply { mkdirs() }
    private val cameraDir = File(context.cacheDir, "camera").apply { mkdirs() }

    companion object {
        const val PREFIX = "local-photo:"
        private const val MAX_SIDE = 1600
        private const val TARGET_BYTES = 300 * 1024

        fun sha256(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    fun newCameraUri(): Pair<Uri, File> {
        val file = File(cameraDir, "cam_${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return uri to file
    }

    /** Kompres hasil kamera → simpan → PhotoRef (hash dari file yang akan dikirim). */
    fun importCameraFile(file: File, slot: String, capturedAt: String, lat: Double?, lng: Double?): PhotoRef? {
        if (!file.exists() || file.length() == 0L) return null
        return try {
            val bytes = compress(file)
            val name = "${UUID.randomUUID()}.jpg"
            File(dir, name).writeBytes(bytes)
            PhotoRef(slot, "$PREFIX$name", UUID.randomUUID().toString(), sha256(bytes), capturedAt, lat, lng)
        } finally {
            file.delete()
        }
    }

    private fun compress(file: File): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        val raw = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("Foto tidak terbaca")
        val rotation = try {
            when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (_: Exception) { 0f }
        val scale = MAX_SIDE.toFloat() / maxOf(raw.width, raw.height)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotation != 0f) postRotate(rotation)
        }
        val bmp = if (scale < 1f || rotation != 0f) Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true) else raw
        var quality = 82
        var out: ByteArray
        do {
            val baos = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, baos)
            out = baos.toByteArray()
            quality -= 10
        } while (out.size > TARGET_BYTES && quality >= 40)
        return out
    }

    fun fileOf(ref: String): File? = if (ref.startsWith(PREFIX)) File(dir, ref.removePrefix(PREFIX)).takeIf { it.exists() } else null

    fun thumbnail(ref: String, maxSide: Int = 320): Bitmap? {
        val f = fileOf(ref) ?: return null
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, opts)
        var sample = 1
        while (maxOf(opts.outWidth, opts.outHeight) / (sample * 2) >= maxSide) sample *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    fun delete(ref: String) { fileOf(ref)?.delete() }
}

class MissingPhotoException : Exception("Foto di HP tidak ditemukan (mungkin terhapus). Catat ulang transaksi ini.")
