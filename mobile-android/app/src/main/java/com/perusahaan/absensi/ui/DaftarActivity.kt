package com.perusahaan.absensi.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.perusahaan.absensi.R
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.OpsiPendaftaranDto
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.io.ByteArrayOutputStream
import java.io.File

class DaftarActivity : AppCompatActivity() {

    private lateinit var inputNama: EditText
    private lateinit var inputEmail: EditText
    private lateinit var spinnerDepartemen: Spinner
    private lateinit var spinnerJabatan: Spinner
    private lateinit var spinnerLokasi: Spinner
    private lateinit var btnFoto1: Button
    private lateinit var inputPassword: EditText
    private lateinit var inputKonfirmasi: EditText
    private lateinit var btnDaftar: Button
    private lateinit var textPesan: TextView
    private lateinit var progressDaftar: ProgressBar
    private lateinit var textKembali: TextView

    // CameraX Overlay Views
    private lateinit var layoutCameraOverlay: RelativeLayout
    private lateinit var cameraPreviewDaftar: PreviewView
    private lateinit var textJudulFoto: TextView
    private lateinit var btnBatalKamera: Button
    private lateinit var btnAmbilFotoKamera: Button
    private var imageCapture: ImageCapture? = null

    private var daftarLokasi: List<OpsiPendaftaranDto.LokasiItem> = emptyList()
    private var mapDepartemenJabatan: Map<String, List<String>> = mapOf(
        "Produksi" to listOf("SPV Produksi", "Pengawas", "Operator", "Driver DT", "Driver WT", "Checker"),
        "Engineering" to listOf("SPV Engineering", "Mine Plan", "Foreman Moco", "Admin", "Surveyor", "Ast Survey", "Helper Survey"),
        "Logistik" to listOf("Foreman Logistik", "Logistik", "Admin", "Fuelman", "Ekspeditor"),
        "HSE" to listOf("SPV HSE", "HSE Officer", "Safety Patrol", "Helper HSE"),
        "Maintenance" to listOf("SPV Maintenance", "Foreman Maintenance", "Mekanik", "Welder", "Auto Electrician", "Admin Maintenance", "Helper Maintenance", "Helper Mekanik"),
        "HRGA & Finance" to listOf("Foreman HR", "Admin HR", "Admin Finance", "Driver Sarana"),
        "Management" to listOf("PJO")
    )

    private var listDepartemen: List<String> = emptyList()

    private var foto1Bytes: ByteArray? = null

    private var fotoTargetAktif = 1

