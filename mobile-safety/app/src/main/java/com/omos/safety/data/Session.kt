package com.omos.safety.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Sesi login tersimpan terenkripsi. HP bisa dipakai bergantian: data antrean milik user lain
 * tidak dikirim atas nama user yang sedang login (lihat Repo.syncNow — filter owner).
 */
class Session(context: Context) {
    private val prefs: SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "omos_safety_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        // Keystore rusak (jarang): jatuh ke prefs biasa agar app tetap bisa dipakai; token tetap kedaluwarsa 8 jam.
        context.getSharedPreferences("omos_safety_session_fallback", Context.MODE_PRIVATE)
    }

    private val _state = MutableStateFlow(readState())
    val state: StateFlow<State> = _state

    data class State(
        val loggedIn: Boolean, val expired: Boolean, val userId: String?, val nama: String?,
        val employeeId: String?, val jabatan: String?, val departemen: String?, val mustChangePassword: Boolean,
    )

    val token: String? get() = prefs.getString("token", null)
    val userId: String? get() = prefs.getString("user_id", null)

    private fun readState() = State(
        loggedIn = !prefs.getString("token", null).isNullOrBlank(),
        expired = prefs.getBoolean("expired", false),
        userId = prefs.getString("user_id", null),
        nama = prefs.getString("nama", null),
        employeeId = prefs.getString("employee_id", null),
        jabatan = prefs.getString("jabatan", null),
        departemen = prefs.getString("departemen", null),
        mustChangePassword = prefs.getBoolean("must_change", false),
    )

    fun save(token: String, user: LoginUser) {
        val previous = prefs.getString("user_id", null)
        prefs.edit()
            .putString("token", token)
            .putBoolean("expired", false)
            .putString("user_id", user.id)
            .putString("nama", user.nama)
            .putString("employee_id", user.employeeId)
            .putString("jabatan", user.jabatan)
            .putString("departemen", user.departemen)
            .putBoolean("must_change", user.mustChangePassword == true)
            .apply {
                // Ganti akun di HP yang sama: kursor notifikasi dimulai ulang untuk user baru.
                if (previous != null && previous != user.id) putLong("notif_cursor", 0L)
            }
            .apply()
        _state.value = readState()
    }

    fun passwordChanged() {
        prefs.edit().putBoolean("must_change", false).apply()
        _state.value = readState()
    }

    fun markExpired() {
        if (prefs.getBoolean("expired", false)) return
        prefs.edit().putBoolean("expired", true).apply()
        _state.value = readState()
    }

    fun logout() {
        prefs.edit().remove("token").putBoolean("expired", false).apply()
        _state.value = readState()
    }

    var notifCursor: Long
        get() = prefs.getLong("notif_cursor", 0L)
        set(v) { prefs.edit().putLong("notif_cursor", v).apply() }

    var lastSyncAt: Long
        get() = prefs.getLong("last_sync_at", 0L)
        set(v) { prefs.edit().putLong("last_sync_at", v).apply() }

    var darkMode: Boolean
        get() = prefs.getBoolean("dark_mode", false)
        set(v) { prefs.edit().putBoolean("dark_mode", v).apply() }
}
