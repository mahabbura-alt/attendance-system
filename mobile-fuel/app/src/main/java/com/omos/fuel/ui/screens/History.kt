package com.omos.fuel.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import com.omos.fuel.BuildConfig
import com.omos.fuel.data.db.OutboxEntity
import com.omos.fuel.data.db.OutboxStatus
import com.omos.fuel.data.friendlyMessage
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.Chips
import com.omos.fuel.ui.KeyValue
import com.omos.fuel.ui.Pill
import com.omos.fuel.ui.Screen
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.p
import com.omos.fuel.ui.rememberRepo
import com.omos.fuel.update.UpdateManager
import kotlinx.coroutines.launch

private val FLAG_LABELS = mapOf(
    "manual_unit" to "unit manual", "late_entry" to "terlambat", "over_tank_capacity" to "melebihi tangki",
    "hm_gap_exceeded" to "selisih HM", "hm_event_required" to "perlu Event HM", "ledger_stock_short" to "stok ledger kurang",
    "device_revoked" to "perangkat dicabut",
)

/** Label + warna status antrean / status di server. */
fun statusOf(item: OutboxEntity): Pair<String, Tone> = when (item.status) {
    OutboxStatus.WAITING -> (if (item.errorCode == "AUTH_EXPIRED") "Login ulang" else "Antre") to Tone.WARN
    OutboxStatus.SENDING -> "Mengirim" to Tone.INFO
    OutboxStatus.REJECTED -> "Ditolak" to Tone.BAD
    else -> when (item.serverStatus) {
        "pending_validation", "draft" -> "Menunggu validasi" to Tone.INFO
        "submitted" -> "Menunggu approval" to Tone.INFO
        "posted", "approved", "adjusted" -> "Divalidasi" to Tone.OK
        "rejected", "void" -> "Ditolak admin" to Tone.BAD
        "held_hm" -> "Tertahan Event HM" to Tone.WARN
        "investigation" -> "Perlu investigasi" to Tone.WARN
        "open" -> "Shift dibuka" to Tone.OK
        "closed", "reviewed" -> "Shift ditutup" to Tone.OK
        else -> "Terkirim" to Tone.OK
    }
}

@Composable
fun HistoryScreen(nav: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val items by repo.observeOutbox().collectAsState(initial = emptyList())
    val sync by repo.sync.collectAsState()
    var filter by remember { mutableStateOf("all") }
    val shown = items.filter {
        when (filter) {
            "queue" -> it.status == OutboxStatus.WAITING || it.status == OutboxStatus.SENDING
            "rejected" -> it.status == OutboxStatus.REJECTED || it.serverStatus == "rejected" || it.serverStatus == "void"
            else -> true
        }
    }
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Column(Modifier.weight(1f)) {
            Screen("Riwayat & sinkron", subtitle = "Transaksi yang dicatat di HP ini") {
                Chips(listOf("all" to "Semua", "queue" to "Antre", "rejected" to "Ditolak"), filter) { filter = it }
                if (shown.isEmpty()) Text("Belum ada transaksi.", style = Type.body, color = p.muted)
                shown.forEach { item -> HistoryRow(item, repo.flagsOf(item)) { scope.launch { repo.discard(item.clientUuid) } } }
                BigButton(if (sync.running) "Mengirim…" else "Kirim sekarang", primary = false, enabled = !sync.running) { scope.launch { repo.retryNow() } }
                sync.lastError?.let { Text(it, style = Type.small, color = p.bad) }
            }
        }
        BottomNav(R.HISTORY, nav)
    }
}

@Composable
private fun HistoryRow(item: OutboxEntity, flags: List<String>, onDiscard: () -> Unit) {
    val (label, tone) = statusOf(item)
    Card {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(item.title, style = Type.title, color = p.ink)
                Text(fmtMillis(item.createdAt), style = Type.small, color = p.muted)
            }
            Pill(label, tone)
        }
        if (flags.isNotEmpty()) Text("Ditandai: " + flags.joinToString(", ") { FLAG_LABELS[it] ?: it }, style = Type.small, color = p.warn)
        val pesan = item.serverReason ?: if (item.status != OutboxStatus.SENT) item.errorMessage else null
        pesan?.let { Text(it, style = Type.small, color = if (tone == Tone.BAD) p.bad else p.muted) }
        if (item.status == OutboxStatus.REJECTED) {
            Text("Catat ulang transaksi yang benar, lalu hapus yang ditolak dari HP.", style = Type.small, color = p.muted)
            BigButton("Hapus dari HP", primary = false, height = 44.dp, onClick = onDiscard)
        }
    }
}

