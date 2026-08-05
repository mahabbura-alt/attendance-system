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
    private const val KEY_SERVER_URL = "server_url"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return

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

    fun simpanServerUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_URL, url).apply()
    }
    fun getServerUrl(): String = prefs.getString(KEY_SERVER_URL, "http://192.168.1.82:3000/") ?: "http://192.168.1.82:3000/"

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)
    fun getUserNama(): String? = prefs.getString(KEY_USER_NAMA, null)
    fun getUserRole(): String? = prefs.getString(KEY_USER_ROLE, null)
    fun sudahLogin(): Boolean = getToken() != null

    fun logout() {
        val savedUrl = getServerUrl()
        prefs.edit().clear().apply()
        simpanServerUrl(savedUrl)
    }

    fun clearSession() = logout()
}
