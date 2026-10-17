package com.omos.safety.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.omos.safety.BuildConfig
import com.omos.safety.data.AppVersion
import com.omos.safety.data.CacheKey
import com.omos.safety.data.ItemType
import com.omos.safety.data.Stats
import com.omos.safety.data.db.OutboxEntity
import com.omos.safety.data.db.OutboxStatus
import com.omos.safety.sync.SyncWorker
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Card
import com.omos.safety.ui.EmptyState
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.KeyValue
import com.omos.safety.ui.Label
import com.omos.safety.ui.LocationPicker
import com.omos.safety.ui.Notice
import com.omos.safety.ui.Pill
import com.omos.safety.ui.Screen
import com.omos.safety.ui.TabChips
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.fmtBytes
import com.omos.safety.ui.fmtDate
import com.omos.safety.ui.fmtDateTime
import com.omos.safety.ui.fmtMillis
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import com.omos.safety.update.UpdateManager
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ Antrean kirim & penyimpanan

private fun failureKind(code: String?) = when (code) {
    "CONFLICT_CLOSED" -> "Konflik data"
    "CONFLICT_STATE", "CONFLICT_PENDING" -> "Status sudah berubah"
    "MASTER_INACTIVE" -> "Data master berubah"
    "AUTH_EXPIRED" -> "Sesi login berakhir"
    "PHOTO_MISSING" -> "Foto hilang"
    "FORBIDDEN" -> "Tidak berwenang"
    "NO_DELEGATOR" -> "Delegator belum diatur"
    "NOT_FOUND" -> "Data tidak ditemukan"
    else -> "Ditolak server"
}

