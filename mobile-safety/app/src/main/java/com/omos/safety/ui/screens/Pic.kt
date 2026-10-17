package com.omos.safety.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.omos.safety.data.ActionRow
import com.omos.safety.data.CacheKey
import com.omos.safety.data.ItemType
import com.omos.safety.data.db.OutboxEntity
import com.omos.safety.data.db.OutboxStatus
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.CapaProgressCard
import com.omos.safety.ui.Card
import com.omos.safety.ui.DateField
import com.omos.safety.ui.Dropdown
import com.omos.safety.ui.EmptyState
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.KeyValue
import com.omos.safety.ui.Label
import com.omos.safety.ui.Notice
import com.omos.safety.ui.PhotoSlots
import com.omos.safety.ui.Pill
import com.omos.safety.ui.RemotePhotos
import com.omos.safety.ui.RiskPill
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Segmented
import com.omos.safety.ui.TabChips
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.actionStatusLabel
import com.omos.safety.ui.dueText
import com.omos.safety.ui.fmtDate
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import com.omos.safety.ui.statusColors
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Status lokal yang belum terkirim menimpa status server di tampilan (offline-first). */
private fun localStatus(a: ActionRow, outbox: List<OutboxEntity>): String? {
    val mine = outbox.filter { it.refId == a.actionId && it.status != OutboxStatus.SENT }
    return when {
        mine.any { it.type == ItemType.ACTION_EVIDENCE } -> "DONE_PENDING_VERIFY"
        mine.any { it.type == ItemType.ACTION_START } -> "IN_PROGRESS"
        else -> null
    }
}

@Composable
fun PicInboxScreen(onBack: () -> Unit, onRequest: (actionId: String, mode: String) -> Unit) {
    val repo = rememberRepo()
    val list by rememberCache<List<ActionRow>>(repo, CacheKey.PIC)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    var tab by rememberSaveable { mutableStateOf("act") }
    var selected by remember { mutableStateOf<ActionRow?>(null) }
    LaunchedEffect(Unit) { repo.refreshAll() }
    val rows = list.orEmpty().map { it to (localStatus(it, outbox) ?: it.actionStatus) }
    fun group(s: String?) = when (s) { "DONE_PENDING_VERIFY" -> "wait"; "CLOSED" -> "done"; else -> "act" }
    val count = { g: String -> rows.count { group(it.second) == g } }
    Screen("Laporan untuk Saya", "Hazard dari pelapor lain · Anda sebagai PIC", onBack = onBack) {
        TabChips(listOf("act" to "Perlu tindakan (${count("act")})", "wait" to "Verifikasi (${count("wait")})", "done" to "Selesai (${count("done")})"), tab, { tab = it })
        val shown = rows.filter { group(it.second) == tab }
        if (shown.isEmpty()) EmptyState(if (list == null) "Data belum terunduh. Sambungkan internet." else "Tidak ada laporan di sini.")
        shown.forEach { (a, status) ->
            val rejected = a.rejectedReason != null && status == "IN_PROGRESS"
            val (due, overdue) = dueText(a.dueAt, a.dueDate)
            val (sbg, sfg) = statusColors(status, rejected)
            Card(onClick = { selected = a }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(a.reportNo ?: "-", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f))
                    RiskPill(a.riskLevel)
                }
                Text(a.description ?: "-", style = Type.title, color = p.ink, maxLines = 2)
                Text("${a.categoryName ?: ""} · Pelapor ${a.reportedByName ?: "-"} · ${fmtDate(a.reportDate)}", style = Type.small, color = p.muted)
                if (status == "OPEN" || status == "IN_PROGRESS") Text((if (overdue) "⚠ " else "") + due + if (overdue) " · dieskalasi ke delegator" else "",
                    style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (overdue) p.red else p.muted2)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Pill(actionStatusLabel(status, rejected), sbg, sfg)
                    if (a.pendingRequestType != null) { Text("  ", style = Type.tiny); Pill(if (a.pendingRequestType == "EXTEND") "Minta perpanjangan…" else "Minta pengalihan…", p.blueBg, p.blue) }
                    Text(when (status) { "OPEN" -> "Mulai ›"; "IN_PROGRESS" -> "Kirim bukti ›"; else -> "Lihat ›" },
                        style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.green, modifier = Modifier.weight(1f).padding(start = 8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
                }
            }
        }
    }
    selected?.let { a -> PicDetailDialog(a, localStatus(a, outbox) ?: a.actionStatus, onClose = { selected = null }, onRequest = { mode -> selected = null; onRequest(a.actionId!!, mode) }) }
}

