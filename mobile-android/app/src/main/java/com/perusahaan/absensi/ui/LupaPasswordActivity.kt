package com.perusahaan.absensi.ui

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.perusahaan.absensi.R
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.LupaSandiRequest
import com.perusahaan.absensi.network.dto.ResetSandiRequest
import kotlinx.coroutines.launch

class LupaPasswordActivity : AppCompatActivity() {

    private lateinit var layoutLangkah1: LinearLayout
    private lateinit var layoutLangkah2: LinearLayout
    private lateinit var inputEmailReset: EditText
    private lateinit var btnKirimToken: Button
    private lateinit var textInfoEmail: TextView
    private lateinit var inputToken: EditText
    private lateinit var inputPasswordBaru: EditText
    private lateinit var inputKonfirmasi: EditText
    private lateinit var btnResetPassword: Button
    private lateinit var textPesan: TextView
    private lateinit var progressReset: ProgressBar
    private lateinit var textKembali: TextView

    private var emailYangDipakai = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_lupa_password)

        layoutLangkah1    = findViewById(R.id.layoutLangkah1)
        layoutLangkah2    = findViewById(R.id.layoutLangkah2)
        inputEmailReset   = findViewById(R.id.inputEmailReset)
        btnKirimToken     = findViewById(R.id.btnKirimToken)
        textInfoEmail     = findViewById(R.id.textInfoEmail)
        inputToken        = findViewById(R.id.inputToken)
        inputPasswordBaru = findViewById(R.id.inputPasswordBaru)
        inputKonfirmasi   = findViewById(R.id.inputKonfirmasiPasswordBaru)
        btnResetPassword  = findViewById(R.id.btnResetPassword)
        textPesan         = findViewById(R.id.textPesanReset)
        progressReset     = findViewById(R.id.progressReset)
        textKembali       = findViewById(R.id.textKembaliLogin2)

        btnKirimToken.setOnClickListener { kirimToken() }
        btnResetPassword.setOnClickListener { resetPassword() }
        textKembali.setOnClickListener { finish() }
    }

    /** Langkah 1: Kirim token ke email */
    private fun kirimToken() {
        val email = inputEmailReset.text.toString().trim()
        if (email.isEmpty()) {
            tampilkanPesan("Email wajib diisi", isError = true)
            return
        }

        emailYangDipakai = email
        setLoading(true)

        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.lupaSandi(LupaSandiRequest(email))
                // Server selalu 200 untuk menghindari user enumeration
                tampilkanPesan(
                    "Jika email terdaftar, token reset dikirim ke:\n$email",
                    isError = false
                )
                // Tampilkan langkah 2
                layoutLangkah1.visibility = View.GONE
                layoutLangkah2.visibility = View.VISIBLE
                textInfoEmail.text = "Token 6 digit dikirim ke $email"
            } catch (e: Exception) {
                tampilkanPesan("Gagal terhubung: ${e.message}", isError = true)
            } finally {
                setLoading(false)
            }
        }
    }

    /** Langkah 2: Verifikasi token dan set password baru */
    private fun resetPassword() {
        val token     = inputToken.text.toString().trim()
        val pwBaru    = inputPasswordBaru.text.toString()
        val konfirmasi = inputKonfirmasi.text.toString()

        if (token.isEmpty() || pwBaru.isEmpty()) {
            tampilkanPesan("Token dan password baru wajib diisi", isError = true)
            return
        }
        if (pwBaru.length < 8) {
            tampilkanPesan("Password baru minimal 8 karakter", isError = true)
            return
        }
        if (pwBaru != konfirmasi) {
            tampilkanPesan("Konfirmasi password tidak cocok", isError = true)
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.resetSandi(
                    ResetSandiRequest(email = emailYangDipakai, token = token, password_baru = pwBaru)
                )
                if (response.isSuccessful) {
                    tampilkanPesan(
                        "✅ Password berhasil direset!\nSilakan login dengan password baru.",
                        isError = false
                    )
                    btnResetPassword.isEnabled = false
                    // Kembali ke login setelah 2 detik
                    btnResetPassword.postDelayed({
                        startActivity(Intent(this@LupaPasswordActivity, LoginActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                        finish()
                    }, 2000)
                } else {
                    val pesan = try {
                        response.errorBody()?.string()?.let {
                            org.json.JSONObject(it).optString("error", "Token tidak valid atau sudah kedaluwarsa")
                        } ?: "Token tidak valid"
                    } catch (e: Exception) { "Token tidak valid atau sudah kedaluwarsa" }
                    tampilkanPesan(pesan, isError = true)
                }
            } catch (e: Exception) {
                tampilkanPesan("Gagal terhubung: ${e.message}", isError = true)
            } finally {
                setLoading(false)
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressReset.visibility = if (loading) View.VISIBLE else View.GONE
        btnKirimToken.isEnabled = !loading
        btnResetPassword.isEnabled = !loading
    }

    private fun tampilkanPesan(pesan: String, isError: Boolean) {
        runOnUiThread {
            textPesan.text = pesan
            textPesan.setTextColor(if (isError) Color.parseColor("#D32F2F") else Color.parseColor("#2E7D32"))
            textPesan.visibility = View.VISIBLE
        }
    }
}
