package com.perusahaan.absensi.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.LocationServices
import com.perusahaan.absensi.R
import com.perusahaan.absensi.data.SessionManager
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.ui.widget.MinimapView
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class HomeActivity : AppCompatActivity() {

    private lateinit var textSelamatDatang: TextView
    private lateinit var textJamSekarang: TextView
    private lateinit var btnAbsenDatang: Button
    private lateinit var btnAbsenPulang: Button
    private lateinit var btnLogout: Button
    private lateinit var textSesiPendingWarning: TextView
    private lateinit var gridKalender: GridLayout
    private lateinit var progressRekap: ProgressBar
    private lateinit var minimapView: MinimapView
    private lateinit var progressMinimap: ProgressBar

    private val handler = Handler(Looper.getMainLooper())
    private var adaSesiPending = false

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) ambilLokasiDevice()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        textSelamatDatang     = findViewById(R.id.textSelamatDatang)
        textJamSekarang       = findViewById(R.id.textJamSekarang)
        btnAbsenDatang        = findViewById(R.id.btnAbsenDatang)
        btnAbsenPulang        = findViewById(R.id.btnAbsenPulang)
        btnLogout             = findViewById(R.id.btnLogout)
        textSesiPendingWarning = findViewById(R.id.textSesiPendingWarning)
        gridKalender          = findViewById(R.id.gridKalender)
        progressRekap         = findViewById(R.id.progressRekap)
        minimapView           = findViewById(R.id.minimapView)
        progressMinimap       = findViewById(R.id.progressMinimap)

        textSelamatDatang.text = "Halo, ${SessionManager.getUserNama() ?: "Karyawan"} 👋"

        btnAbsenDatang.setOnClickListener { bukaAbsen(ModeAbsen.DATANG) }
        btnAbsenPulang.setOnClickListener { bukaAbsen(ModeAbsen.PULANG) }

        findViewById<View>(R.id.btnMenuRekapHm).setOnClickListener {
            startActivity(Intent(this, RekapHmActivity::class.java))
        }

        findViewById<View>(R.id.btnMenuSlipGaji).setOnClickListener {
            startActivity(Intent(this, SlipGajiActivity::class.java))
        }

        btnLogout.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Keluar")
                .setMessage("Yakin ingin keluar dari akun?")
                .setPositiveButton("Ya, Keluar") { _, _ ->
                    SessionManager.clearSession()
                    startActivity(Intent(this, LoginActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    })
                    finish()
                }
                .setNegativeButton("Batal", null)
                .show()
        }
    }

    override fun onResume() {
        super.onResume()
        mulaiJamBerjalan()
        cekSesiPending()
        muatRekap()
        muatMinimap()
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacksAndMessages(null)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // JAM BERJALAN
    // ──────────────────────────────────────────────────────────────────────────
    private fun mulaiJamBerjalan() {
        val fmt = SimpleDateFormat("HH:mm:ss", Locale("id", "ID"))
        val r = object : Runnable {
            override fun run() {
                textJamSekarang.text = fmt.format(Date())
                handler.postDelayed(this, 1000)
            }
        }
        handler.post(r)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // CEK SESI PENDING
    // ──────────────────────────────────────────────────────────────────────────
    private fun cekSesiPending() {
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.riwayat()
                if (response.isSuccessful) {
                    val daftar = response.body().orEmpty()
                    adaSesiPending = daftar.any { it.waktu_pulang == null }
                    textSesiPendingWarning.visibility = if (adaSesiPending) View.VISIBLE else View.GONE
                    btnAbsenDatang.isEnabled = !adaSesiPending
                }
            } catch (_: Exception) {}
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // KALENDER REKAP KEHADIRAN
    // ──────────────────────────────────────────────────────────────────────────
    private fun muatRekap() {
        progressRekap.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.rekapKehadiran()
                if (response.isSuccessful) {
                    val daftar = response.body().orEmpty()
                    renderKalender(daftar)
                }
            } catch (_: Exception) {
            } finally {
                progressRekap.visibility = View.GONE
            }
        }
    }

    private fun renderKalender(daftar: List<com.perusahaan.absensi.network.dto.RekapHarianDto>) {
        gridKalender.removeAllViews()
        val fmtIn = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val fmtTgl = SimpleDateFormat("d", Locale.US)
        val fmtBulan = SimpleDateFormat("MMM", Locale("id", "ID"))

        daftar.forEach { item ->
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(4, 4, 4, 4)
            }

            val warna = when (item.status) {
                "hadir"       -> Color.parseColor("#4CAF50") // hijau
                "telat"       -> Color.parseColor("#FFC107") // kuning
                "izin", "sakit", "cuti", "off" -> Color.parseColor("#2196F3") // biru
                else          -> Color.parseColor("#F44336") // merah = tidak absen
            }

            val tanggalView = TextView(this).apply {
                try {
                    val d = fmtIn.parse(item.tanggal)
                    val tgl = if (d != null) fmtTgl.format(d) else "?"
                    val bln = if (d != null) fmtBulan.format(d) else ""
                    text = "$tgl\n$bln"
                } catch (_: Exception) { text = "?" }
                textSize = 9f
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                setPadding(0, 6, 0, 6)
                setBackgroundColor(warna)
            }

            cell.addView(tanggalView, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))

            val lp = GridLayout.LayoutParams().apply {
                width = 0
                height = GridLayout.LayoutParams.WRAP_CONTENT
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(2, 2, 2, 2)
            }
            gridKalender.addView(cell, lp)
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // MINIMAP
    // ──────────────────────────────────────────────────────────────────────────
    private fun muatMinimap() {
        progressMinimap.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.lokasiKantor()
                if (response.isSuccessful && response.body() != null) {
                    val lok = response.body()!!
                    minimapView.setKantor(lok.latitude, lok.longitude, lok.radius_meter, lok.nama_lokasi)
                    // Setelah dapat lokasi kantor, ambil posisi device
                    runOnUiThread { ambilLokasiDevice() }
                }
            } catch (_: Exception) {
            } finally {
                progressMinimap.visibility = View.GONE
            }
        }
    }

    private fun ambilLokasiDevice() {
        val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!ok) {
            locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            return
        }
        try {
            LocationServices.getFusedLocationProviderClient(this)
                .lastLocation
                .addOnSuccessListener { loc ->
                    if (loc != null) minimapView.setDevicePosition(loc.latitude, loc.longitude)
                }
        } catch (_: Exception) {}
    }

    // ──────────────────────────────────────────────────────────────────────────
    // NAVIGASI
    // ──────────────────────────────────────────────────────────────────────────
    private fun bukaAbsen(mode: ModeAbsen) {
        val intent = Intent(this, AbsenActivity::class.java)
        intent.putExtra(AbsenActivity.EXTRA_MODE, mode.name)
        startActivity(intent)
    }
}

enum class ModeAbsen { DATANG, PULANG }