@Composable
private fun PicDetailDialog(a: ActionRow, status: String?, onClose: () -> Unit, onRequest: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var photos by remember { mutableStateOf(listOf<String>()) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val rejected = a.rejectedReason != null && status == "IN_PROGRESS"
    val (due, overdue) = dueText(a.dueAt, a.dueDate)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.95f).heightIn(max = 720.dp), shape = RoundedCornerShape(20.dp), color = p.surface) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text("${a.reportNo} · ${a.categoryName ?: ""}", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2)
                        Text(a.description ?: "-", style = Type.display, color = p.ink)
                        Text("Pelapor ${a.reportedByName ?: "-"} · ${a.locationName ?: ""} · ${fmtDate(a.reportDate)} ${a.reportTime?.take(5) ?: ""}", style = Type.small, color = p.muted)
                    }
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Tutup", tint = p.ink) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RiskPill(a.riskLevel)
                    val (bg, fg) = statusColors(status, rejected)
                    Pill(actionStatusLabel(status, rejected), bg, fg)
                    if (a.stopWork == true) Pill("STOP WORK", p.redBg, p.redDark)
                }
                Card(bg = p.bg) {
                    if (!a.potentialConsequence.isNullOrBlank()) KeyValue("Konsekuensi / dampak", a.potentialConsequence)
                    KeyValue("Rekomendasi perbaikan (tugas Anda)", a.actionDescription)
                    if (!a.immediateAction.isNullOrBlank()) KeyValue("Tindakan segera pelapor", a.immediateAction)
                }
                if ((a.capaTotal ?: 0) > 1) CapaProgressCard(a.capaClosed ?: 0, a.capaTotal ?: 0)
                RemotePhotos(a.photos, "Foto temuan")
                if (status == "OPEN" || status == "IN_PROGRESS") Text((if (overdue) "⚠ " else "⏱ ") + due, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = if (overdue) p.red else p.muted2)
                if (rejected) Notice(a.rejectedReason ?: "", Tone.DANGER, title = "Ditolak saat verifikasi")
                if ((status == "OPEN" || status == "IN_PROGRESS") && a.pendingRequestId == null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GhostButton("Bukan area saya", { onRequest("REASSIGN") }, Modifier.weight(1f))
                        GhostButton("Minta perpanjangan", { onRequest("EXTEND") }, Modifier.weight(1f))
                    }
                    Hint("Diputuskan oleh Delegator departemen Anda. PIC tidak bisa mengalihkan sendiri.")
                } else if (a.pendingRequestId != null) Notice("Permintaan ${if (a.pendingRequestType == "EXTEND") "perpanjangan" else "pengalihan"} menunggu keputusan delegator. Batas waktu tetap berjalan.")
                when (status) {
                    "OPEN" -> {
                        BigButton("Mulai tindak lanjut", {
                            busy = true
                            scope.launch {
                                repo.enqueue(ItemType.ACTION_START, "Tindak lanjut", "Mulai · ${a.reportNo}", mapOf("action_id" to a.actionId), refId = a.actionId)
                                busy = false; onClose()
                            }
                        }, container = p.blue, loading = busy)
                        Hint("Status berubah menjadi In Progress · pelapor mendapat notifikasi.")
                    }
                    "IN_PROGRESS" -> {
                        PhotoSlots(photos, { photos = it }, max = 3, minRequired = 1, label = "Bukti perbaikan")
                        Field(note, { note = it }, label = "Tindakan yang dilakukan", minLines = 2)
                        BigButton("Kirim untuk verifikasi", {
                            busy = true
                            scope.launch {
                                repo.enqueue(ItemType.ACTION_EVIDENCE, "Tindak lanjut", "Bukti · ${a.reportNo}",
                                    mapOf("action_id" to a.actionId, "hazard_id" to a.hazardId, "photos" to photos, "note" to note.trim()), refId = a.actionId)
                                busy = false; onClose()
                            }
                        }, enabled = photos.isNotEmpty(), loading = busy)
                        Hint(if (photos.isEmpty()) "Lampirkan minimal 1 foto bukti perbaikan." else "Status jadi Menunggu verifikasi · HSE & pelapor mendapat notifikasi. Bisa dikirim walau offline.")
                    }
                    "DONE_PENDING_VERIFY" -> Notice("Menunggu verifikasi HSE / pelapor.", Tone.INFO)
                    "CLOSED" -> Notice("Closed · diverifikasi.", Tone.OK)
                }
            }
        }
    }
}

