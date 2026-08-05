package com.perusahaan.absensi.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
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
import java.io.File

class DaftarActivity : AppCompatActivity() {

    private lateinit var inputNama: EditText
    private lateinit var inputEmail: EditText
    private lateinit var spinnerDepartemen: Spinner
    private lateinit var spinnerJabatan: Spinner
    private lateinit var spinnerLokasi: Spinner
    private lateinit var btnFoto1: Button
    private lateinit var btnFoto2: Button
    private lateinit var btnFoto3: Button
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
        "Produksi" to listOf("SPV Produksi", "Pengawas", "Operator", "Driver DT", "Driver WT"),
        "Engineering" to listOf("SPV Engineering", "Mine Plan", "Foreman Moco", "Admin", "Surveyor", "Ast Survey", "Helper Survey"),
        "Logistik" to listOf("Foreman Logistik", "Logistik", "Admin", "Fuelman", "Ekspeditor"),
        "HSE" to listOf("SPV HSE", "HSE Officer", "Safety Patrol", "Helper HSE"),
        "HRGA & Finance" to listOf("Foreman HR", "Admin HR", "Admin Finance", "Driver Sarana"),
        "Management" to listOf("PJO")
    )

    private var listDepartemen: List<String> = emptyList()

    private var foto1Bytes: ByteArray? = null
    private var foto2Bytes: ByteArray? = null
    private var foto3Bytes: ByteArray? = null

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
        btnFoto2           = findViewById(R.id.btnFoto2)
        btnFoto3           = findViewById(R.id.btnFoto3)
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
        btnFoto2.setOnClickListener { pilihSumberFoto(2) }
        btnFoto3.setOnClickListener { pilihSumberFoto(3) }

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
        textJudulFoto.text = when (target) {
            1 -> "Posisikan Wajah untuk Foto 1 (Tampak Depan)"
            2 -> "Posisikan Wajah untuk Foto 2 (Miring Kiri)"
            else -> "Posisikan Wajah untuk Foto 3 (Miring Kanan)"
        }
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

    private fun simpanBytesFoto(bytes: ByteArray) {
        when (fotoTargetAktif) {
            1 -> {
                foto1Bytes = bytes
                btnFoto1.text = "✓ Foto 1 Siap"
                btnFoto1.setBackgroundColor(Color.parseColor("#2E7D32"))
            }
            2 -> {
                foto2Bytes = bytes
                btnFoto2.text = "✓ Foto 2 Siap"
                btnFoto2.setBackgroundColor(Color.parseColor("#2E7D32"))
            }
            3 -> {
                foto3Bytes = bytes
                btnFoto3.text = "✓ Foto 3 Siap"
                btnFoto3.setBackgroundColor(Color.parseColor("#2E7D32"))
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
        if (foto1Bytes == null || foto2Bytes == null || foto3Bytes == null) {
            tampilkanPesan("Wajib memilih 3 sampel foto wajah sebelum mendaftar", isError = true)
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
                    foto2 = foto2Bytes?.toMultipart("foto2", "sample2.jpg"),
                    foto3 = foto3Bytes?.toMultipart("foto3", "sample3.jpg")
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