@Composable
fun OutboxScreen(onBack: () -> Unit, onRelogin: () -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val items by repo.observeOutbox().collectAsState(initial = emptyList())
    val sync by repo.sync.collectAsState()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var storage by remember { mutableStateOf(repo.photos.storageInfo()) }
    var freed by remember { mutableStateOf<Long?>(null) }
    var fixLocation by remember { mutableStateOf<OutboxEntity?>(null) }
    val failed = items.filter { it.status == OutboxStatus.FAILED }
    val waiting = items.filter { it.status == OutboxStatus.WAITING || it.status == OutboxStatus.SENDING }
    val sentPhotos = items.filter { it.status == OutboxStatus.SENT }
    val pendingPhotoBytes = waiting.sumOf { repo.photos.sizeOf(repo.photos.refsIn(repo.payloadOf(it))) } + failed.sumOf { repo.photos.sizeOf(repo.photos.refsIn(repo.payloadOf(it))) }
    val sentPhotoBytes = sentPhotos.sumOf { repo.photos.sizeOf(repo.photos.refsIn(repo.payloadOf(it))) }
    Screen("Antrean Kirim", "${failed.size} gagal · ${waiting.size} menunggu · terakhir sinkron ${fmtMillis(sync.lastSyncAt)}", onBack = onBack) {
        GhostButton(if (sync.running) "Mengirim…" else "Kirim sekarang", { scope.launch { repo.syncNow() } }, Modifier.fillMaxWidth(), color = p.green, border = p.green, enabled = !sync.running)
        if (!sync.online) Notice("Tidak ada sinyal. Data aman di HP, terkirim otomatis saat online.", Tone.WARN)
        Text("Perlu tindakan Anda (${failed.size})", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.redDark)
        if (failed.isEmpty()) Notice("Tidak ada data gagal.", Tone.OK)
        failed.forEach { it ->
            Card(border = p.red) {
                Row { Text(failureKind(it.errorCode).uppercase(), style = Type.tiny.copy(fontWeight = FontWeight.Bold), color = p.redDark, modifier = Modifier.weight(1f)); Text(fmtMillis(it.createdAt), style = Type.tiny, color = p.muted) }
                Text("${it.module} · ${it.title}", style = Type.title, color = p.ink)
                Text(it.errorMessage ?: "-", style = Type.small, color = p.muted2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        it.errorCode == "CONFLICT_CLOSED" && it.type == ItemType.ACTION_EVIDENCE -> {
                            BigButton("Kirim sebagai catatan", { scope.launch { repo.convertEvidenceToNote(it.clientUuid) } }, Modifier.weight(1f), height = 48.dp)
                            GhostButton("Simpan di HP saja", { scope.launch { repo.keepLocal(it.clientUuid) } }, Modifier.weight(1f))
                        }
                        it.errorCode == "MASTER_INACTIVE" && (it.type == ItemType.HAZARD_CREATE || it.type == ItemType.INCIDENT_CREATE) -> {
                            BigButton("Perbaiki & kirim", { fixLocation = it }, Modifier.weight(1f), height = 48.dp)
                            GhostButton("Hapus", { scope.launch { repo.discard(it.clientUuid) } }, Modifier.weight(1f), color = p.red)
                        }
                        it.errorCode == "AUTH_EXPIRED" -> {
                            BigButton("Masuk ulang", onRelogin, Modifier.weight(1f), height = 48.dp)
                            GhostButton("Nanti", {}, Modifier.weight(1f))
                        }
                        else -> {
                            BigButton("Coba lagi", { scope.launch { repo.retry(it.clientUuid) } }, Modifier.weight(1f), height = 48.dp)
                            GhostButton("Hapus dari HP", { scope.launch { repo.discard(it.clientUuid) } }, Modifier.weight(1f), color = p.red)
                        }
                    }
                }
            }
        }
        Text("Dicoba ulang otomatis (${waiting.size})", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2)
        if (waiting.isNotEmpty()) Card {
            waiting.forEach { w ->
                Column(Modifier.padding(vertical = 4.dp)) {
                    Text("${w.module} · ${w.title}${if (w.isUrgent) "  · DARURAT" else ""}", style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = if (w.isUrgent) p.redDark else p.ink)
                    Text(
                        when {
                            w.status == OutboxStatus.SENDING -> "Mengirim…"
                            w.attempts > 0 -> "${w.errorMessage ?: "Gagal sementara"} · percobaan ${w.attempts} · berikutnya ${fmtMillis(w.nextAttemptAt)}"
                            else -> "Menunggu sinyal · ${w.photoCount} foto"
                        }, style = Type.tiny, color = p.muted,
                    )
                }
            }
        }
        Hint("Data tidak pernah dihapus otomatis. Mengirim ulang tidak membuat laporan ganda: server mengenali setiap laporan dari kode uniknya.")
        Label("Penyimpanan HP")
        val usedPct = if (storage.totalBytes > 0) (100 * (storage.totalBytes - storage.freeBytes) / storage.totalBytes).toInt() else 0
        val low = storage.freeBytes < 1024L * 1024 * 1024
        Card(bg = if (low) p.amberBg else p.surface, border = if (low) p.amber else p.border) {
            Row {
                Text(if (low) "Ruang HP hampir penuh" else "Ruang HP cukup", style = Type.title, color = if (low) p.amberText else p.ink, modifier = Modifier.weight(1f))
                Text("sisa ${fmtBytes(storage.freeBytes)}", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (low) p.amberText else p.muted2)
            }
            LinearProgressIndicator(progress = { usedPct / 100f }, modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)),
                color = if (low) p.amber else p.green, trackColor = p.border)
            KeyValue("Foto menunggu dikirim", fmtBytes(pendingPhotoBytes))
            KeyValue("Foto sudah terkirim (disimpan 7 hari)", fmtBytes(sentPhotoBytes))
            GhostButton(freed?.let { "${fmtBytes(it)} dibebaskan" } ?: "Hapus foto yang sudah terkirim (${fmtBytes(sentPhotoBytes)})", {
                scope.launch { freed = repo.cleanupAllSentPhotos(); storage = repo.photos.storageInfo() }
            }, Modifier.fillMaxWidth(), color = p.amberText, border = p.amber, enabled = freed == null && sentPhotoBytes > 0)
            Hint("Foto dikompres ±300 KB. Di bawah 200 MB, aplikasi hanya mengizinkan 1 foto per laporan. Jangan hapus data aplikasi atau uninstall sebelum antrean kosong.", p.amberText)
        }
    }
    fixLocation?.let { item ->
        var loc by remember { mutableStateOf<String?>(null) }
        DialogShell("Pilih lokasi yang masih aktif", { fixLocation = null }) {
            LocationPicker(boot?.areas.orEmpty(), loc, { loc = it })
            BigButton("Simpan & kirim ulang", {
                scope.launch {
                    repo.updateAndRetry(item.clientUuid, repo.payloadOf(item) + ("location_id" to loc))
                    fixLocation = null
                }
            }, enabled = loc != null)
        }
    }
}

