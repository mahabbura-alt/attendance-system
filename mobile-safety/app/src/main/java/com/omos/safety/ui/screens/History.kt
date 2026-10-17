package com.omos.safety.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.omos.safety.data.CacheKey
import com.omos.safety.data.HazardDetail
import com.omos.safety.data.ItemType
import com.omos.safety.data.MyReports
import com.omos.safety.data.friendlyMessage
import com.omos.safety.data.db.OutboxEntity
import com.omos.safety.data.db.OutboxStatus
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.CapaProgressCard
import com.omos.safety.ui.Card
import com.omos.safety.ui.EmptyState
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.KeyValue
import com.omos.safety.ui.Label
import com.omos.safety.ui.Notice
import com.omos.safety.ui.Pill
import com.omos.safety.ui.RemotePhotos
import com.omos.safety.ui.RiskPill
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.actionStatusLabel
import com.omos.safety.ui.fmtDate
import com.omos.safety.ui.fmtDateTime
import com.omos.safety.ui.fmtMillis
import com.omos.safety.ui.hazardStatusLabel
import com.omos.safety.ui.p
import com.omos.safety.ui.parseInstant
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import com.omos.safety.ui.statusColors
import kotlinx.coroutines.launch

private data class Row2(val module: String, val no: String, val date: String, val title: String, val status: String, val statusKey: String?,
                        val sync: String, val syncTone: Int, val hazardId: String? = null, val sortKey: Long = 0)

@Composable
fun HistoryScreen(nav: (String) -> Unit) {
    val repo = rememberRepo()
    val reports by rememberCache<MyReports>(repo, CacheKey.REPORTS)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    val sync by repo.sync.collectAsState()
    var mod by rememberSaveable { mutableStateOf("Semua") }
    LaunchedEffect(Unit) { repo.refreshAll() }
    val pending = outbox.filter { it.status != OutboxStatus.SENT && it.type.endsWith("_CREATE") }
    val failed = outbox.count { it.status == OutboxStatus.FAILED }
    val r = reports
    val rows = buildList {
        pending.forEach {
            add(Row2(it.module, "BELUM DI SERVER", fmtMillis(it.createdAt), it.title, "Belum di server", null,
                if (it.status == OutboxStatus.FAILED) "✕ Gagal · tinjau" else if (it.status == OutboxStatus.SENDING) "↻ Mengirim…" else "⏳ Menunggu sinyal",
                if (it.status == OutboxStatus.FAILED) 2 else 1, sortKey = it.createdAt))
        }
        r?.hazards.orEmpty().forEach { add(Row2("Hazard", it.reportNo ?: "-", fmtDate(it.reportDate), it.description ?: "-", hazardStatusLabel(it.status), it.status, "✓ Terkirim", 0, it.id, parseInstant(it.createdAt)?.toEpochMilli() ?: 0)) }
        r?.incidents.orEmpty().forEach { add(Row2("Insiden", it.incidentNo ?: "-", fmtDateTime(it.occurredAt), it.description ?: "-", it.status ?: "-", null, "✓ Terkirim", 0, sortKey = parseInstant(it.occurredAt)?.toEpochMilli() ?: 0)) }
        r?.inspections.orEmpty().forEach {
            val pct = if ((it.answeredCount ?: 0) > 0) 100 * (it.okCount ?: 0) / (it.answeredCount ?: 1) else 100
            add(Row2("Inspeksi", it.inspectionNo ?: "-", fmtDateTime(it.inspectedAt), "${it.templateName} · ${it.locationName ?: ""}", "Skor $pct%", if (pct == 100) "CLOSED" else "OPEN", "✓ Terkirim", 0, sortKey = parseInstant(it.inspectedAt)?.toEpochMilli() ?: 0))
        }
        r?.p5m.orEmpty().forEach { add(Row2("P5M", it.eventNo ?: "-", fmtDate(it.eventDate), "P5M · ${it.topics.orEmpty().firstOrNull() ?: ""}", "Tercatat", "CLOSED", "✓ Terkirim", 0)) }
        r?.safetytalk.orEmpty().forEach { add(Row2("Safety Talk", it.eventNo ?: "-", fmtDate(it.eventDate), "Safety Talk · ${it.topics.orEmpty().firstOrNull() ?: ""}", "Tercatat", "CLOSED", "✓ Terkirim", 0)) }
        r?.meetings.orEmpty().forEach { add(Row2("Pertemuan K3", it.meetingNo ?: "-", fmtDate(it.meetingDate), it.title ?: "-", "Tercatat", "CLOSED", "✓ Terkirim", 0)) }
    }
    val mods = listOf("Semua", "Hazard", "Insiden", "Inspeksi", "P5M", "Safety Talk", "Pertemuan K3")
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Box(Modifier.weight(1f)) {
            Screen("Riwayat Laporan", if (sync.online) "Online" else "Offline · data terakhir di HP") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    mods.forEach { m ->
                        val on = m == mod
                        Box(
                            Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(if (on) p.ink else p.surface)
                                .border(1.5.dp, if (on) p.ink else p.borderStrong, RoundedCornerShape(20.dp)).clickable(role = Role.Tab) { mod = m }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(m, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (on) p.surface else p.ink) }
                    }
                }
                if (pending.isNotEmpty() || failed > 0) Card(bg = if (failed > 0) p.redBg else p.blueBg, border = if (failed > 0) p.red else p.blue, onClick = { nav(R.OUTBOX) }) {
                    Text(if (failed > 0) "$failed data gagal terkirim · perlu tindakan · Tinjau ›" else "Mengirim ${outbox.count { it.status != OutboxStatus.SENT }} data tertunda… · Lihat antrean ›",
                        style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (failed > 0) p.redDark else p.blue)
                }
                val shown = rows.filter { mod == "Semua" || it.module == mod || (mod == "Hazard" && it.module == "Tindak lanjut") }.sortedByDescending { it.sortKey }
                if (shown.isEmpty()) EmptyState(if (reports == null) "Riwayat belum terunduh. Sambungkan internet." else "Belum ada data untuk modul ini.")
                shown.take(150).forEach { row ->
                    Card(onClick = when {
                        row.hazardId != null -> ({ nav("${R.REPORT}/${row.hazardId}") })
                        row.syncTone > 0 -> ({ nav(R.OUTBOX) })
                        else -> null
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Pill(row.module, p.greenBg, p.green)
                            Text("${row.no} · ${row.date}", style = Type.tiny, color = p.muted, modifier = Modifier.weight(1f).padding(start = 8.dp))
                        }
                        Text(row.title, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink, maxLines = 2)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(row.sync, style = Type.small.copy(fontWeight = FontWeight.SemiBold),
                                color = when (row.syncTone) { 2 -> p.red; 1 -> p.amber; else -> p.green }, modifier = Modifier.weight(1f))
                            val (bg, fg) = statusColors(row.statusKey)
                            Pill(row.status, bg, fg)
                        }
                    }
                }
            }
        }
        BottomBar(R.HISTORY, nav)
    }
}