@Composable
fun AccountScreen(nav: (String) -> Unit, dark: Boolean, onDark: (Boolean) -> Unit, contrast: Boolean, onContrast: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val session by repo.session.state.collectAsState()
    var info by remember { mutableStateOf<String?>(null) }
    var update by remember { mutableStateOf<UpdateManager.State?>(null) }
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Column(Modifier.weight(1f)) {
            Screen("Akun & perangkat") {
                Card {
                    Text(session.officer?.nama ?: "-", style = Type.title, color = p.ink)
                    KeyValue("Employee ID", session.officer?.employeeId ?: "-")
                    KeyValue("Fungsi", session.officer?.functions?.joinToString(", ") ?: "-")
                    KeyValue("Perangkat", "${session.deviceCode ?: "-"} · ${session.deviceStatus ?: "-"}")
                }
                BigButton("Ganti petugas / kunci", primary = false) { repo.lock() }
                BigButton("Ganti PIN", primary = false) { nav(R.CHANGE_PIN) }
                BigButton("Segarkan data master", primary = false) {
                    scope.launch { info = runCatching { repo.refreshBootstrap(); "Data master diperbarui." }.getOrElse { it.friendlyMessage() } }
                }
                info?.let { Banner(it, Tone.INFO) }
                Card {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Mode gelap (shift malam)", style = Type.body, color = p.ink, modifier = Modifier.weight(1f))
                        Switch(dark, onDark)
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Kontras tinggi (siang terik)", style = Type.body, color = p.ink, modifier = Modifier.weight(1f))
                        Switch(contrast, onContrast)
                    }
                }
                Card {
                    Text("Petugas di perangkat ini", style = Type.title, color = p.ink)
                    repo.session.officers().forEach { o ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Column(Modifier.size(10.dp).clip(CircleShape).background(if (o.userId == session.userId) p.ok else p.line)) {}
                            Text("${o.nama} · ${o.employeeId}", style = Type.small, color = p.ink)
                        }
                    }
                    Text("Antrean tiap petugas dikirim atas nama pencatatnya.", style = Type.small, color = p.muted)
                }
                Card {
                    KeyValue("Versi aplikasi", BuildConfig.VERSION_NAME)
                    BigButton("Cek pembaruan", primary = false, height = 46.dp) {
                        scope.launch {
                            repo.appVersion().onSuccess { v ->
                                update = if (v.available == true && UpdateManager.isNewer(v)) UpdateManager.download(ctx, v) else UpdateManager.State.UpToDate
                            }.onFailure { update = UpdateManager.State.Failed(it.friendlyMessage()) }
                        }
                    }
                    when (val u = update) {
                        UpdateManager.State.UpToDate -> Text("Sudah versi terbaru.", style = Type.small, color = p.ok)
                        is UpdateManager.State.Failed -> Text(u.message, style = Type.small, color = p.bad)
                        is UpdateManager.State.Ready -> BigButton("Pasang versi ${u.info.versionName}", height = 46.dp) {
                            if (UpdateManager.canInstallPackages(ctx)) UpdateManager.install(ctx, u.file) else UpdateManager.openInstallPermission(ctx)
                        }
                        else -> {}
                    }
                }
            }
        }
        BottomNav(R.ACCOUNT, nav)
    }
}

@Composable
fun UpdateRequiredScreen(state: UpdateManager.State, onRetry: () -> Unit) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().background(p.bg).verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Pembaruan wajib", style = Type.display, color = p.ink, modifier = Modifier.padding(top = 40.dp))
        when (state) {
            is UpdateManager.State.Downloading -> Text("Mengunduh versi ${state.info.versionName}…", style = Type.body, color = p.muted)
            is UpdateManager.State.Ready -> {
                Text("Versi ${state.info.versionName} siap dipasang. Data di antrean tetap aman.", style = Type.body, color = p.ink)
                state.info.releaseNotes?.forEach { Text("• $it", style = Type.small, color = p.muted) }
                BigButton("Pasang sekarang") {
                    if (UpdateManager.canInstallPackages(ctx)) UpdateManager.install(ctx, state.file) else UpdateManager.openInstallPermission(ctx)
                }
            }
            is UpdateManager.State.Failed -> { Text(state.message, style = Type.body, color = p.bad); BigButton("Coba lagi", onClick = onRetry) }
            else -> {}
        }
    }
}
