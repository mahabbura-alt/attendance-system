package com.perusahaan.absensi.ui

import android.app.DatePickerDialog
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.perusahaan.absensi.R
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.AbsensiDto
import com.perusahaan.absensi.util.WibDateTimeFormatter
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

class RiwayatActivity : AppCompatActivity() {
    private lateinit var listRiwayat: LinearLayout
    private lateinit var progressRiwayat: View
    private lateinit var textKosong: TextView
    private lateinit var btnTanggalMulai: MaterialButton
    private lateinit var btnTanggalAkhir: MaterialButton
    private lateinit var btnTerapkan: MaterialButton
    private var tanggalMulai: LocalDate = LocalDate.now().withDayOfMonth(1)
    private var tanggalAkhir: LocalDate = LocalDate.now()
    private val displayDateFormat = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale("id", "ID"))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_riwayat)
        listRiwayat = findViewById(R.id.listRiwayat)
        progressRiwayat = findViewById(R.id.progressRiwayat)
        textKosong = findViewById(R.id.textRiwayatKosong)
        btnTanggalMulai = findViewById(R.id.btnTanggalMulaiRiwayat)
        btnTanggalAkhir = findViewById(R.id.btnTanggalAkhirRiwayat)
        btnTerapkan = findViewById(R.id.btnTerapkanPeriodeRiwayat)
        findViewById<View>(R.id.btnKembaliRiwayat).setOnClickListener { finish() }
        btnTanggalMulai.setOnClickListener {
            pilihTanggal(tanggalMulai) { selected ->
                tanggalMulai = selected
                if (tanggalAkhir.isBefore(selected)) tanggalAkhir = selected
                perbaruiLabelPeriode()
            }
        }
        btnTanggalAkhir.setOnClickListener {
            pilihTanggal(tanggalAkhir) { selected ->
                tanggalAkhir = selected
                if (tanggalMulai.isAfter(selected)) tanggalMulai = selected
                perbaruiLabelPeriode()
            }
        }
        btnTerapkan.setOnClickListener { muatRiwayat() }
        perbaruiLabelPeriode()
        muatRiwayat()
    }

    private fun muatRiwayat() {
        progressRiwayat.visibility = View.VISIBLE
        btnTerapkan.isEnabled = false
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.riwayat(tanggalMulai.toString(), tanggalAkhir.toString())
                if (response.isSuccessful) renderRiwayat(response.body().orEmpty())
                else Toast.makeText(this@RiwayatActivity, "Gagal memuat riwayat (${response.code()})", Toast.LENGTH_LONG).show()
            } catch (error: Exception) {
                Toast.makeText(this@RiwayatActivity, "Gagal terhubung: ${error.message}", Toast.LENGTH_LONG).show()
            } finally {
                progressRiwayat.visibility = View.GONE
                btnTerapkan.isEnabled = true
            }
        }
    }

    private fun perbaruiLabelPeriode() {
        btnTanggalMulai.text = tanggalMulai.format(displayDateFormat)
        btnTanggalAkhir.text = tanggalAkhir.format(displayDateFormat)
    }

    private fun pilihTanggal(initial: LocalDate, onSelected: (LocalDate) -> Unit) {
        DatePickerDialog(
            this,
            { _, year, month, day -> onSelected(LocalDate.of(year, month + 1, day)) },
            initial.year,
            initial.monthValue - 1,
            initial.dayOfMonth
        ).show()
    }

    private fun renderRiwayat(items: List<AbsensiDto>) {
        listRiwayat.removeAllViews()
        textKosong.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        items.forEach { item ->
            val datang = WibDateTimeFormatter.time(item.waktu_datang) ?: "—"
            val pulang = WibDateTimeFormatter.time(item.waktu_pulang) ?: "Belum checkout"
            val status = listOfNotNull(item.status_datang, item.status_pulang)
                .joinToString(" • ").ifBlank { "—" }
            val card = TextView(this).apply {
                text = "${item.tanggal_kerja}\nDatang: $datang   |   Pulang: $pulang\nStatus: $status"
                textSize = 14f
                setTextColor(Color.parseColor("#1F2937"))
                setBackgroundColor(Color.WHITE)
                setPadding(18, 16, 18, 16)
                gravity = Gravity.START
            }
            listRiwayat.addView(card, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 12) })
        }
    }
}
