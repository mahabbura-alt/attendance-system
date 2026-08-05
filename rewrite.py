import re

with open(r'D:\OneDrive\Desktop\PROJECT\mobile-android\app\src\main\java\com\perusahaan\absensi\ui\AbsenActivity.kt', 'r') as f:
    text = f.read()

# 1. Imports
text = text.replace(
    'import com.perusahaan.absensi.network.dto.OpsiPendaftaranDto',
    'import com.perusahaan.absensi.network.dto.OpsiPendaftaranDto\nimport com.perusahaan.absensi.network.dto.CheckLokasiRequest\nimport android.widget.LinearLayout\nimport android.widget.FrameLayout\nimport com.google.android.material.dialog.MaterialAlertDialogBuilder'
)

# 2. Variables
var_block = '''    private lateinit var cameraPreview: PreviewView
    private lateinit var textStatus: TextView
    private lateinit var progressAbsen: ProgressBar
    private lateinit var layoutLoadingLokasi: LinearLayout
    private lateinit var layoutCamera: FrameLayout
    private var validLat: Double = 0.0
    private var validLng: Double = 0.0'''
text = re.sub(
    r'    private lateinit var cameraPreview.*?\n    private lateinit var progressAbsen: ProgressBar',
    var_block, text, flags=re.DOTALL
)

# 3. permissionLauncher
text = text.replace('mulaiKamera()', 'cekLokasiServer()', 1)

# 4. onCreate findViewByIds
oncreate_views = '''        cameraPreview = findViewById(R.id.cameraPreview)
        textStatus    = findViewById(R.id.textStatus)
        progressAbsen = findViewById(R.id.progressAbsen)
        layoutLoadingLokasi = findViewById(R.id.layoutLoadingLokasi)
        layoutCamera  = findViewById(R.id.layoutCamera)'''
text = re.sub(
    r'        cameraPreview = findViewById.*?progressAbsen = findViewById\(R\.id\.progressAbsen\)',
    oncreate_views, text, flags=re.DOTALL
)

# 5. cekPermission
text = text.replace(
    'mulaiKamera()', 'cekLokasiServer()', 1  # 2nd occurrence in cekPermission
)

# 6. mulaiKamera() visibility changes
text = text.replace(
    'private fun mulaiKamera() {',
    '''private fun mulaiKamera() {
        runOnUiThread {
            layoutLoadingLokasi.visibility = View.GONE
            layoutCamera.visibility = View.VISIBLE
            textStatus.text = "Posisikan wajah Anda di dalam bingkai"
        }'''
)

# 7. Add cekLokasiServer() function
cek_lokasi_func = '''
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
'''
text = text.replace('    private fun ambilFotoDanKirim() {', cek_lokasi_func + '\n    private fun ambilFotoDanKirim() {')


# 8. prosesAbsen
proses_absen_old = '''    private fun prosesAbsen(fotoBytes: ByteArray) {
        lifecycleScope.launch {
            try {
                runOnUiThread { textStatus.text = "Mengambil lokasi GPS..." }

                val lokasi = ambilLokasiSaatIni(this@AbsenActivity)
                val location = when (lokasi) {
                    is LokasiResult.Sukses -> lokasi.location
                    is LokasiResult.MockTerdeteksi -> {
                        tampilkanGagal("Lokasi palsu (mock GPS) terdeteksi. Absen ditolak.")
                        return@launch
                    }
                    is LokasiResult.Gagal -> {
                        tampilkanGagal(lokasi.pesan)
                        return@launch
                    }
                }

                runOnUiThread { textStatus.text = "Mengirim data ke server..." }

                val latBody   = location.latitude.toString().toRequestBody("text/plain".toMediaTypeOrNull())
                val lngBody   = location.longitude.toString().toRequestBody("text/plain".toMediaTypeOrNull())'''

proses_absen_new = '''    private fun prosesAbsen(fotoBytes: ByteArray) {
        lifecycleScope.launch {
            try {
                runOnUiThread { textStatus.text = "Mengirim biometrik wajah..." }

                val latBody   = validLat.toString().toRequestBody("text/plain".toMediaTypeOrNull())
                val lngBody   = validLng.toString().toRequestBody("text/plain".toMediaTypeOrNull())'''

text = text.replace(proses_absen_old, proses_absen_new)

# 9. Update tampilkanGagal to use MaterialAlertDialogBuilder
text = text.replace(
    'androidx.appcompat.app.AlertDialog.Builder(this)',
    'MaterialAlertDialogBuilder(this)'
)

with open(r'D:\OneDrive\Desktop\PROJECT\mobile-android\app\src\main\java\com\perusahaan\absensi\ui\AbsenActivity.kt', 'w') as f:
    f.write(text)

print("Done rewrite")
