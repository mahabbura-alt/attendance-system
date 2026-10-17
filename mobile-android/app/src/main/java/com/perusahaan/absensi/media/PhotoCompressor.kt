package com.perusahaan.absensi.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

object PhotoCompressor {
    fun compressJpeg(bytes: ByteArray, maxDimension: Int = 960, quality: Int = 72): ByteArray {
        if (bytes.isEmpty()) return bytes

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return bytes

        var sampleSize = 1
        while (bounds.outWidth / (sampleSize * 2) >= maxDimension &&
            bounds.outHeight / (sampleSize * 2) >= maxDimension
        ) {
            sampleSize *= 2
        }

        val decoded = BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sampleSize }
        ) ?: return bytes

        val longestSide = maxOf(decoded.width, decoded.height)
        val resized = if (longestSide > maxDimension) {
            val scale = maxDimension.toFloat() / longestSide
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * scale).toInt().coerceAtLeast(1),
                (decoded.height * scale).toInt().coerceAtLeast(1),
                true
            )
        } else {
            decoded
        }

        return try {
            val output = ByteArrayOutputStream()
            resized.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(40, 90), output)
            val compressed = output.toByteArray()
            if (compressed.isNotEmpty() && compressed.size < bytes.size) compressed else bytes
        } finally {
            if (resized !== decoded) resized.recycle()
            decoded.recycle()
        }
    }
}
