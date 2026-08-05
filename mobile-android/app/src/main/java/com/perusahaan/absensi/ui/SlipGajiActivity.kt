package com.perusahaan.absensi.ui

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.perusahaan.absensi.R
import com.perusahaan.absensi.data.SessionManager
import com.perusahaan.absensi.network.RetrofitClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.Calendar

class SlipGajiActivity : AppCompatActivity() {

    private lateinit var btnBack: ImageView
    private lateinit var spinnerBulan: Spinner
    private lateinit var spinnerTahun: Spinner
    private lateinit var btnUnduh: Button
    private lateinit var progressDownload: ProgressBar
    private lateinit var tvStatus: TextView

    private val namaBulan = arrayOf(
        "Januari","Februari","Maret","April","Mei","Juni",
        "Juli","Agustus","September","Oktober","November","Desember"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_slip_gaji)

        btnBack         = findViewById(R.id.btnBack)
        spinnerBulan    = findViewById(R.id.spinnerBulan)
        spinnerTahun    = findViewById(R.id.spinnerTahun)
        btnUnduh        = findViewById(R.id.btnUnduhSlip)
        progressDownload = findViewById(R.id.progressDownload)
        tvStatus        = findViewById(R.id.tvStatusDownload)

        btnBack.setOnClickListener { finish() }

        // Spinner Bulan
        val bulanAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, namaBulan)
        bulanAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinnerBulan.adapter = bulanAdapter
        val bulanSekarang = Calendar.getInstance().get(Calendar.MONTH)
        spinnerBulan.setSelection(bulanSekarang)

        // Spinner Tahun (5 tahun kebelakang)
        val tahunSekarang = Calendar.getInstance().get(Calendar.YEAR)
        val listTahun = (tahunSekarang downTo tahunSekarang - 4).map { it.toString() }.toTypedArray()
        val tahunAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, listTahun)
        tahunAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinnerTahun.adapter = tahunAdapter

        btnUnduh.setOnClickListener {
            tampilkanKonfirmasiRahasia()
        }
    }

    // ── Popup konfirmasi peringatan rahasia ───────────────────────────────────
    private fun tampilkanKonfirmasiRahasia() {
        AlertDialog.Builder(this)
            .setTitle("⚠ Perhatian Penting")
            .setMessage(
                "Slip gaji bersifat rahasia, dilarang menyebarluaskan!\n\n" +
                "Jika ketahuan akan dikenakan sanksi tegas oleh perusahaan.\n\n" +
                "File PDF akan dilindungi dengan password akun Anda. Pastikan Anda mengingat password login untuk membuka file."
            )
            .setIcon(android.R.drawable.ic_dialog_alert)
            .setPositiveButton("OK, Saya Mengerti") { _, _ ->
                mulaiUnduh()
            }
            .setNegativeButton("Batal", null)
            .setCancelable(false)
            .show()
    }

    // ── Proses Unduh PDF ──────────────────────────────────────────────────────
    private fun mulaiUnduh() {
        val bulan  = spinnerBulan.selectedItemPosition + 1
        val tahun  = spinnerTahun.selectedItem.toString().toInt()
        val bulanNama = namaBulan[bulan - 1]

        val password = SessionManager.getPassword()
        if (password.isNullOrBlank()) {
            AlertDialog.Builder(this)
                .setTitle("Sesi Habis")
                .setMessage("Password sesi tidak ditemukan. Silakan logout dan login kembali untuk mengunduh slip gaji.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        btnUnduh.isEnabled = false
        progressDownload.visibility = View.VISIBLE
        tvStatus.text = "Sedang membuat slip gaji $bulanNama $tahun..."
        tvStatus.setTextColor(resources.getColor(android.R.color.holo_green_dark, theme))
        tvStatus.visibility = View.VISIBLE

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = RetrofitClient.api.unduhSlipGaji(bulan, tahun, password)

                withContext(Dispatchers.Main) {
                    if (response.isSuccessful && response.body() != null) {
                        val namaFile = "SlipGaji_${bulanNama}_${tahun}.pdf"
                        val inputStream = response.body()!!.byteStream()
                        simpanPdfKeDownloads(inputStream, namaFile, bulanNama, tahun)
                    } else {
                        val errMsg = response.errorBody()?.string() ?: "Terjadi kesalahan"
                        tampilkanError("Gagal mengunduh slip gaji:\n$errMsg")
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    tampilkanError("Error: ${e.message}")
                }
            }
        }
    }

    // ── Simpan PDF ke folder Downloads ───────────────────────────────────────
    private fun simpanPdfKeDownloads(inputStream: InputStream, namaFile: String, bulanNama: String, tahun: Int) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val savedUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+ : Gunakan MediaStore
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, namaFile)
                        put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SlipGaji")
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = applicationContext.contentResolver
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    uri?.let { u ->
                        resolver.openOutputStream(u)?.use { out ->
                            inputStream.copyTo(out)
                        }
                        values.clear()
                        values.put(MediaStore.Downloads.IS_PENDING, 0)
                        resolver.update(u, values, null, null)
                    }
                    uri
                } else {
                    // Android 9 ke bawah
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    val slipDir = File(dir, "SlipGaji")
                    if (!slipDir.exists()) slipDir.mkdirs()
                    val file = File(slipDir, namaFile)
                    FileOutputStream(file).use { out -> inputStream.copyTo(out) }
                    Uri.fromFile(file)
                }

                withContext(Dispatchers.Main) {
                    progressDownload.visibility = View.GONE
                    btnUnduh.isEnabled = true
                    tvStatus.text = "✅ Slip gaji $bulanNama $tahun berhasil diunduh!\nCek folder Downloads > SlipGaji"
                    tvStatus.setTextColor(resources.getColor(android.R.color.holo_green_dark, theme))

                    // Tawarkan buka file PDF
                    if (savedUri != null) {
                        AlertDialog.Builder(this@SlipGajiActivity)
                            .setTitle("✅ Unduhan Selesai")
                            .setMessage(
                                "Slip gaji $bulanNama $tahun berhasil diunduh.\n\n" +
                                "File disimpan di: Downloads/SlipGaji/$namaFile\n\n" +
                                "Masukkan password akun Anda saat diminta untuk membuka file PDF."
                            )
                            .setPositiveButton("Buka File") { _, _ ->
                                bukaFilePdf(savedUri)
                            }
                            .setNegativeButton("Nanti", null)
                            .show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    tampilkanError("Gagal menyimpan file: ${e.message}")
                }
            }
        }
    }

    private fun bukaFilePdf(uri: Uri) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "Tidak ada aplikasi PDF. Buka dari folder Downloads.", Toast.LENGTH_LONG).show()
        }
    }

    private fun tampilkanError(pesan: String) {
        progressDownload.visibility = View.GONE
        btnUnduh.isEnabled = true
        tvStatus.text = "❌ $pesan"
        tvStatus.setTextColor(resources.getColor(android.R.color.holo_red_dark, theme))
        tvStatus.visibility = View.VISIBLE
    }
}