@Composable
fun PicRequestScreen(actionId: String, initialMode: String, onBack: () -> Unit, onSent: () -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    val list by rememberCache<List<ActionRow>>(repo, CacheKey.PIC)
    val a = list.orEmpty().firstOrNull { it.actionId == actionId }
    var mode by rememberSaveable { mutableStateOf(if (initialMode == "EXTEND") "EXTEND" else "REASSIGN") }
    var dept by rememberSaveable { mutableStateOf<String?>(null) }
    var date by rememberSaveable { mutableStateOf(LocalDate.now().plusDays(7).toString()) }
    var reason by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val extreme = a?.riskLevel == "EXTREME"
    val extended = (a?.extensionCount ?: 0) >= (boot?.maxExtensions ?: 1)
    val extendBlocked = extreme || extended
    val myDept = boot?.me?.departemen ?: "Anda"
    Screen("Permintaan ke Delegator", "${a?.reportNo ?: ""} · ${a?.description?.take(40) ?: ""}", onBack = onBack, footer = {
        BigButton("Kirim ke delegator", {
            busy = true
            scope.launch {
                repo.enqueue(ItemType.PIC_REQUEST, "Tindak lanjut", "${if (mode == "EXTEND") "Perpanjangan" else "Pengalihan"} · ${a?.reportNo}",
                    mapOf("action_id" to actionId, "request_type" to mode, "reason" to reason.trim(),
                        "proposed_department_id" to if (mode == "REASSIGN") dept else null,
                        "proposed_due_date" to if (mode == "EXTEND") date else null), refId = actionId)
                busy = false
                onSent()
            }
        }, enabled = reason.isNotBlank() && !(mode == "EXTEND" && extendBlocked), loading = busy)
    }) {
        if (a != null) Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RiskPill(a.riskLevel)
                Text("  Batas ${fmtDate(a.dueDate)} · ${dueText(a.dueAt, a.dueDate).first}", style = Type.small, color = p.muted2)
            }
        }
        Label("Jenis permintaan", required = true)
        Segmented(listOf("REASSIGN" to "Bukan area saya", "EXTEND" to "Perpanjang batas"), mode, { mode = it },
            hints = mapOf("REASSIGN" to "minta dialihkan", "EXTEND" to "butuh waktu lebih"))
        if (mode == "REASSIGN") {
            Dropdown("Usulan departemen tujuan (opsional)", listOf<Pair<String?, String>>(null to "Tidak tahu — serahkan ke delegator") +
                boot?.departments.orEmpty().map { it.id to (it.name ?: "-") }, dept, { dept = it })
        } else {
            if (extreme) Notice("Hazard risiko Ekstrem tidak bisa diperpanjang.", Tone.DANGER)
            else if (extended) Notice("Batas waktu sudah pernah diperpanjang (maksimal 1 kali).", Tone.DANGER)
            else {
                DateField("Usulan batas baru", LocalDate.parse(date), { date = it.toString() }, max = null)
                Hint("Maksimal 1 kali perpanjangan per laporan. Risiko Ekstrem tidak bisa diperpanjang.")
            }
        }
        Label("Alasan", required = true)
        Field(reason, { reason = it }, minLines = 3, placeholder = if (mode == "EXTEND") "mis. Material tiba 18 Okt, rambu sementara sudah terpasang" else "mis. Perbaikan butuh alat & desain dari Engineering")
        Notice("Dikirim ke Delegator Dept. $myDept (diatur Admin HSE). Selama menunggu keputusan, Anda tetap PIC dan batas waktu tetap berjalan.")
    }
}
