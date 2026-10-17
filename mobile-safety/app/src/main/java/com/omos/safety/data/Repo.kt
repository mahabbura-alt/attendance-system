package com.omos.safety.data

import android.content.Context
import com.google.gson.reflect.TypeToken
import com.omos.safety.data.db.AppDb
import com.omos.safety.data.db.CacheEntity
import com.omos.safety.data.db.NotificationEntity
import com.omos.safety.data.db.OutboxEntity
import com.omos.safety.data.db.OutboxStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.lang.reflect.Type
import java.util.UUID

/** Jenis data antrean (sama dengan ITEM_TYPES di backend/src/services/hseMobile.js). */
object ItemType {
    const val HAZARD_CREATE = "HAZARD_CREATE"
    const val HAZARD_CORRECT = "HAZARD_CORRECT"
    const val HAZARD_CANCEL = "HAZARD_CANCEL"
    const val HAZARD_NOTE = "HAZARD_NOTE"
    const val ACTION_START = "ACTION_START"
    const val ACTION_EVIDENCE = "ACTION_EVIDENCE"
    const val VERIFY_DECISION = "VERIFY_DECISION"
    const val PIC_REQUEST = "PIC_REQUEST"
    const val DELEGATOR_DECISION = "DELEGATOR_DECISION"
    const val DELEGATOR_REASSIGN = "DELEGATOR_REASSIGN"
    const val INCIDENT_CREATE = "INCIDENT_CREATE"
    const val INSPECTION_CREATE = "INSPECTION_CREATE"
    const val P5M_CREATE = "P5M_CREATE"
    const val SAFETYTALK_CREATE = "SAFETYTALK_CREATE"
    const val MEETING_CREATE = "MEETING_CREATE"
}

object CacheKey {
    const val BOOTSTRAP = "bootstrap"
    const val REPORTS = "reports"
    const val PIC = "pic"
    const val VERIFY = "verify"
    const val DELEGATOR = "delegator"
    const val SCHEDULES = "schedules"
    const val STATS = "stats"
    fun hazard(id: String) = "hazard:$id"
    fun participants(kind: String) = "participants:$kind"
}

data class SyncUiState(val running: Boolean = false, val lastError: String? = null, val lastSyncAt: Long = 0L, val online: Boolean = true)

class Repo(context: Context) {
    val appContext: Context = context.applicationContext
    val session = Session(appContext)
    val db = AppDb.get(appContext)
    val photos = PhotoStore(appContext)
    private val api get() = Net.api(session)
    private val syncMutex = Mutex()

    private val _sync = MutableStateFlow(SyncUiState(lastSyncAt = session.lastSyncAt))
    val sync: StateFlow<SyncUiState> = _sync