    private val requestCameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            bukaInAppKamera(fotoTargetAktif)
        } else {
            tampilkanPesan("Izin kamera diperlukan untuk mengambil foto sampel", isError = true)
        }
    }

    private val pickImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    simpanBytesFoto(bytes)
                }
            } catch (e: Exception) {
                tampilkanPesan("Gagal membaca foto galeri: ${e.message}", isError = true)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_daftar)

        inputNama          = findViewById(R.id.inputNama)
        inputEmail         = findViewById(R.id.inputEmail)
        spinnerDepartemen  = findViewById(R.id.spinnerDepartemen)
        spinnerJabatan     = findViewById(R.id.spinnerJabatan)
        spinnerLokasi      = findViewById(R.id.spinnerLokasi)
        btnFoto1           = findViewById(R.id.btnFoto1)
        inputPassword      = findViewById(R.id.inputPassword)
        inputKonfirmasi    = findViewById(R.id.inputKonfirmasiPassword)
        btnDaftar          = findViewById(R.id.btnDaftar)
        textPesan          = findViewById(R.id.textPesan)
        progressDaftar     = findViewById(R.id.progressDaftar)
        textKembali        = findViewById(R.id.textKembaliLogin)

        layoutCameraOverlay  = findViewById(R.id.layoutCameraOverlay)
        cameraPreviewDaftar  = findViewById(R.id.cameraPreviewDaftar)
        textJudulFoto        = findViewById(R.id.textJudulFoto)
        btnBatalKamera       = findViewById(R.id.btnBatalKamera)
        btnAmbilFotoKamera   = findViewById(R.id.btnAmbilFotoKamera)

        setupSpinnersDepartemenJabatan()

        btnFoto1.setOnClickListener { pilihSumberFoto(1) }

        btnBatalKamera.setOnClickListener {
            layoutCameraOverlay.visibility = View.GONE
        }

        btnAmbilFotoKamera.setOnClickListener {
            ambilFotoCameraX()
        }

        textKembali.setOnClickListener { finish() }
        btnDaftar.setOnClickListener { prosesDaftar() }

        muatOpsiPendaftaran()
    }

    private fun pilihSumberFoto(target: Int) {
        fotoTargetAktif = target
        val opsi = arrayOf("📸 Ambil dari Kamera", "📁 Pilih dari Galeri")
        MaterialAlertDialogBuilder(this)
            .setTitle("Pilih Foto Sampel $target")
            .setItems(opsi) { _, which ->
                if (which == 0) {
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        bukaInAppKamera(target)
                    } else {
                        requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                    }
                } else {
                    pickImageLauncher.launch("image/*")
                }
            }
            .show()
    }

    private fun bukaInAppKamera(target: Int) {
        fotoTargetAktif = target
        textJudulFoto.text = "Posisikan Wajah Tampak Depan dengan Jelas"
        layoutCameraOverlay.visibility = View.VISIBLE
        startCameraX()
    }

    private fun startCameraX() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(cameraPreviewDaftar.surfaceProvider)
                }

                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()

                val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
            } catch (e: Exception) {
                tampilkanPesan("Gagal membuka kamera: ${e.message}", isError = true)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun ambilFotoCameraX() {
        val ic = imageCapture ?: return
        val tempFile = File.createTempFile("sample_${fotoTargetAktif}_", ".jpg", cacheDir)
        val outputOptions = ImageCapture.OutputFileOptions.Builder(tempFile).build()

        btnAmbilFotoKamera.isEnabled = false
        ic.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    btnAmbilFotoKamera.isEnabled = true
                    try {
                        val bytes = tempFile.readBytes()
                        tempFile.delete()
                        simpanBytesFoto(bytes)
                        layoutCameraOverlay.visibility = View.GONE
                    } catch (e: Exception) {
                        tampilkanPesan("Gagal memproses foto: ${e.message}", isError = true)
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    btnAmbilFotoKamera.isEnabled = true
                    tampilkanPesan("Gagal mengambil foto: ${exception.message}", isError = true)
                }
            }
        )
    }

    /**
     * Kompres gambar ke JPEG maks 640x640 px, kualitas 60%.
     * Memastikan total 3 foto < 4 MB agar lolos batas Vercel 4.5 MB.
     */
    private fun kompresiFoto(bytes: ByteArray): ByteArray {
        val original = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: return bytes

        // Hitung ukuran output agar tidak lebih dari 640px di sisi terpanjang
        val maxSize = 640
        val scale = if (original.width > original.height) {
            maxSize.toFloat() / original.width
        } else {
            maxSize.toFloat() / original.height
        }

        val bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                original,
                (original.width * scale).toInt(),
                (original.height * scale).toInt(),
                true
            )
        } else original

        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 60, out)
        return out.toByteArray()
    }

    private fun simpanBytesFoto(bytes: ByteArray) {
        val compressed = kompresiFoto(bytes)
        when (fotoTargetAktif) {
            1 -> {
                foto1Bytes = compressed
                btnFoto1.text = "✓ Foto Wajah Siap"
                btnFoto1.setBackgroundColor(Color.parseColor("#2E7D32"))
            }
        }
    }

    private fun setupSpinnersDepartemenJabatan() {
        listDepartemen = mapDepartemenJabatan.keys.toList()
        spinnerDepartemen.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            listDepartemen
        )

        spinnerDepartemen.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val selectedDept = listDepartemen.getOrNull(position) ?: return
                val listJabatan = mapDepartemenJabatan[selectedDept] ?: emptyList()

                spinnerJabatan.adapter = ArrayAdapter(
                    this@DaftarActivity,
                    android.R.layout.simple_spinner_dropdown_item,
                    listJabatan
                )
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun muatOpsiPendaftaran() {
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.opsiPendaftaran()
                if (response.isSuccessful && response.body() != null) {
                    val opsi = response.body()!!
                    daftarLokasi = opsi.lokasi

                    if (opsi.departemen_jabatan != null && opsi.departemen_jabatan.isNotEmpty()) {
                        mapDepartemenJabatan = opsi.departemen_jabatan
                        setupSpinnersDepartemenJabatan()
                    }

                    val namaLokasi = daftarLokasi.map { it.nama_lokasi }
                    spinnerLokasi.adapter = ArrayAdapter(
                        this@DaftarActivity,
                        android.R.layout.simple_spinner_dropdown_item,
                        namaLokasi.ifEmpty { listOf("(belum ada lokasi)") }
                    )
                }
            } catch (e: Exception) {
                tampilkanPesan("Gagal memuat opsi lokasi: ${e.message}", isError = true)
            }
        }
    }

    private fun String.toPart(): RequestBody {
        return this.toRequestBody("text/plain".toMediaTypeOrNull())
    }

    private fun ByteArray.toMultipart(name: String, filename: String): MultipartBody.Part {
        val body = this.toRequestBody("image/jpeg".toMediaTypeOrNull())
        return MultipartBody.Part.createFormData(name, filename, body)
    }

    private fun prosesDaftar() {
        val nama       = inputNama.text.toString().trim()
        val email      = inputEmail.text.toString().trim()
        val dept       = spinnerDepartemen.selectedItem?.toString() ?: ""
        val jabatan    = spinnerJabatan.selectedItem?.toString() ?: ""
        val password   = inputPassword.text.toString()
        val konfirmasi = inputKonfirmasi.text.toString()

        if (nama.isEmpty() || email.isEmpty() || password.isEmpty()) {
            tampilkanPesan("Nama, Email, dan Password wajib diisi", isError = true)
            return
        }
        if (password.length < 8) {
            tampilkanPesan("Password minimal 8 karakter", isError = true)
            return
        }
        if (password != konfirmasi) {
            tampilkanPesan("Konfirmasi password tidak cocok", isError = true)
            return
        }
        if (foto1Bytes == null) {
            tampilkanPesan("Wajib mengambil foto wajah sebelum mendaftar", isError = true)
            return
        }

        val lokasiId = daftarLokasi.getOrNull(spinnerLokasi.selectedItemPosition)?.id

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.daftar(
                    nama = nama.toPart(),
                    email = email.toPart(),
                    jabatan = jabatan.toPart(),
                    departemen = dept.toPart(),
                    password = password.toPart(),
                    shiftId = null,
                    lokasiId = lokasiId?.toPart(),
                    foto1 = foto1Bytes?.toMultipart("foto1", "sample1.jpg"),
                    foto2 = null,
                    foto3 = null
                )
                if (response.isSuccessful) {
                    tampilkanPesan(
                        "✅ Pendaftaran berhasil dikirim!\nDepartemen: $dept | Jabatan: $jabatan\nAkun akan aktif setelah disetujui admin.",
                        isError = false
                    )
                    btnDaftar.isEnabled = false
                } else {
                    val pesan = response.errorBody()?.string() ?: "Pendaftaran gagal"
                    tampilkanPesan(pesan, isError = true)
                }
            } catch (e: Exception) {
                tampilkanPesan("Gagal terhubung ke server: ${e.message}", isError = true)
            } finally {
                setLoading(false)
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressDaftar.visibility = if (loading) View.VISIBLE else View.GONE
        btnDaftar.isEnabled = !loading
    }

    private fun tampilkanPesan(pesan: String, isError: Boolean) {
        runOnUiThread {
            textPesan.text = pesan
            textPesan.setTextColor(
                if (isError) Color.parseColor("#D32F2F")
                else Color.parseColor("#2E7D32")
            )
            textPesan.visibility = View.VISIBLE
        }
    }
}