// ------------------------------------------------------------------ Notifikasi

@Composable
fun NotificationsScreen(onBack: () -> Unit, onOpen: (refType: String?, refId: String?) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val items by repo.observeNotifications().collectAsState(initial = emptyList())
    var tab by remember { mutableStateOf("unread") }
    LaunchedEffect(Unit) { runCatching { repo.pollNotifications() } }
    val unread = items.count { !it.read }
    Screen("Notifikasi", onBack = onBack, trailing = {
        Text("Tandai semua dibaca", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.green,
            modifier = Modifier.clickable { scope.launch { repo.markAllNotificationsRead() } }.padding(12.dp))
    }) {
        TabChips(listOf("unread" to "Belum dibaca ($unread)", "all" to "Semua"), tab, { tab = it })
        val list = if (tab == "unread") items.filter { !it.read } else items
        if (list.isEmpty()) EmptyState("Tidak ada notifikasi.")
        list.forEach { n ->
            Card(border = if (n.isUrgent && !n.read) p.red else p.border, bg = if (n.read) p.surface else p.greenSoft, onClick = {
                scope.launch { repo.markNotificationRead(n.id) }
                onOpen(n.refType, n.refId)
            }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (n.isUrgent) Pill("DARURAT", p.redBg, p.redDark)
                    Text(fmtDateTime(n.createdAt), style = Type.tiny, color = p.muted, modifier = Modifier.weight(1f).padding(start = 6.dp))
                }
                Text(n.title, style = Type.body.copy(fontWeight = if (n.read) FontWeight.Normal else FontWeight.SemiBold), color = p.ink)
                n.body?.let { Text(it, style = Type.small, color = p.muted2) }
            }
        }
        Hint("Setiap perubahan status dikirim ke pelapor, PIC, dan HSE terkait. Aplikasi memeriksa notifikasi baru otomatis sekitar tiap 15 menit dan setiap kali sinkron; buka layar ini untuk cek sekarang.")
    }
}

// ------------------------------------------------------------------ Statistik

@Composable
fun StatsScreen(nav: (String) -> Unit) {
    val repo = rememberRepo()
    val stats by rememberCache<Stats>(repo, CacheKey.STATS)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    LaunchedEffect(Unit) { repo.refreshStats(null) }
    val inspectionRows = stats?.rows.orEmpty().count { it.key == "inspection" }
    val localExtra = mapOf(
        "hazard" to outbox.count { it.status != OutboxStatus.SENT && it.type == ItemType.HAZARD_CREATE },
        // Inspeksi offline hanya bisa ditambahkan bila target inspeksi tidak dipecah per jenis.
        "inspection" to if (inspectionRows == 1) outbox.count { it.status != OutboxStatus.SENT && it.type == ItemType.INSPECTION_CREATE } else 0,
    )
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Box(Modifier.weight(1f)) {
            Screen("Pencapaian Saya", "Target dari Setup Master HSE untuk Anda") {
                val rows = stats?.rows.orEmpty()
                if (rows.isEmpty()) EmptyState(if (stats == null) "Statistik belum terunduh. Sambungkan internet." else "Target belum diatur.")
                val withTarget = rows.filter { (it.target ?: 0) > 0 }
                if (withTarget.isNotEmpty()) {
                    val pct = withTarget.map { minOf(100, 100 * ((it.actual ?: 0) + (localExtra[it.key] ?: 0)) / maxOf(1, it.target ?: 1)) }.average().toInt()
                    Card {
                        Text("Pencapaian total", style = Type.small, color = p.muted2)
                        Text("$pct%", style = Type.display, color = p.ink)
                        LinearProgressIndicator(progress = { pct / 100f }, modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)), color = p.green, trackColor = p.border)
                    }
                }
                rows.forEach { r ->
                    val actual = (r.actual ?: 0) + (localExtra[r.key] ?: 0)
                    val target = r.target ?: 0
                    val ok = target > 0 && actual >= target
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(r.label ?: "-", style = Type.title, color = p.ink, modifier = Modifier.weight(1f))
                            if (ok) Pill("Tercapai", p.greenBg, p.green)
                        }
                        Text(if (target > 0) "$actual / $target" else "$actual", style = Type.display, color = p.ink)
                        Text(statTargetText(r), style = Type.small, color = if (target > 0) p.muted2 else p.amberText)
                        if (target > 0) LinearProgressIndicator(progress = { minOf(1f, actual / target.toFloat()) }, modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
                            color = if (ok) p.green else p.amber, trackColor = p.border)
                        if ((localExtra[r.key] ?: 0) > 0) Hint("termasuk ${localExtra[r.key]} yang masih tersimpan di HP")
                    }
                }
                Hint("Target per individu dari Setup Hazard Report, Setup Inspeksi, Setup P5M & Setup Safety Talk (aturan khusus karyawan didahulukan dari aturan jabatan). Aktual dihitung pada periode berjalan; P5M & Safety Talk dihitung dari kehadiran Anda sebagai peserta.")
            }
        }
        BottomBar(R.STATS, nav)
    }
}

