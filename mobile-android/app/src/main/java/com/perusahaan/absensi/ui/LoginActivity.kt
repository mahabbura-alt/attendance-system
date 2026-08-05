package com.perusahaan.absensi.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.perusahaan.absensi.R
import com.perusahaan.absensi.data.SessionManager
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.LoginRequest
import kotlinx.coroutines.launch
import org.json.JSONObject

class LoginActivity : AppCompatActivity() {

    private lateinit var inputEmail: EditText
    private lateinit var inputPassword: EditText
    private lateinit var btnLogin: Button
    private lateinit var btnDaftar: Button
    private lateinit var textLupaPassword: TextView
    private lateinit var textError: TextView
    private lateinit var progressLogin: ProgressBar
    private lateinit var btnSetIp: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        SessionManager.init(applicationContext)

        if (SessionManager.sudahLogin()) {
            bukaHome()
            return
        }

        inputEmail       = findViewById(R.id.inputEmail)
        inputPassword    = findViewById(R.id.inputPassword)
        btnLogin         = findViewById(R.id.btnLogin)
        btnDaftar        = findViewById(R.id.btnDaftar)
        textLupaPassword = findViewById(R.id.textLupaPassword)
        textError        = findViewById(R.id.textError)
        progressLogin    = findViewById(R.id.progressLogin)
        btnSetIp         = findViewById(R.id.btnSetIp)

        btnLogin.setOnClickListener { prosesLogin() }

        btnDaftar.setOnClickListener {
            startActivity(Intent(this, DaftarActivity::class.java))
        }

        textLupaPassword.setOnClickListener {
            startActivity(Intent(this, LupaPasswordActivity::class.java))
        }

        btnSetIp.setOnClickListener {
            bukaDialogSetIp()
        }
    }

    private fun bukaDialogSetIp() {
        val input = EditText(this).apply {
            setText(SessionManager.getServerUrl())
            hint = "http://192.168.1.82:3000/"
            setPadding(40, 30, 40, 30)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("⚙️ Konfigurasi IP Server Absensi")
            .setMessage("Masukkan Alamat IP Server PC tempat backend berjalan:")
            .setView(input)
            .setPositiveButton("Simpan") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotEmpty()) {
                    val formatted = if (newUrl.startsWith("http://") || newUrl.startsWith("https://")) {
                        newUrl
                    } else {
                        "http://$newUrl"
                    }
                    val finalUrl = if (formatted.endsWith("/")) formatted else "$formatted/"
                    SessionManager.simpanServerUrl(finalUrl)
                    Toast.makeText(this, "Alamat Server Diperbarui:\n$finalUrl", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun prosesLogin() {
        val email    = inputEmail.text.toString().trim()
        val password = inputPassword.text.toString()

        if (email.isEmpty() || password.isEmpty()) {
            tampilkanError("Email dan password wajib diisi")
            return
        }

        textError.visibility = android.view.View.GONE
        setLoading(true)

        lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.login(LoginRequest(email, password))

                if (response.isSuccessful && response.body() != null) {
                    val hasil = response.body()!!
                    SessionManager.simpanSesi(
                        token  = hasil.token,
                        userId = hasil.user.id,
                        nama   = hasil.user.nama,
                        role   = hasil.user.role
                    )
                    SessionManager.simpanPassword(password)
                    bukaHome()
                } else {
                    val errBody = response.errorBody()?.string()
                    val pesan = try {
                        if (errBody != null && errBody.contains("error")) {
                            JSONObject(errBody).getString("error")
                        } else {
                            "Email atau password salah"
                        }
                    } catch (e: Exception) {
                        "Email atau password salah"
                    }
                    tampilkanError(pesan)
                }
            } catch (e: Exception) {
                val currentUrl = SessionManager.getServerUrl()
                tampilkanError("Gagal terhubung ke $currentUrl:\n${e.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressLogin.visibility = if (loading) android.view.View.VISIBLE else android.view.View.GONE
        btnLogin.isEnabled = !loading
    }

    private fun tampilkanError(pesan: String) {
        runOnUiThread {
            textError.text = pesan
            textError.visibility = android.view.View.VISIBLE
        }
    }

    private fun bukaHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
}
