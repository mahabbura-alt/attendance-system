package com.perusahaan.absensi.ui.widget

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import kotlin.math.*

/**
 * MinimapView — tampilan peta sederhana berbasis Canvas.
 * Menampilkan:
 * - Lingkaran radius check-in (warna merah transparan)
 * - Titik posisi device saat ini (warna biru)
 * - Label nama lokasi
 */
class MinimapView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val paintRadius = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#40F44336") // merah transparan
        style = Paint.Style.FILL
    }
    private val paintRadiusBorder = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F44336")
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }
    private val paintDevice = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#1565C0") // biru
        style = Paint.Style.FILL
    }
    private val paintDeviceBorder = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }
    private val paintKantor = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#B71C1C") // merah tua (titik tengah kantor)
        style = Paint.Style.FILL
    }
    private val paintText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#212121")
        textSize = 30f
        typeface = Typeface.DEFAULT_BOLD
    }
    private val paintSubText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#616161")
        textSize = 24f
    }
    private val paintGrid = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#20000000")
        style = Paint.Style.STROKE
        strokeWidth = 1f
    }

    // Data yang di-set dari luar
    var kantorLat: Double = 0.0
    var kantorLng: Double = 0.0
    var radiusMeter: Int = 100
    var namaLokasi: String = ""

    var deviceLat: Double? = null
    var deviceLng: Double? = null

    fun setKantor(lat: Double, lng: Double, radius: Int, nama: String) {
        kantorLat = lat
        kantorLng = lng
        radiusMeter = radius
        namaLokasi = nama
        invalidate()
    }

    fun setDevicePosition(lat: Double, lng: Double) {
        deviceLat = lat
        deviceLng = lng
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (kantorLat == 0.0 && kantorLng == 0.0) {
            canvas.drawText("Lokasi kantor belum tersedia", 40f, height / 2f, paintSubText)
            return
        }

        val w = width.toFloat()
        val h = height.toFloat()
        val cx = w / 2f
        val cy = h / 2f

        // Skala: radius_meter -> pixel. Tampilkan area 3x radius
        val viewAreaMeter = radiusMeter * 3.0
        val scale = (min(w, h) / 2f) / viewAreaMeter.toFloat() // pixel per meter

        // Gambar grid latar
        val gridStep = (min(w, h) / 6f)
        var gx = cx % gridStep
        while (gx < w) { canvas.drawLine(gx, 0f, gx, h, paintGrid); gx += gridStep }
        var gy = cy % gridStep
        while (gy < h) { canvas.drawLine(0f, gy, w, gy, paintGrid); gy += gridStep }

        // Radius lingkaran kantor (meter -> pixel)
        val radiusPx = radiusMeter * scale
        canvas.drawCircle(cx, cy, radiusPx, paintRadius)
        canvas.drawCircle(cx, cy, radiusPx, paintRadiusBorder)

        // Titik kantor
        canvas.drawCircle(cx, cy, 10f, paintKantor)

        // Posisi device
        val dLat = deviceLat
        val dLng = deviceLng
        if (dLat != null && dLng != null) {
            val dxMeter = haversineX(kantorLat, kantorLng, dLat, dLng)
            val dyMeter = haversineY(kantorLat, kantorLng, dLat, dLng)
            val dxPx = dxMeter * scale
            val dyPx = dyMeter * scale

            val devX = cx + dxPx.toFloat()
            val devY = cy - dyPx.toFloat() // Y terbalik (lat naik = naik di layar)

            canvas.drawCircle(devX, devY, 18f, paintDevice)
            canvas.drawCircle(devX, devY, 18f, paintDeviceBorder)

            // Jarak label
            val jarak = hypot(dxMeter, dyMeter).toInt()
            val statusTeks = if (jarak <= radiusMeter) "✓ Dalam radius ($jarak m)" else "✗ Di luar radius ($jarak m)"
            val statusColor = if (jarak <= radiusMeter) Color.parseColor("#2E7D32") else Color.parseColor("#C62828")
            paintSubText.color = statusColor
            canvas.drawText(statusTeks, 16f, h - 16f, paintSubText)
            paintSubText.color = Color.parseColor("#616161")
        } else {
            canvas.drawText("Menunggu lokasi GPS...", 16f, h - 16f, paintSubText)
        }

        // Label nama lokasi
        if (namaLokasi.isNotEmpty()) {
            canvas.drawText(namaLokasi, 16f, 36f, paintText)
        }
        canvas.drawText("● Kantor  ● Device", 16f, 68f, paintSubText)
    }

    /** Komponen horizontal jarak dalam meter (positif = timur) */
    private fun haversineX(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371000.0
        val latRad = Math.toRadians((lat1 + lat2) / 2)
        return R * Math.toRadians(lng2 - lng1) * cos(latRad)
    }

    /** Komponen vertikal jarak dalam meter (positif = utara) */
    private fun haversineY(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371000.0
        return R * Math.toRadians(lat2 - lat1)
    }
}