@Composable
fun ReportDetailScreen(hazardId: String, onBack: () -> Unit, onCorrect: () -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val cached by rememberCache<HazardDetail>(repo, CacheKey.hazard(hazardId))
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    var error by remember { mutableStateOf<String?>(null) }
    var cancelOpen by remember { mutableStateOf(false) }
    var noteOpen by remember { mutableStateOf(false) }
    LaunchedEffect(hazardId) { repo.refreshHazard(hazardId).onFailure { error = it.friendlyMessage() } }
    val d = cached
    val h = d?.hazard
    val localPending: List<OutboxEntity> = outbox.filter { it.refId == hazardId && it.status != OutboxStatus.SENT }
    val cancelQueued = localPending.any { it.type == ItemType.HAZARD_CANCEL }
    Screen("Laporan Saya", "${h?.reportNo ?: ""} · Hazard${if ((h?.revisionNo ?: 0) > 0) " · Revisi ${h?.revisionNo}" else ""}", onBack = onBack) {
        if (d == null) { if (error != null) Notice(error!!, Tone.WARN) else Hint("Memuat…"); return@Screen }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val (bg, fg) = statusColors(h?.status)
            Pill(if (cancelQueued) "Dibatalkan (menunggu kirim)" else hazardStatusLabel(h?.status), bg, fg)
            RiskPill(h?.riskLevel)
            if (h?.stopWork == true) Pill("STOP WORK", p.redBg, p.redDark)
        }
        Card {
            Text(h?.description ?: "-", style = Type.title, color = p.ink)
            Text("${h?.categoryName ?: ""} · ${h?.locationName ?: ""} · ${fmtDate(h?.reportDate)} ${h?.reportTime?.take(5) ?: ""}", style = Type.small, color = p.muted)
            if (!h?.potentialConsequence.isNullOrBlank()) KeyValue("Konsekuensi / dampak", h?.potentialConsequence)
            if (!h?.recommendation.isNullOrBlank()) KeyValue("Rekomendasi perbaikan", h?.recommendation)
            if (!h?.immediateAction.isNullOrBlank()) KeyValue("Tindakan segera", h?.immediateAction)
            if (!h?.cancelReason.isNullOrBlank()) KeyValue("Alasan pembatalan", h?.cancelReason)
            RemotePhotos(h?.photos)
        }
        if (localPending.isNotEmpty()) Notice("${localPending.size} perubahan belum terkirim (${localPending.joinToString { com.omos.safety.ui.moduleOf(it.type) }}).", Tone.WARN)
        val perm = d.permissions
        if (perm?.canCorrect == true && !cancelQueued) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("Koreksi laporan", {
                    Drafts.update(ctx, HazardDraft(
                        mode = "correct", hazardId = h?.id, reportNo = h?.reportNo,
                        category = if (h?.categoryName?.contains("Tindakan") == true) "UNSAFE_ACT" else "UNSAFE_CONDITION",
                        locationId = h?.locationId, date = h?.reportDate?.take(10) ?: Drafts.hazard.date, time = h?.reportTime?.take(5) ?: Drafts.hazard.time,
                        description = h?.description ?: "", potentialConsequence = h?.potentialConsequence ?: "",
                        recommendation = h?.recommendation ?: "",
                        immediateAction = h?.immediateAction ?: "", stopWork = h?.stopWork == true,
                        likelihood = h?.likelihood ?: 3, consequence = h?.consequence ?: 3,
                    ).let { dr ->
                        dr.copy(original = mapOf(
                            "category" to dr.category, "location_id" to dr.locationId, "description" to dr.description,
                            "potential_consequence" to dr.potentialConsequence, "recommendation" to dr.recommendation,
                            "immediate_action" to dr.immediateAction, "stop_work" to dr.stopWork.toString(),
                            "occurred_at" to com.omos.safety.ui.isoAt(java.time.LocalDate.parse(dr.date), java.time.LocalTime.parse(dr.time)),
                            "likelihood" to dr.likelihood.toString(), "consequence" to dr.consequence.toString(),
                        ))
                    })
                    onCorrect()
                }, Modifier.weight(1f), color = p.green, border = p.green)
                GhostButton("Batalkan", { cancelOpen = true }, Modifier.weight(1f), color = p.red, border = p.red)
            }
            Notice("Koreksi dan pembatalan hanya bisa sebelum HSE melakukan triase atau PIC mulai tindak lanjut. Setiap koreksi tersimpan sebagai revisi baru; isi sebelumnya tidak hilang.")
        } else if (h?.status != "CANCELLED") {
            Hint("Laporan sudah diproses: koreksi & batal tidak tersedia. Tambahan informasi dikirim lewat catatan ke HSE.")
            GhostButton("Tambah catatan ke HSE", { noteOpen = true }, Modifier.fillMaxWidth())
        }
        if (d.actions.orEmpty().isNotEmpty()) {
            Label("Tindak lanjut PIC")
            d.capaProgress?.let { CapaProgressCard(it.closed ?: 0, it.total ?: 0, it.waitingVerify ?: 0, it.inProgress ?: 0) }
            d.actions.orEmpty().forEach { a ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(a.picName ?: "-", style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink, modifier = Modifier.weight(1f))
                        val rejected = a.rejectedReason != null && a.status == "IN_PROGRESS"
                        val (bg, fg) = statusColors(a.status, rejected)
                        Pill(actionStatusLabel(a.status, rejected), bg, fg)
                    }
                    Text("Batas ${fmtDate(a.dueDate)}${if ((a.extensionCount ?: 0) > 0) " (diperpanjang)" else ""}", style = Type.tiny, color = p.muted)
                    if (!a.evidenceNote.isNullOrBlank()) Text(a.evidenceNote, style = Type.small, color = p.ink)
                    RemotePhotos(a.evidenceUrl)
                }
            }
        }
        Label("Riwayat perubahan")
        Card {
            d.events.orEmpty().forEach { e ->
                Column(Modifier.padding(vertical = 4.dp)) {
                    Text(eventLabel(e.eventType) + (e.note?.let { " · $it" } ?: ""), style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.ink)
                    Text("${e.actorName ?: "-"} · ${fmtDateTime(e.createdAt)}", style = Type.tiny, color = p.muted)
                }
            }
            if (d.events.isNullOrEmpty()) Hint("Belum ada riwayat.")
        }
    }
    if (cancelOpen) CancelDialog(onClose = { cancelOpen = false }) { reason ->
        scope.launch {
            repo.enqueue(ItemType.HAZARD_CANCEL, "Hazard", "Batal · ${h?.reportNo}", mapOf("hazard_id" to hazardId, "reason" to reason), refId = hazardId)
            cancelOpen = false
        }
    }
    if (noteOpen) NoteDialog(onClose = { noteOpen = false }) { note, photos ->
        scope.launch {
            repo.enqueue(ItemType.HAZARD_NOTE, "Hazard", "Catatan · ${h?.reportNo}", mapOf("hazard_id" to hazardId, "note" to note, "photos" to photos), refId = hazardId)
            noteOpen = false
        }
    }
}

