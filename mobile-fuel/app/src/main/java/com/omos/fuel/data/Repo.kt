package com.omos.fuel.data

import android.content.Context
import android.os.Build
import com.google.gson.reflect.TypeToken
import com.omos.fuel.BuildConfig
import com.omos.fuel.data.db.AppDb
import com.omos.fuel.data.db.CacheEntity
import com.omos.fuel.data.db.OutboxEntity
import com.omos.fuel.data.db.OutboxStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.UUID

/** Jenis item antrean (sama dengan ITEM_TYPES backend/src/services/fuelMobile.js). */
object ItemType {
    const val FILL = "fill"
    const val TRANSFER = "transfer"
    const val RECEIPT = "receipt"
    const val OPNAME = "opname"
    const val SHIFT_OPEN = "shift_open"
    const val SHIFT_CLOSE = "shift_close"
}

data class SyncUiState(val running: Boolean = false, val lastError: String? = null, val lastSyncAt: Long = 0L, val online: Boolean = true)

sealed class LoginOutcome {
    data object Online : LoginOutcome()
    data object Offline : LoginOutcome()
    data class DevicePending(val deviceCode: String?) : LoginOutcome()
    data class Failed(val message: String) : LoginOutcome()
}

class Repo(context: Context) {
    val appContext: Context = context.applicationContext
    val session = Session(appContext)
    val db = AppDb.get(appContext)
    val photos = PhotoStore(appContext)
    private val api get() = Net.api(session)
    private val syncMutex = Mutex()
    private val photoListType = object : TypeToken<List<PhotoRef>>() {}.type
    private val mapType = object : TypeToken<Map<String, Any?>>() {}.type

    private val _sync = MutableStateFlow(SyncUiState(lastSyncAt = session.lastSyncAt))
    val sync: StateFlow<SyncUiState> = _sync

