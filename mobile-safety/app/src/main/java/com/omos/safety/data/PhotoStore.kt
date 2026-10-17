package com.omos.safety.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.StatFs
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Foto disimpan terkompres (±300 KB, sisi terpanjang 1280 px) di penyimpanan internal aplikasi.
 * Payload antrean hanya menyimpan referensi "local-photo:<nama>", diubah ke data URL saat dikirim.
 */
class PhotoStore(private val context: Context) {
    private val dir = File(context.filesDir, "photos").apply { mkdirs() }
    private val cameraDir = File(context.cacheDir, "camera").apply { mkdirs() }

    companion object {
        const val PREFIX = "local-photo:"
        private const val MAX_SIDE = 1280
        private const val TARGET_BYTES = 300 * 1024
    }

    /** URI sementara untuk ActivityResultContracts.TakePicture. */
    fun newCameraUri(): Pair<Uri, File> {
        val file = File(cameraDir, "cam_${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return uri to file
    }

    /** Kompres hasil kamera → simpan permanen → kembalikan referensi lokal. */
    fun importCameraFile(file: File): String? {
        if (!file.exists() || file.length() == 0L) return null
        return try {
            val bytes = compress(file)
            val name = "${UUID.randomUUID()}.jpg"
            File(dir, name).writeBytes(bytes)
            "$PREFIX$name"
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
            quality -= 12
        } while (out.size > TARGET_BYTES && quality >= 40)
        return out
    }

    fun fileOf(ref: String): File? = if (ref.startsWith(PREFIX)) File(dir, ref.removePrefix(PREFIX)).takeIf { it.exists() } else null

    fun thumbnail(ref: String, maxSide: Int = 240): Bitmap? {
        val f = fileOf(ref) ?: return null
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, opts)
        var sample = 1
        while (maxOf(opts.outWidth, opts.outHeight) / (sample * 2) >= maxSide) sample *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    fun toDataUrl(ref: String): String? {
        val f = fileOf(ref) ?: return null
        return "data:image/jpeg;base64," + Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
    }

    fun delete(ref: String) { fileOf(ref)?.delete() }

    /** Ganti semua string "local-photo:" di payload (rekursif) dengan data URL. Null bila ada foto hilang. */
    fun materialize(node: Any?): Any? = when (node) {
        is String -> if (node.startsWith(PREFIX)) (toDataUrl(node) ?: throw MissingPhotoException()) else node
        is Map<*, *> -> node.entries.associate { (k, v) -> k.toString() to materialize(v) }
        is List<*> -> node.map { materialize(it) }
        else -> node
    }

    fun refsIn(node: Any?): List<String> = when (node) {
        is String -> if (node.startsWith(PREFIX)) listOf(node) else emptyList()
        is Map<*, *> -> node.values.flatMap { refsIn(it) }
        is List<*> -> node.flatMap { refsIn(it) }
        else -> emptyList()
    }

    data class StorageInfo(val freeBytes: Long, val totalBytes: Long, val photoBytes: Long, val photoCount: Int)

    fun storageInfo(): StorageInfo {
        val stat = StatFs(context.filesDir.path)
        val files = dir.listFiles().orEmpty()
        return StorageInfo(stat.availableBytes, stat.totalBytes, files.sumOf { it.length() }, files.size)
    }

    fun sizeOf(refs: List<String>): Long = refs.sumOf { fileOf(it)?.length() ?: 0L }
}

class MissingPhotoException : Exception("Foto di HP tidak ditemukan (mungkin terhapus). Ambil ulang foto.")