private fun eventLabel(t: String?) = when (t) {
    "REPORTED" -> "Dilaporkan"; "ASSIGNED" -> "Ditugaskan"; "CORRECTED" -> "Dikoreksi"; "CANCELLED" -> "Dibatalkan"
    "STARTED" -> "In Progress"; "EVIDENCE_SUBMITTED" -> "Bukti dikirim"; "VERIFIED" -> "Closed · disetujui"; "REJECTED" -> "Bukti ditolak"
    "EXTEND_REQUESTED" -> "Minta perpanjangan"; "REASSIGN_REQUESTED" -> "Minta pengalihan"; "EXTENDED" -> "Batas diperpanjang"
    "REASSIGNED" -> "PIC dialihkan"; "REQUEST_REJECTED" -> "Permintaan ditolak"; "REQUEST_APPROVED" -> "Permintaan disetujui"
    "REQUEST_FORWARDED" -> "Diteruskan ke departemen lain"; "DELEGATOR_REASSIGNED" -> "Dialihkan delegator"; "NOTE" -> "Catatan"
    "ESCALATED" -> "Lewat batas · dieskalasi"
    else -> t ?: "-"
}

@Composable
private fun CancelDialog(onClose: () -> Unit, onConfirm: (String) -> Unit) {
    val reasons = listOf("Salah input data", "Sudah dilaporkan orang lain (duplikat)", "Sudah diperbaiki di tempat", "Bukan bahaya setelah dicek ulang")
    var picked by remember { mutableStateOf<String?>(null) }
    DialogShell("Batalkan laporan?", onClose) {
        Label("Alasan", required = true)
        reasons.forEach { r ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(if (picked == r) 2.dp else 1.5.dp, if (picked == r) p.red else p.border, RoundedCornerShape(12.dp))
                    .clickable(role = Role.RadioButton) { picked = r }.padding(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) { RadioButton(picked == r, { picked = r }, colors = RadioButtonDefaults.colors(selectedColor = p.red)); Text(r, style = Type.body, color = p.ink) }
        }
        Hint("Laporan tetap tercatat untuk audit, tetapi tidak dihitung di statistik dan tidak dikirim ke PIC.")
        BigButton("Batalkan laporan", { onConfirm(picked!!) }, container = p.red, enabled = picked != null)
    }
}

@Composable
private fun NoteDialog(onClose: () -> Unit, onSend: (String, List<String>) -> Unit) {
    var note by remember { mutableStateOf("") }
    var photos by remember { mutableStateOf(listOf<String>()) }
    DialogShell("Catatan ke HSE", onClose) {
        Field(note, { note = it }, minLines = 3, placeholder = "Tambahan informasi untuk HSE / PIC")
        com.omos.safety.ui.PhotoSlots(photos, { photos = it }, max = 3, minRequired = 0, label = "Foto (opsional)")
        BigButton("Kirim catatan", { onSend(note.trim(), photos) }, enabled = note.isNotBlank())
    }
}
