package com.perusahaan.absensi.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Menyimpan JWT token & data user secara terenkripsi di device (EncryptedSharedPreferences).
 * Dipakai sebagai singleton, wajib di-init sekali di Application/LoginActivity sebelum dipakai.
 */
object SessionManager {

    private const val PREF_NAME = "absensi_session"
    private const val KEY_TOKEN = "jwt_token"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_USER_NAMA = "user_nama"
    private const val KEY_USER_ROLE = "user_role"
    private const val KEY_USER_PASSWORD = "user_pw"

    private lateinit var prefs: SharedPreferences
    private lateinit var appContext: Context

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        appContext = context.applicationContext

        try {
            val masterKey = MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            prefs = EncryptedSharedPreferences.create(
                context.applicationContext,
                PREF_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Error Keystore sering terjadi pada beberapa device atau saat reinstall
            // Hapus file preferences lama
            context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit().clear().apply()
            
            // Hapus file xml fisiknya secara langsung jika ada
            val sharedPrefsFile = java.io.File(context.applicationInfo.dataDir, "shared_prefs/$PREF_NAME.xml")
            if (sharedPrefsFile.exists()) {
                sharedPrefsFile.delete()
            }
            
            // Coba inisialisasi ulang
            val masterKey = MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            prefs = EncryptedSharedPreferences.create(
                context.applicationContext,
                PREF_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }
    }

    fun simpanSesi(token: String, userId: String, nama: String, role: String) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_USER_NAMA, nama)
            .putString(KEY_USER_ROLE, role)
            .apply()
    }

    fun simpanPassword(password: String) {
        prefs.edit().putString(KEY_USER_PASSWORD, password).apply()
    }
    fun getPassword(): String? = prefs.getString(KEY_USER_PASSWORD, null)

    fun getServerUrl(): String = "https://attendance-system-eta-opal.vercel.app/"

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)
    fun getUserNama(): String? = prefs.getString(KEY_USER_NAMA, null)
    fun getUserRole(): String? = prefs.getString(KEY_USER_ROLE, null)
    fun sudahLogin(): Boolean = getToken() != null

    fun logout() {
        prefs.edit().clear().apply()
    }

    fun clearSession() = logout()

    // Ignore a late 401 from an old request after the user has logged in again.
    @Synchronized
    fun expireSessionIfCurrent(token: String) {
        if (getToken() != token) return
        logout()
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            appContext.startActivity(android.content.Intent(
                appContext, com.perusahaan.absensi.ui.LoginActivity::class.java
            ).apply {
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK
                putExtra("session_expired", true)
            })
        }
    }
}