    init {
        // Status Online/Offline mengikuti jaringan HP secara langsung (bukan menunggu pengiriman gagal).
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
    private fun key(k: String) = "${owner()}:$k"

    // ------------------------------------------------------------------ Auth

    suspend fun login(employeeId: String, password: String): Result<LoginUser> = runCatching {
        val res = api.login(LoginRequest(employeeId.trim(), password))
        val token = res.token ?: error("Respons login tidak valid")
        val user = res.user ?: error("Respons login tidak valid")
        session.save(token, user)
        db.outbox().releaseAuthFailures(user.id ?: "-")
        user
    }

    suspend fun requestReset(employeeId: String): Result<String> = runCatching {
        api.requestReset(mapOf("employee_id" to employeeId.trim(), "source" to "mobile")).message
            ?: "Permintaan dikirim ke admin."
    }

    suspend fun changePassword(old: String, new: String): Result<String> = runCatching {
        val msg = api.changePassword(mapOf("password_lama" to old, "password_baru" to new)).message ?: "Sandi diganti."
        session.passwordChanged()
        msg
    }

    fun logout() = session.logout()

    // ------------------------------------------------------------------ Cache offline

    private suspend fun putCache(k: String, value: Any) {
        db.cache().put(CacheEntity(key(k), Net.gson.toJson(value), System.currentTimeMillis()))
    }

    suspend fun <T> cached(k: String, type: Type): T? = db.cache().get(key(k))?.let {
        runCatching { Net.gson.fromJson<T>(it.json, type) }.getOrNull()
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun <T> observe(k: String, type: Type): Flow<T?> = session.state.flatMapLatest { s ->
        if (!s.loggedIn) emptyFlow() else db.cache().observe("${s.userId}:$k").map { e ->
            e?.let { runCatching { Net.gson.fromJson<T>(it.json, type) }.getOrNull() }
        }
    }

    fun observeBootstrap(): Flow<Bootstrap?> = observe(CacheKey.BOOTSTRAP, Bootstrap::class.java)
    suspend fun bootstrap(): Bootstrap? = cached(CacheKey.BOOTSTRAP, Bootstrap::class.java)

    /** Ambil ulang data dari server (dipanggil saat online). Gagal → cache lama tetap dipakai. */
    suspend fun refreshAll(): Result<Unit> = runCatching {
        val boot = api.bootstrap()
        putCache(CacheKey.BOOTSTRAP, boot)
        putCache(CacheKey.REPORTS, api.myReports())
        putCache(CacheKey.PIC, api.picActions())
        putCache(CacheKey.VERIFY, api.verifyQueue())
        putCache(CacheKey.SCHEDULES, api.schedules())
        putCache(CacheKey.STATS, api.stats())
        if (!boot.me?.delegatorDepartments.isNullOrEmpty()) putCache(CacheKey.DELEGATOR, api.delegatorInbox())
    }

    suspend fun refreshHazard(id: String): Result<HazardDetail> = runCatching {
        api.hazard(id).also { putCache(CacheKey.hazard(id), it) }
    }

    suspend fun refreshParticipants(kind: String): Result<List<Employee>> = runCatching {
        api.participants(kind).also { putCache(CacheKey.participants(kind), it) }
    }

    suspend fun refreshStats(month: String?): Result<Stats> = runCatching { api.stats(month).also { putCache(CacheKey.STATS, it) } }

    // ------------------------------------------------------------------ Antrean (outbox)

    fun observeOutbox(): Flow<List<OutboxEntity>> = db.outbox().observeAll(owner())
    fun observePendingCount(): Flow<Int> = db.outbox().observePendingCount(owner())
    fun observeFailedCount(): Flow<Int> = db.outbox().observeFailedCount(owner())

    /** Simpan ke antrean (selalu berhasil walau offline) lalu minta WorkManager mengirim. */
    suspend fun enqueue(
        type: String, module: String, title: String, payload: Map<String, Any?>,
        urgent: Boolean = false, refId: String? = null, clientUuid: String = UUID.randomUUID().toString(),
    ): String {
        val refs = photos.refsIn(payload)
        db.outbox().upsert(
            OutboxEntity(
                clientUuid = clientUuid, ownerUserId = owner(), type = type, module = module, title = title,
                payloadJson = Net.rawGson.toJson(payload), photoCount = refs.size, isUrgent = urgent,
                createdAt = System.currentTimeMillis(), refId = refId,
            ),
        )
        com.omos.safety.sync.SyncWorker.runNow(appContext)
        return clientUuid
    }

    fun payloadOf(item: OutboxEntity): Map<String, Any?> {
        val type = object : TypeToken<Map<String, Any?>>() {}.type
        return Net.rawGson.fromJson(item.payloadJson, type)
    }

    suspend fun retry(clientUuid: String) {
        val item = db.outbox().get(clientUuid) ?: return
        db.outbox().upsert(item.copy(status = OutboxStatus.WAITING, nextAttemptAt = 0, errorCode = null, errorMessage = null))
        com.omos.safety.sync.SyncWorker.runNow(appContext)
    }

    /** Perbaiki payload item gagal (mis. lokasi nonaktif) lalu kirim ulang dengan client_uuid yang sama. */
    suspend fun updateAndRetry(clientUuid: String, payload: Map<String, Any?>) {
        val item = db.outbox().get(clientUuid) ?: return
        db.outbox().upsert(item.copy(payloadJson = Net.rawGson.toJson(payload), status = OutboxStatus.WAITING,
            nextAttemptAt = 0, errorCode = null, errorMessage = null, photoCount = photos.refsIn(payload).size))
        com.omos.safety.sync.SyncWorker.runNow(appContext)
    }

    /** "Simpan di HP saja": tidak dikirim lagi, tetap tersimpan sebagai arsip lokal 7 hari. */
    suspend fun keepLocal(clientUuid: String) {
        val item = db.outbox().get(clientUuid) ?: return
        db.outbox().upsert(item.copy(status = OutboxStatus.SENT, errorCode = "KEPT_LOCAL", sentAt = System.currentTimeMillis()))
    }

    /** Bukti yang konflik (hazard sudah closed) dikirim sebagai catatan tambahan. */
    suspend fun convertEvidenceToNote(clientUuid: String) {
        val item = db.outbox().get(clientUuid) ?: return
        val p = payloadOf(item)
        val hazardId = (p["hazard_id"] as? String) ?: return
        val note = (p["note"] as? String)?.takeIf { it.isNotBlank() } ?: "Bukti perbaikan (terkirim setelah hazard ditutup)"
        enqueue(ItemType.HAZARD_NOTE, "Hazard", "Catatan · ${item.title}", mapOf("hazard_id" to hazardId, "note" to note, "photos" to (p["photos"] ?: emptyList<String>())), refId = hazardId)
        db.outbox().upsert(item.copy(status = OutboxStatus.SENT, errorCode = "CONVERTED_TO_NOTE", sentAt = System.currentTimeMillis()))
    }

    suspend fun discard(clientUuid: String) {
        val item = db.outbox().get(clientUuid) ?: return
        if (item.status == OutboxStatus.SENT) return
        photos.refsIn(payloadOf(item)).forEach { photos.delete(it) }
        db.outbox().delete(clientUuid)
    }

    /**
     * Kirim item yang jatuh tempo, satu per satu (payload foto bisa besar).
     * Hanya item milik user yang sedang login — HP bisa dipakai bergantian.
     */
    suspend fun syncNow(): Int = withContext(Dispatchers.IO) {
        if (!session.state.value.loggedIn || session.state.value.expired) return@withContext 0
        syncMutex.withLock {
            _sync.value = _sync.value.copy(running = true, lastError = null)
            var sent = 0
            try {
                db.outbox().resetStuck()
                while (true) {
                    val batch = db.outbox().due(owner(), System.currentTimeMillis(), 1)
                    val item = batch.firstOrNull() ?: break
                    val ok = sendOne(item)
                    if (ok == SendOutcome.STOP) break
                    if (ok == SendOutcome.SENT) sent++
                }
                session.lastSyncAt = System.currentTimeMillis()
                _sync.value = _sync.value.copy(online = true, lastSyncAt = session.lastSyncAt)
            } finally {
                _sync.value = _sync.value.copy(running = false)
            }
            sent
        }
    }

    private enum class SendOutcome { SENT, FAILED, STOP }

    private suspend fun sendOne(item: OutboxEntity): SendOutcome {
        db.outbox().upsert(item.copy(status = OutboxStatus.SENDING))
        val payload = try {
            photos.materialize(payloadOf(item))
        } catch (e: MissingPhotoException) {
            db.outbox().upsert(item.copy(status = OutboxStatus.FAILED, errorCode = "PHOTO_MISSING", errorMessage = e.message))
            return SendOutcome.FAILED
        } ?: emptyMap<String, Any?>()
        return try {
            val res = api.sync(SyncRequest(listOf(SyncItem(item.clientUuid, item.type, payload))))
            val r = res.results?.firstOrNull { it.clientUuid == item.clientUuid } ?: res.results?.firstOrNull()
            when {
                r?.status == "OK" -> {
                    db.outbox().upsert(item.copy(status = OutboxStatus.SENT, serverId = r.serverId, serverNo = r.serverNo,
                        sentAt = System.currentTimeMillis(), errorCode = null, errorMessage = null))
                    SendOutcome.SENT
                }
                r?.code == "RETRYABLE" -> { backoff(item, r.message); SendOutcome.FAILED }
                else -> {
                    db.outbox().upsert(item.copy(status = OutboxStatus.FAILED, errorCode = r?.code ?: "VALIDATION",
                        errorMessage = r?.message ?: "Ditolak server", attempts = item.attempts + 1))
                    SendOutcome.FAILED
                }
            }
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 401) {
                db.outbox().upsert(item.copy(status = OutboxStatus.FAILED, errorCode = "AUTH_EXPIRED",
                    errorMessage = "Sesi login berakhir. Masuk ulang; data tetap di HP dan langsung dikirim setelah masuk."))
                session.markExpired()
                SendOutcome.STOP
            } else {
                backoff(item, e.friendlyMessage())
                _sync.value = _sync.value.copy(lastError = e.friendlyMessage())
                if (e.code() >= 500) SendOutcome.STOP else SendOutcome.FAILED
            }
        } catch (e: Exception) {
            backoff(item, e.friendlyMessage())
            _sync.value = _sync.value.copy(online = !e.isNetworkProblem(), lastError = e.friendlyMessage())
            SendOutcome.STOP
        }
    }

    private suspend fun backoff(item: OutboxEntity, message: String?) {
        val attempts = item.attempts + 1
        val delayMin = minOf(30L, 1L shl minOf(attempts, 5))
        db.outbox().upsert(item.copy(status = OutboxStatus.WAITING, attempts = attempts,
            nextAttemptAt = System.currentTimeMillis() + delayMin * 60_000, errorCode = "RETRYABLE", errorMessage = message))
    }

    // ------------------------------------------------------------------ Notifikasi (polling)

    fun observeNotifications(): Flow<List<NotificationEntity>> = db.notifications().observe(owner())
    fun observeUnread(): Flow<Int> = db.notifications().observeUnread(owner())

    /** Ambil notifikasi baru sejak kursor terakhir. Mengembalikan item baru untuk ditampilkan sebagai notifikasi Android. */
    suspend fun pollNotifications(): List<NotificationEntity> {
        if (!session.state.value.loggedIn || session.state.value.expired) return emptyList()
        val page = api.notifications(session.notifCursor)
        val items = page.items.orEmpty().filter { it.id != null }
        if (items.isEmpty()) return emptyList()
        val entities = items.map {
            NotificationEntity(it.id!!, owner(), it.kind ?: "", it.title ?: "", it.body, it.refType, it.refId,
                it.isUrgent == true, it.createdAt, it.readAt != null)
        }
        db.notifications().insertAll(entities)
        session.notifCursor = items.maxOf { it.id!! }
        return entities.filter { !it.read }
    }

    suspend fun markAllNotificationsRead() {
        db.notifications().markAllRead(owner())
        runCatching { api.markRead(mapOf("all" to true)) }
    }

    suspend fun markNotificationRead(id: Long) {
        db.notifications().markRead(id)
        runCatching { api.markRead(mapOf("ids" to listOf(id))) }
    }

    // ------------------------------------------------------------------ Pembaruan & penyimpanan

    suspend fun appVersion(): Result<AppVersion> = runCatching { api.appVersion() }

    /** Hapus foto item terkirim lebih tua dari N hari (data tetap di server). */
    suspend fun cleanupSentPhotos(olderThanDays: Int = 7): Long {
        val before = System.currentTimeMillis() - olderThanDays * 86_400_000L
        var freed = 0L
        for (item in db.outbox().sentBefore(before)) {
            val refs = photos.refsIn(payloadOf(item))
            freed += photos.sizeOf(refs)
            refs.forEach { photos.delete(it) }
            db.outbox().delete(item.clientUuid)
        }
        return freed
    }

    /** Hapus SEMUA foto item yang sudah terkirim (tombol "Hapus foto yang sudah terkirim"). */
    suspend fun cleanupAllSentPhotos(): Long = cleanupSentPhotos(0)
}