private fun cycleText(c: String?) = when (c) { "DAILY" -> "hari"; "WEEKLY" -> "minggu"; else -> "bulan" }

/** Keterangan target: siklus + periode berjalan, atau alasan tidak bertarget. */
private fun statTargetText(r: com.omos.safety.data.StatRow): String = when (r.status) {
    "WAJIB" -> {
        val period = when (r.cycle) {
            "DAILY" -> "hari ini, ${fmtDate(r.periodFrom)}"
            "WEEKLY" -> "minggu ini, ${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}"
            else -> "bulan ini, ${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}"
        }
        "Target ${r.target}× per ${cycleText(r.cycle)}${if (r.source == "INDIVIDUAL") " (khusus Anda)" else ""} · $period"
    }
    "BEBAS" -> "Bebas kewajiban (target 0) di Setup Master"
    "TIDAK_DISELEKSI" -> "Anda tidak termasuk Seleksi Karyawan di Setup Master"
    else -> "Target belum diatur di Setup Master"
}

// ------------------------------------------------------------------ Profil & update

@Composable
fun ProfileScreen(nav: (String) -> Unit, darkMode: Boolean, onDarkMode: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val session by repo.session.state.collectAsState()
    val sync by repo.sync.collectAsState()
    val pending by repo.observePendingCount().collectAsState(initial = 0)
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var update by remember { mutableStateOf<UpdateManager.State>(UpdateManager.State.Idle) }
    var info by remember { mutableStateOf<AppVersion?>(null) }
    var confirmLogout by remember { mutableStateOf(false) }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    suspend fun check() {
        repo.appVersion().onSuccess { v ->
            info = v
            update = if (v.available == true && UpdateManager.isNewer(v)) { update = UpdateManager.State.Downloading(v); UpdateManager.download(ctx, v) } else UpdateManager.State.UpToDate
        }.onFailure { update = UpdateManager.State.Failed("Tidak bisa cek pembaruan (offline?)") }
    }
    LaunchedEffect(Unit) { check() }
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Box(Modifier.weight(1f)) {
            Screen(session.nama ?: "-", "${session.employeeId ?: ""} · ${session.jabatan ?: ""} · ${session.departemen ?: ""}") {
                when (val u = update) {
                    is UpdateManager.State.Ready -> Card(bg = p.header, border = p.header) {
                        Text("Versi baru ${u.info.versionName} siap dipasang", style = Type.title, color = p.headerText)
                        Text("Sudah diunduh otomatis · terverifikasi SHA-256", style = Type.small, color = p.headerMuted)
                        u.info.releaseNotes.orEmpty().forEach { Text("• $it", style = Type.small, color = p.headerMuted) }
                        BigButton("Pasang sekarang", {
                            if (UpdateManager.canInstallPackages(ctx)) UpdateManager.install(ctx, u.file) else UpdateManager.openInstallPermission(ctx)
                        }, container = p.accent, content = p.header)
                        Text("Data yang belum terkirim tetap aman selama update.", style = Type.tiny, color = p.headerMuted)
                    }
                    is UpdateManager.State.Downloading -> Notice("Mengunduh versi ${u.info.versionName} di latar belakang…")
                    is UpdateManager.State.Failed -> Notice(u.message, Tone.WARN)
                    else -> {}
                }
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Sinkronisasi", style = Type.title, color = p.ink)
                            Text("Terakhir: ${fmtMillis(sync.lastSyncAt)} · $pending tertunda", style = Type.small, color = p.muted)
                        }
                        GhostButton(if (sync.running) "Mengirim…" else "Kirim sekarang", { scope.launch { repo.syncNow(); repo.refreshAll() } }, color = p.green, border = p.green, enabled = !sync.running)
                    }
                    com.omos.safety.ui.Divider()
                    Text("Data master offline", style = Type.title, color = p.ink)
                    Text("Area, PIC, matriks risiko, templat inspeksi · ${boot?.masterVersion ?: "belum terunduh"}", style = Type.small, color = p.muted)
                    com.omos.safety.ui.Divider()
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Versi aplikasi", style = Type.title, color = p.ink)
                            Text("${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})", style = Type.small, color = p.muted)
                        }
                        GhostButton("Cek update", { scope.launch { check() } })
                    }
                    com.omos.safety.ui.Divider()
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Tampilan gelap", style = Type.title, color = p.ink)
                            Text("Nyaman untuk shift malam", style = Type.small, color = p.muted)
                        }
                        Switch(darkMode, onDarkMode, colors = SwitchDefaults.colors(checkedTrackColor = p.green))
                    }
                    if (Build.VERSION.SDK_INT >= 33) {
                        com.omos.safety.ui.Divider()
                        GhostButton("Izinkan notifikasi", { notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }, Modifier.fillMaxWidth())
                    }
                }
                GhostButton("Antrean kirim & penyimpanan", { nav(R.OUTBOX) }, Modifier.fillMaxWidth())
                GhostButton("Ganti sandi", { nav(R.CHANGE_PASS) }, Modifier.fillMaxWidth())
                GhostButton("Keluar", { confirmLogout = true }, Modifier.fillMaxWidth(), color = p.red, border = p.red)
                Hint("Server: ${BuildConfig.API_BASE_URL}")
            }
        }
        BottomBar(R.PROFILE, nav)
    }
    if (confirmLogout) DialogShell("Keluar dari OMOS Safety?", { confirmLogout = false }) {
        Text(if (pending > 0) "Masih ada $pending data belum terkirim. Data tetap tersimpan di HP dan akan dikirim setelah Anda masuk lagi dengan akun yang sama." else "Anda bisa masuk lagi kapan saja.",
            style = Type.body, color = p.ink)
        BigButton("Keluar", { repo.logout(); confirmLogout = false }, container = p.red)
    }
}