    init {
        val cm = appContext.getSystemService(android.net.ConnectivityManager::class.java)
        fun hasInternet(): Boolean = cm?.getNetworkCapabilities(cm.activeNetwork)
            ?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        _sync.value = _sync.value.copy(online = hasInternet())
        try {
            cm?.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) { _sync.value = _sync.value.copy(online = true) }
                override fun onLost(network: android.net.Network) { _sync.value = _sync.value.copy(online = hasInternet()) }
            })
        } catch (_: Exception) { }
    }

    private fun owner(): String = session.userId ?: "-"
    private fun bearer(userId: String): String? = session.tokenOf(userId)?.let { "Bearer $it" }

    // ------------------------------------------------------------------ Login & PIN

    /** Login online; bila tidak ada sinyal → buka offline dengan PIN (maks. N hari sejak online). */
    suspend fun login(employeeId: String, pin: String): LoginOutcome = withContext(Dispatchers.IO) {
        try {
            val res = api.login(LoginRequest(employeeId.trim(), pin, session.deviceUid,
                "${Build.MANUFACTURER} ${Build.MODEL}".trim(), Build.MODEL, BuildConfig.VERSION_NAME))
            session.saveLogin(res, pin)
            runCatching { refreshBootstrap() }
            LoginOutcome.Online
        } catch (e: Exception) {
            val f = e.apiFailure()
            when {
                f?.code == "DEVICE_PENDING" -> { session.setDevice(f.details?.get("device_code")?.toString(), "pending"); LoginOutcome.DevicePending(f.details?.get("device_code")?.toString()) }
                f?.code == "DEVICE_REVOKED" -> LoginOutcome.Failed("Perangkat ini sudah dicabut admin Fuel. Hubungi admin.")
                f != null -> LoginOutcome.Failed(f.message)
                e.isNetworkProblem() -> when (val u = session.unlockOffline(employeeId, pin)) {
                    Session.Unlock.Ok -> LoginOutcome.Offline
                    Session.Unlock.Unknown -> LoginOutcome.Failed("Tidak ada sinyal. Login pertama di perangkat ini wajib online.")
                    Session.Unlock.Stale -> LoginOutcome.Failed("Tidak ada sinyal dan PIN offline sudah kedaluwarsa. Cari sinyal untuk login online.")
                    Session.Unlock.Locked -> LoginOutcome.Failed("PIN salah terlalu sering. Login online diperlukan.")
                    is Session.Unlock.Wrong -> LoginOutcome.Failed("PIN salah. Sisa percobaan ${u.remaining}.")
                }
                else -> LoginOutcome.Failed(e.friendlyMessage())
            }
        }
    }

    suspend fun changePin(old: String, new: String): Result<Unit> = runCatching {
        withContext(Dispatchers.IO) { api.changePin(mapOf("old_pin" to old, "new_pin" to new)) }
        session.pinChanged(new)
    }

    fun lock() = session.lock()

    // ------------------------------------------------------------------ Bootstrap (cache offline)

    private fun cacheKey() = "${owner()}:bootstrap"

    suspend fun refreshBootstrap(): Bootstrap = withContext(Dispatchers.IO) {
        val b = api.bootstrap()
        db.cache().put(CacheEntity(cacheKey(), Net.gson.toJson(b), System.currentTimeMillis()))
        session.touchOnline(b.access, b.device)
        b
    }

    suspend fun cachedBootstrap(): Bootstrap? = db.cache().get(cacheKey())?.let {
        runCatching { Net.gson.fromJson(it.json, Bootstrap::class.java) }.getOrNull()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeBootstrap(): Flow<Bootstrap?> = session.state.flatMapLatest { s ->
        if (s.userId == null) flowOf(null) else db.cache().observe("${s.userId}:bootstrap").map { e ->
            e?.let { runCatching { Net.gson.fromJson(it.json, Bootstrap::class.java) }.getOrNull() }
        }
    }

    // ------------------------------------------------------------------ Antrean

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeOutbox(): Flow<List<OutboxEntity>> = session.state.flatMapLatest { s ->
        if (s.userId == null) emptyFlow() else db.outbox().observeAll(s.userId!!)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observePendingCount(): Flow<Int> = session.state.flatMapLatest { s ->
        if (s.userId == null) flowOf(0) else db.outbox().observePendingCount(s.userId!!)
    }

    /** Keluar dari lokasi yang belum terkirim (semua petugas di HP ini) — untuk estimasi stok. */
    fun observeUnsentOut(): Flow<Map<String, Double>> = db.outbox().observeUnsentAll().map { list ->
        list.filter { (it.type == ItemType.FILL || it.type == ItemType.TRANSFER) && it.sourceLocationId != null }
            .groupBy { it.sourceLocationId!! }.mapValues { (_, v) -> v.sumOf { it.liter } }
    }

    fun payloadOf(item: OutboxEntity): Map<String, Any?> =
        runCatching { Net.rawGson.fromJson<Map<String, Any?>>(item.payloadJson, mapType) }.getOrNull() ?: emptyMap()

    fun photosOf(item: OutboxEntity): List<PhotoRef> =
        runCatching { Net.rawGson.fromJson<List<PhotoRef>>(item.photosJson, photoListType) }.getOrNull() ?: emptyList()

    fun flagsOf(item: OutboxEntity): List<String> =
        item.flagsJson?.let { runCatching { Net.rawGson.fromJson<List<String>>(it, object : TypeToken<List<String>>() {}.type) }.getOrNull() } ?: emptyList()

    /** Simpan transaksi ke antrean lokal (selalu berhasil tanpa sinyal) lalu picu kirim. */
    suspend fun enqueue(type: String, title: String, payload: Map<String, Any?>, photos: List<PhotoRef>,
                        liter: Double = 0.0, sourceLocationId: String? = null, clientUuid: String = UUID.randomUUID().toString()): String {
        val item = OutboxEntity(
            clientUuid = clientUuid, ownerUserId = owner(), type = type, title = title,
            payloadJson = Net.rawGson.toJson(payload + mapOf("recorded_at" to Instant.now().toString())),
            photosJson = Net.rawGson.toJson(photos), liter = liter, sourceLocationId = sourceLocationId,
            createdAt = System.currentTimeMillis(),
        )
        db.outbox().upsert(item)
        com.omos.fuel.sync.SyncWorker.runNow(appContext)
        return clientUuid
    }

    suspend fun get(clientUuid: String): OutboxEntity? = db.outbox().get(clientUuid)
    suspend fun latestOfType(type: String): OutboxEntity? = db.outbox().latestOfType(owner(), type)

    /** Pengisian di HP ini yang belum ada di bootstrap server (cek 1 pengisian/unit/shift & HM terakhir offline). */
    suspend fun localFillsSince(sinceMillis: Long): List<OutboxEntity> = db.outbox().fillsSince(sinceMillis)
        .filter { it.status != OutboxStatus.REJECTED }

    suspend fun discard(clientUuid: String) {
        val item = db.outbox().get(clientUuid) ?: return
        if (item.status == OutboxStatus.SENT) return
        photosOf(item).forEach { photos.delete(it.ref) }
        db.outbox().delete(clientUuid)
    }

    suspend fun retryNow() {
        db.outbox().retryNow(owner())
        com.omos.fuel.sync.SyncWorker.runNow(appContext)
    }

    // ------------------------------------------------------------------ Kirim

    /** Kirim antrean semua petugas di HP ini, masing-masing dengan tokennya sendiri. */
    suspend fun syncNow(): Int = withContext(Dispatchers.IO) {
        syncMutex.withLock {
            _sync.value = _sync.value.copy(running = true, lastError = null)
            var sent = 0
            try {
                db.outbox().resetStuck()
                for (officer in session.officers()) {
                    while (true) {
                        val item = db.outbox().due(officer.userId, System.currentTimeMillis(), 1).firstOrNull() ?: break
                        val outcome = sendOne(item)
                        if (outcome == Outcome.SENT) sent++
                        if (outcome == Outcome.STOP_OWNER) break
                        if (outcome == Outcome.STOP_ALL) return@withLock sent
                    }
                }
                session.lastSyncAt = System.currentTimeMillis()
                _sync.value = _sync.value.copy(online = true, lastSyncAt = session.lastSyncAt)
                runCatching { refreshStatuses() }
            } finally {
                _sync.value = _sync.value.copy(running = false)
            }
            sent
        }
    }

    private enum class Outcome { SENT, REJECTED, RETRY, STOP_OWNER, STOP_ALL }

    private suspend fun sendOne(item: OutboxEntity): Outcome {
        val auth = bearer(item.ownerUserId) ?: return Outcome.STOP_OWNER
        db.outbox().upsert(item.copy(status = OutboxStatus.SENDING))
        try {
            // Tahap 1: unggah foto yang belum punya attachment_id.
            val refs = photosOf(item).toMutableList()
            for ((i, p) in refs.withIndex()) {
                if (p.attachmentId != null) continue
                val file = photos.fileOf(p.ref) ?: run {
                    reject(item, "PHOTO_MISSING", MissingPhotoException().message); return Outcome.REJECTED
                }
                val text = "text/plain".toMediaType()
                val fields = linkedMapOf<String, RequestBody>(
                    "slot_code" to p.slot.toRequestBody(text), "client_uuid" to p.clientUuid.toRequestBody(text),
                    "client_sha256" to p.sha256.toRequestBody(text), "captured_at" to p.capturedAt.toRequestBody(text),
                    "device_id" to session.deviceUid.toRequestBody(text), "app_version" to BuildConfig.VERSION_NAME.toRequestBody(text),
                    "upload_source" to "mobile".toRequestBody(text),
                )
                p.gpsLat?.let { fields["gps_lat"] = it.toString().toRequestBody(text) }
                p.gpsLng?.let { fields["gps_lng"] = it.toString().toRequestBody(text) }
                val part = MultipartBody.Part.createFormData("file", file.name, file.asRequestBody("image/jpeg".toMediaType()))
                val att = api.upload(auth, part, fields)
                refs[i] = p.copy(attachmentId = att.id)
                db.outbox().upsert(item.copy(status = OutboxStatus.SENDING, photosJson = Net.rawGson.toJson(refs)))
            }
            // Tahap 2: kirim transaksi + attachment_ids.
            val payload = payloadOf(item) + mapOf("attachment_ids" to refs.mapNotNull { it.attachmentId })
            val res = api.sync(auth, SyncRequest(listOf(SyncItem(item.clientUuid, item.type, payload))))
            val r = res.results?.firstOrNull { it.clientUuid == item.clientUuid } ?: res.results?.firstOrNull()
            val base = item.copy(photosJson = Net.rawGson.toJson(refs))
            return when (r?.result) {
                "ok" -> {
                    db.outbox().upsert(base.copy(status = OutboxStatus.SENT, serverId = r.serverId,
                        serverStatus = r.status ?: if (r.heldHm == true) "held_hm" else "recorded",
                        flagsJson = r.flags?.let { Net.rawGson.toJson(it) }, sentAt = System.currentTimeMillis(),
                        errorCode = null, errorMessage = null))
                    Outcome.SENT
                }
                "rejected" -> { reject(base, r.code, r.message); Outcome.REJECTED }
                else -> { backoff(base, r?.message); Outcome.STOP_ALL }
            }
        } catch (e: retrofit2.HttpException) {
            val f = e.apiFailure()
            return when {
                e.code() == 401 -> {
                    db.outbox().upsert(item.copy(status = OutboxStatus.WAITING, errorCode = "AUTH_EXPIRED",
                        errorMessage = "Sesi petugas berakhir. Login online lagi; data tetap di HP."))
                    if (item.ownerUserId == session.userId) session.markExpired()
                    Outcome.STOP_OWNER
                }
                e.code() == 403 && f?.code == "DEVICE_REVOKED" -> { reject(item, f.code, f.message); Outcome.STOP_ALL }
                e.code() in 400..499 && e.code() != 429 -> { reject(item, f?.code ?: "REJECTED", f?.message); Outcome.REJECTED }
                else -> { backoff(item, e.friendlyMessage()); Outcome.STOP_ALL }
            }
        } catch (e: Exception) {
            backoff(item, e.friendlyMessage())
            _sync.value = _sync.value.copy(online = !e.isNetworkProblem(), lastError = e.friendlyMessage())
            return Outcome.STOP_ALL
        }
    }

    private suspend fun reject(item: OutboxEntity, code: String?, message: String?) {
        db.outbox().upsert(item.copy(status = OutboxStatus.REJECTED, errorCode = code ?: "REJECTED",
            errorMessage = message ?: "Ditolak server", attempts = item.attempts + 1))
    }

    private suspend fun backoff(item: OutboxEntity, message: String?) {
        val attempts = item.attempts + 1
        val delayMin = minOf(30L, 1L shl minOf(attempts, 5))
        db.outbox().upsert(item.copy(status = OutboxStatus.WAITING, attempts = attempts,
            nextAttemptAt = System.currentTimeMillis() + delayMin * 60_000, errorCode = "RETRYABLE", errorMessage = message))
        _sync.value = _sync.value.copy(lastError = message)
    }

    /** Status di server untuk item yang menunggu validasi admin (diterima/ditolak + alasan). */
    suspend fun refreshStatuses() {
        val auth = session.userId?.let { bearer(it) } ?: return
        val waiting = db.outbox().awaitingServer(owner())
        if (waiting.isEmpty()) return
        val rows = api.status(auth, StatusRequest(waiting.map { it.clientUuid }))
        for (row in rows) {
            val item = waiting.firstOrNull { it.clientUuid == row.clientUuid } ?: continue
            if (row.status == null || row.status == "unknown") continue
            db.outbox().upsert(item.copy(serverStatus = row.status, serverReason = row.reason))
        }
    }

    // ------------------------------------------------------------------ Pembaruan & penyimpanan

    suspend fun appVersion(): Result<AppVersion> = runCatching { withContext(Dispatchers.IO) { api.appVersion() } }

    /** Hapus foto item terkirim > N hari (data & bukti sudah di server). */
    suspend fun cleanupSentPhotos(olderThanDays: Int = 3) {
        val before = System.currentTimeMillis() - olderThanDays * 86_400_000L
        for (item in db.outbox().sentBefore(before)) {
            photosOf(item).forEach { photos.delete(it.ref) }
            if (item.sentAt != null && item.sentAt < System.currentTimeMillis() - 14 * 86_400_000L) db.outbox().delete(item.clientUuid)
        }
    }
}
