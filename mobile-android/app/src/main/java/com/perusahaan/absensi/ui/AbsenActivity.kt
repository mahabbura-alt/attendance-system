package com.perusahaan.absensi.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.TextView
import android.widget.ProgressBar
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.perusahaan.absensi.R
import com.perusahaan.absensi.face.LivenessAnalyzer
import com.perusahaan.absensi.location.LokasiResult
import com.perusahaan.absensi.location.ambilLokasiSaatIni
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.OpsiPendaftaranDto
import com.perusahaan.absensi.network.dto.CheckLokasiRequest
import android.widget.LinearLayout
import android.widget.FrameLayout
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class AbsenActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_MODE = "mode"
    }

    private lateinit var cameraPreview: PreviewView
    private lateinit var textStatus: TextView
    private lateinit var progressAbsen: ProgressBar
    private lateinit var layoutLoadingLokasi: LinearLayout
    private lateinit var layoutCamera: FrameLayout
    private var validLat: Double = 0.0
    private var validLng: Double = 0.0

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var mode: ModeAbsen
    private lateinit var livenessAnalyzer: LivenessAnalyzer

    private var imageCapture: ImageCapture? = null
    private var sedangMemproses = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { hasil ->
        val semuaDiizinkan = hasil.values.all { it }
        if (semuaDiizinkan) {
            cekLokasiServer()
        } else {
            textStatus.text = "Izin kamera & lokasi wajib diberikan untuk absen"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_absen)

        mode = ModeAbsen.valueOf(intent.getStringExtra(EXTRA_MODE) ?: ModeAbsen.DATANG.name)

        cameraPreview = findViewById(R.id.cameraPreview)
        textStatus    = findViewById(R.id.textStatus)
        progressAbsen = findViewById(R.id.progressAbsen)
        layoutLoadingLokasi = findViewById(R.id.layoutLoadingLokasi)
        layoutCamera  = findViewById(R.id.layoutCamera)

        cameraExecutor = Executors.newSingleThreadExecutor()

        livenessAnalyzer = LivenessAnalyzer(
            onFaceTerdeteksi = { runOnUiThread { textStatus.text = "Wajah terdeteksi! Berkedip atau TAP LAYAR untuk absen" } },
            onKedipanTerdeteksi = { runOnUiThread { ambilFotoDanKirim() } },
            onTidakAdaWajah = { runOnUiThread { textStatus.text = "Posisikan wajah Anda (atau TAP LAYAR untuk foto)" } }
        )

        // Memungkinkan tap layar langsung untuk mengambil foto saat testing di emulator
        cameraPreview.setOnClickListener { ambilFotoDanKirim() }
        textStatus.setOnClickListener { ambilFotoDanKirim() }

        cekPermission()
    }

    private fun cekPermission() {
        val diperlukan = arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION)
        val belumDiizinkan = diperlukan.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (belumDiizinkan.isEmpty()) {
            cekLokasiServer()
        } else {
            permissionLauncher.launch(belumDiizinkan.toTypedArray())
        }
    }

    private fun mulaiKamera() {
        runOnUiThread {
            layoutLoadingLokasi.visibility = View.GONE
            layoutCamera.visibility = View.VISIBLE
            textStatus.text = "Posisikan wajah Anda di dalam bingkai"
        }
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(cameraPreview.surfaceProvider)
            }

            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor) { imageProxy ->
                        if (!sedangMemproses) livenessAnalyzer.analisisFrame(imageProxy)
                        else imageProxy.close()
                    }
                }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            // Coba kamera depan dulu, fallback ke kamera belakang jika tidak ada
            val selector = if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                CameraSelector.DEFAULT_FRONT_CAMERA
            } else {
                runOnUiThread { textStatus.text = "Kamera depan tidak ada, menggunakan kamera belakang. TAP LAYAR untuk foto." }
                CameraSelector.DEFAULT_BACK_CAMERA
            }

            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, preview, analysis, imageCapture)
                runOnUiThread { textStatus.text = "Kamera siap. Posisikan wajah atau TAP LAYAR untuk absen." }
            } catch (e: Exception) {
                runOnUiThread { textStatus.text = "Gagal membuka kamera: ${e.message}" }
            }
        }, ContextCompat.getMainExecutor(this))
    }


    private fun cekLokasiServer() {
        lifecycleScope.launch {
            try {
                runOnUiThread {
                    textStatus.text = "Mencari koordinat GPS..."
                }
                val lokasi = ambilLokasiSaatIni(this@AbsenActivity)
                val location = when (lokasi) {
                    is LokasiResult.Sukses -> lokasi.location
                    is LokasiResult.MockTerdeteksi -> {
                        tampilkanGagalUtama("Lokasi palsu terdeteksi. Harap matikan Fake GPS.")
                        return@launch
                    }
                    is LokasiResult.Gagal -> {
                        tampilkanGagalUtama(lokasi.pesan)
                        return@launch
                    }
                }

                validLat = location.latitude
                validLng = location.longitude

                runOnUiThread {
                    textStatus.text = "Memverifikasi area absensi..."
                }

                val response = RetrofitClient.api.checkLokasi(CheckLokasiRequest(validLat, validLng))
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    if (body.valid) {
                        mulaiKamera()
                    } else {
                        tampilkanGagalUtama(body.message)
                    }
                } else {
                    tampilkanGagalUtama("Gagal menghubungi server untuk cek lokasi.")
                }
            } catch (e: Exception) {
                tampilkanGagalUtama("Terjadi kesalahan: ")
            }
        }
    }

    private fun tampilkanGagalUtama(pesan: String) {
        runOnUiThread {
            MaterialAlertDialogBuilder(this)
                .setTitle("Peringatan Lokasi")
                .setMessage(pesan)
                .setPositiveButton("Kembali") { _, _ -> finish() }
                .setCancelable(false)
                .show()
        }
    }

    private fun ambilFotoDanKirim() {
        if (sedangMemproses) return
        sedangMemproses = true
        progressAbsen.visibility = View.VISIBLE
        textStatus.text = "Memverifikasi..."

        val capture = imageCapture ?: run {
            tampilkanGagal("Kamera belum siap. Coba lagi.")
            return
        }
        val fotoFile = File.createTempFile("absen_", ".jpg", cacheDir)
        val outputOptions = ImageCapture.OutputFileOptions.Builder(fotoFile).build()

        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    val fotoBytes = try {
                        fotoFile.readBytes()
                    } finally {
                        fotoFile.delete()
                    }
                    prosesAbsen(fotoBytes)
                }

                override fun onError(exception: ImageCaptureException) {
                    fotoFile.delete()
                    runOnUiThread {
                        textStatus.text = "Gagal mengambil foto: ${exception.message}"
                        progressAbsen.visibility = View.GONE
                        sedangMemproses = false
                        livenessAnalyzer.reset()
                    }
                }
            }
        )
    }

    // muatDaftarShift removed
    private fun prosesAbsen(fotoBytes: ByteArray) {
        lifecycleScope.launch {
            try {
                runOnUiThread { textStatus.text = "Mengirim biometrik wajah..." }

                val latBody   = validLat.toString().toRequestBody("text/plain".toMediaTypeOrNull())
                val lngBody   = validLng.toString().toRequestBody("text/plain".toMediaTypeOrNull())
                val fotoBody  = fotoBytes.toRequestBody("image/jpeg".toMediaTypeOrNull())
                val fotoPart  = MultipartBody.Part.createFormData("foto", "absen.jpg", fotoBody)

                val response = if (mode == ModeAbsen.DATANG) {
                    RetrofitClient.api.absenDatang(latBody, lngBody, fotoPart)
                } else {
                    RetrofitClient.api.absenPulang(latBody, lngBody, fotoPart)
                }

                if (response.isSuccessful && response.body() != null) {
                    val hasil = response.body()!!
                    tampilkanSukses("✅ ${hasil.message}\nStatus: ${hasil.status}")
                } else {
                    val rawError = response.errorBody()?.string()
                    val pesanError = try {
                        val json = org.json.JSONObject(rawError ?: "")
                        json.optString("error", rawError ?: "Absen ditolak oleh server")
                    } catch (_: Exception) {
                        rawError ?: "Absen ditolak oleh server"
                    }
                    tampilkanGagal(pesanError)
                }
            } catch (e: Exception) {
                tampilkanGagal("Terjadi kesalahan: ${e.message}")
            }
        }
    }

    private fun tampilkanSukses(pesan: String) {
        runOnUiThread {
            textStatus.text = pesan
            progressAbsen.visibility = View.GONE
            MaterialAlertDialogBuilder(this)
                .setTitle("Absen Berhasil")
                .setMessage(pesan)
                .setPositiveButton("OK") { _, _ -> finish() }
                .setCancelable(false)
                .show()
        }
    }

    private fun tampilkanGagal(pesan: String) {
        runOnUiThread {
            textStatus.text = pesan
            progressAbsen.visibility = View.GONE
            sedangMemproses = false
            livenessAnalyzer.reset()
            MaterialAlertDialogBuilder(this)
                .setTitle("Absen Ditolak / Gagal")
                .setMessage(pesan)
                .setPositiveButton("Coba Lagi", null)
                .show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        livenessAnalyzer.tutup()
        cameraExecutor.shutdown()
    }
}