/** Layar penghalang: versi terpasang < minimum_supported_version → wajib update. */
@Composable
fun UpdateRequiredScreen(state: UpdateManager.State, onRetry: () -> Unit) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().background(p.header).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Text("Update wajib", style = Type.display, color = p.headerText)
        Text("Versi ini sudah tidak didukung server. Pasang versi baru untuk melanjutkan. Data yang belum terkirim tetap aman di HP.", style = Type.body, color = p.headerMuted)
        when (state) {
            is UpdateManager.State.Ready -> {
                state.info.releaseNotes.orEmpty().forEach { Text("• $it", style = Type.small, color = p.headerMuted) }
                BigButton("Pasang versi ${state.info.versionName}", {
                    if (UpdateManager.canInstallPackages(ctx)) UpdateManager.install(ctx, state.file) else UpdateManager.openInstallPermission(ctx)
                }, container = p.accent, content = p.header)
                if (!UpdateManager.canInstallPackages(ctx)) Text("Izinkan \"Instal aplikasi tak dikenal\" untuk OMOS Safety, lalu kembali ke sini.", style = Type.small, color = p.headerMuted)
            }
            is UpdateManager.State.Downloading -> Text("Mengunduh pembaruan…", style = Type.body, color = p.headerText)
            is UpdateManager.State.Failed -> { Text(state.message, style = Type.body, color = p.accent); BigButton("Coba lagi", onRetry, container = p.accent, content = p.header) }
            else -> Text("Memeriksa…", style = Type.body, color = p.headerText)
        }
    }
}
