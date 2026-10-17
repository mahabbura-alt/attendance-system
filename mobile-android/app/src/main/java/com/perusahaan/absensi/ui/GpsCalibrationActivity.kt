package com.perusahaan.absensi.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.perusahaan.absensi.R
import java.util.Locale

class GpsCalibrationActivity : AppCompatActivity() {
    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var textStatus: TextView
    private lateinit var textCoordinate: TextView
    private lateinit var textAccuracy: TextView
    private lateinit var textSamples: TextView
    private lateinit var progress: ProgressBar
    private lateinit var btnStart: Button
    private var bestLocation: Location? = null
    private var sampleCount = 0
    private var stableFixCount = 0
    private var running = false

    private val timeout = Runnable {
        stopCalibration()
        val best = bestLocation
        if (best == null) {
            showStatus("Koordinat belum ditemukan. Pindah ke area terbuka lalu ulangi.", false)
        } else {
            showStatus("Pengukuran selesai. Akurasi terbaik ±${best.accuracy.toInt()} meter.", best.accuracy <= GOOD_ACCURACY_METERS)
        }
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach(::processLocation)
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCalibration()
        else showStatus("Izin lokasi presisi diperlukan untuk kalibrasi GPS.", false)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_gps_calibration)
        textStatus = findViewById(R.id.textGpsStatus)
        textCoordinate = findViewById(R.id.textGpsCoordinate)
        textAccuracy = findViewById(R.id.textGpsAccuracy)
        textSamples = findViewById(R.id.textGpsSamples)
        progress = findViewById(R.id.progressGpsCalibration)
        btnStart = findViewById(R.id.btnStartGpsCalibration)

        findViewById<View>(R.id.btnBackGpsCalibration).setOnClickListener { finish() }
        findViewById<View>(R.id.btnOpenLocationSettings).setOnClickListener {
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
        btnStart.setOnClickListener { ensurePermissionAndStart() }
    }

    private fun ensurePermissionAndStart() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) startCalibration() else permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    @SuppressLint("MissingPermission")
    private fun startCalibration() {
        val manager = getSystemService(LOCATION_SERVICE) as LocationManager
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            showStatus("GPS belum aktif. Aktifkan lokasi perangkat lalu mulai lagi.", false)
            return
        }

        stopCalibration()
        bestLocation = null
        sampleCount = 0
        stableFixCount = 0
        running = true
        progress.visibility = View.VISIBLE
        btnStart.isEnabled = false
        textCoordinate.text = "Latitude: —\nLongitude: —"
        textAccuracy.text = "Akurasi: menunggu fix GPS"
        textSamples.text = "Sampel valid: 0"
        showStatus("Mencari koordinat presisi. Berdiri di area terbuka dan jangan berpindah.", true)

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L)
            .setMinUpdateIntervalMillis(500L)
            .setWaitForAccurateLocation(true)
            .build()
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        handler.postDelayed(timeout, CALIBRATION_TIMEOUT_MS)
    }

    private fun processLocation(location: Location) {
        if (!running) return
        val isMock = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
        if (isMock) {
            stopCalibration()
            showStatus("Lokasi mock/Fake GPS terdeteksi. Kalibrasi dibatalkan.", false)
            return
        }
        if (!location.hasAccuracy() || location.accuracy <= 0f) return
        if (System.currentTimeMillis() - location.time > MAX_FIX_AGE_MS) return

        sampleCount += 1
        val best = bestLocation
        if (best == null || location.accuracy < best.accuracy) bestLocation = location
        val display = bestLocation ?: location
        textCoordinate.text = String.format(
            Locale.US,
            "Latitude: %.7f\nLongitude: %.7f",
            display.latitude,
            display.longitude
        )
        textAccuracy.text = "Akurasi terbaik: ±${display.accuracy.toInt()} meter"
        textSamples.text = "Sampel valid: $sampleCount"

        stableFixCount = if (location.accuracy <= TARGET_ACCURACY_METERS) stableFixCount + 1 else 0
        when {
            stableFixCount >= REQUIRED_STABLE_FIXES -> {
                stopCalibration()
                showStatus("GPS siap digunakan. Koordinat presisi sudah stabil.", true)
            }
            display.accuracy <= GOOD_ACCURACY_METERS ->
                showStatus("Koordinat sudah baik. Menunggu kestabilan tambahan…", true)
            else -> showStatus("Sinyal ditemukan, masih meningkatkan akurasi…", true)
        }
    }

    private fun stopCalibration() {
        if (running) client.removeLocationUpdates(callback)
        running = false
        handler.removeCallbacks(timeout)
        if (::progress.isInitialized) progress.visibility = View.GONE
        if (::btnStart.isInitialized) {
            btnStart.isEnabled = true
            btnStart.text = if (bestLocation == null) "Mulai Kalibrasi" else "Ulangi Kalibrasi"
        }
    }

    private fun showStatus(message: String, positive: Boolean) {
        textStatus.text = message
        textStatus.setTextColor(Color.parseColor(if (positive) "#166534" else "#B91C1C"))
    }

    override fun onPause() {
        super.onPause()
        stopCalibration()
    }

    companion object {
        private const val CALIBRATION_TIMEOUT_MS = 45_000L
        private const val MAX_FIX_AGE_MS = 5_000L
        private const val TARGET_ACCURACY_METERS = 15f
        private const val GOOD_ACCURACY_METERS = 25f
        private const val REQUIRED_STABLE_FIXES = 3
    }
}
