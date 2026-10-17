package com.omos.fuel.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

/**
 * Sesi terenkripsi untuk HP bersama (satu perangkat, beberapa fuelman bergantian).
 * Tiap petugas menyimpan token + hash PIN offline sendiri; antrean dikirim atas nama pencatatnya.
 */
class Session(context: Context) {
    private val prefs: SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "omos_fuel_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        context.getSharedPreferences("omos_fuel_session_fallback", Context.MODE_PRIVATE)
    }

    /** Petugas yang pernah login di perangkat ini. */
    data class Officer(
        val userId: String, val employeeId: String, val nama: String, val jabatan: String?,
        val token: String, val functions: List<String>, val locationIds: List<String>,
        val pinSalt: String, val pinHash: String, val lastOnlineAt: Long, val offlinePinDays: Int,
        val mustChangePin: Boolean, val failedOffline: Int = 0,
    )

    data class State(
        val loggedIn: Boolean, val expired: Boolean, val officer: Officer?, val deviceCode: String?,
        val deviceStatus: String?,
    ) {
        val userId: String? get() = officer?.userId
        val mustChangePin: Boolean get() = officer?.mustChangePin == true
    }

    private val officerListType = object : TypeToken<List<Officer>>() {}.type

    /** ID perangkat stabil per instalasi (tidak dihapus saat logout). */
    val deviceUid: String = prefs.getString("device_uid", null) ?: "android-${UUID.randomUUID()}".also {
        prefs.edit().putString("device_uid", it).apply()
    }

    private val _state = MutableStateFlow(readState())
    val state: StateFlow<State> = _state

    fun officers(): List<Officer> = prefs.getString("officers", null)
        ?.let { runCatching { Net.rawGson.fromJson<List<Officer>>(it, officerListType) }.getOrNull() } ?: emptyList()

    private fun saveOfficers(list: List<Officer>) {
        prefs.edit().putString("officers", Net.rawGson.toJson(list)).apply()
    }

    private fun current(): Officer? = prefs.getString("current_user", null)?.let { id -> officers().firstOrNull { it.userId == id } }

    private fun readState(): State {
        val o = current()
        return State(
            loggedIn = o != null, expired = prefs.getBoolean("expired", false), officer = o,
            deviceCode = prefs.getString("device_code", null), deviceStatus = prefs.getString("device_status", null),
        )
    }

    private fun publish() { _state.value = readState() }

    val token: String? get() = current()?.token
    val userId: String? get() = current()?.userId

    fun tokenOf(userId: String): String? = officers().firstOrNull { it.userId == userId }?.token

    /** Login online berhasil: simpan token + hash PIN untuk buka offline. */
    fun saveLogin(res: LoginResponse, pin: String) {
        val u = res.user ?: error("Respons login tidak valid")
        val salt = OfflinePin.newSalt()
        val officer = Officer(
            userId = u.id ?: error("Respons login tidak valid"), employeeId = u.employeeId ?: "", nama = u.nama ?: "-",
            jabatan = u.jabatan, token = res.token ?: error("Respons login tidak valid"),
            functions = res.access?.functions.orEmpty(), locationIds = res.access?.locationIds.orEmpty(),
            pinSalt = salt, pinHash = OfflinePin.hash(pin, salt), lastOnlineAt = System.currentTimeMillis(),
            offlinePinDays = res.offlinePinDays ?: 7, mustChangePin = res.mustChangePin == true,
        )
        saveOfficers(officers().filterNot { it.userId == officer.userId } + officer)
        prefs.edit()
            .putString("current_user", officer.userId)
            .putBoolean("expired", false)
            .putString("device_code", res.device?.deviceCode)
            .putString("device_status", res.device?.status)
            .apply()
        publish()
    }

    fun setDevice(code: String?, status: String?) {
        prefs.edit().putString("device_code", code).putString("device_status", status).apply()
        publish()
    }

    sealed class Unlock {
        data object Ok : Unlock()
        data object Unknown : Unlock()
        data object Stale : Unlock()
        data object Locked : Unlock()
        data class Wrong(val remaining: Int) : Unlock()
    }

    /** Buka dengan PIN tanpa sinyal: hanya petugas yang pernah login online ≤ N hari terakhir. */
    fun unlockOffline(employeeId: String, pin: String, maxAttempts: Int = 5): Unlock {
        val list = officers()
        val o = list.firstOrNull { it.employeeId.equals(employeeId.trim(), ignoreCase = true) } ?: return Unlock.Unknown
        if (o.failedOffline >= maxAttempts) return Unlock.Locked
        val ageDays = (System.currentTimeMillis() - o.lastOnlineAt) / 86_400_000.0
        if (ageDays > o.offlinePinDays) return Unlock.Stale
        return if (OfflinePin.verify(pin, o.pinSalt, o.pinHash)) {
            saveOfficers(list.map { if (it.userId == o.userId) it.copy(failedOffline = 0) else it })
            prefs.edit().putString("current_user", o.userId).apply()
            publish()
            Unlock.Ok
        } else {
            val gagal = o.failedOffline + 1
            saveOfficers(list.map { if (it.userId == o.userId) it.copy(failedOffline = gagal) else it })
            if (gagal >= maxAttempts) Unlock.Locked else Unlock.Wrong(maxAttempts - gagal)
        }
    }

    fun pinChanged(newPin: String) {
        val o = current() ?: return
        val salt = OfflinePin.newSalt()
        saveOfficers(officers().map {
            if (it.userId == o.userId) it.copy(mustChangePin = false, pinSalt = salt, pinHash = OfflinePin.hash(newPin, salt)) else it
        })
        publish()
    }

    /** Segarkan hak akses + tandai online terakhir (dari bootstrap). */
    fun touchOnline(access: Access?, device: DeviceInfo?) {
        val o = current() ?: return
        saveOfficers(officers().map {
            if (it.userId != o.userId) it else it.copy(
                lastOnlineAt = System.currentTimeMillis(),
                functions = access?.functions ?: it.functions, locationIds = access?.locationIds ?: it.locationIds,
                mustChangePin = access?.mustChangePin ?: it.mustChangePin,
            )
        })
        if (device != null) prefs.edit().putString("device_code", device.deviceCode).putString("device_status", device.status).apply()
        publish()
    }

    fun markExpired() {
        if (prefs.getBoolean("expired", false)) return
        prefs.edit().putBoolean("expired", true).apply()
        publish()
    }

    /** Kunci layar / ganti petugas: data & antrean tetap di HP. */
    fun lock() {
        prefs.edit().remove("current_user").putBoolean("expired", false).apply()
        publish()
    }

    var sourceLocationId: String?
        get() = prefs.getString("source_${userId ?: "-"}", null)
        set(v) { prefs.edit().putString("source_${userId ?: "-"}", v).apply(); publish() }

    var lastSyncAt: Long
        get() = prefs.getLong("last_sync_at", 0L)
        set(v) { prefs.edit().putLong("last_sync_at", v).apply() }

    var darkMode: Boolean
        get() = prefs.getBoolean("dark_mode", false)
        set(v) { prefs.edit().putBoolean("dark_mode", v).apply() }

    var highContrast: Boolean
        get() = prefs.getBoolean("high_contrast", false)
        set(v) { prefs.edit().putBoolean("high_contrast", v).apply() }
}
