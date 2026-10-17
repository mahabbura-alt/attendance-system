package com.omos.safety.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.omos.safety.data.ActionRow
import com.omos.safety.data.CacheKey
import com.omos.safety.data.DelegatorInbox
import com.omos.safety.data.ItemType
import com.omos.safety.data.db.OutboxStatus
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Card
import com.omos.safety.ui.DateField
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
import com.omos.safety.ui.TabChips
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.dueText
import com.omos.safety.ui.fmtDate
import com.omos.safety.ui.fmtDateTime
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.LocalDate

// ------------------------------------------------------------------ Verifikasi (pelapor / HSE)

@Composable
fun VerifyScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    val list by rememberCache<List<ActionRow>>(repo, CacheKey.VERIFY)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    var selected by remember { mutableStateOf<ActionRow?>(null) }
    LaunchedEffect(Unit) { repo.refreshAll() }
    val decided = outbox.filter { it.type == ItemType.VERIFY_DECISION && it.status != OutboxStatus.SENT }.mapNotNull { it.refId }.toSet()
    val rows = list.orEmpty().filter { it.actionId !in decided }
    Screen("Verifikasi Tindak Lanjut", "Anda sebagai pelapor / HSE", onBack = onBack) {
        if (rows.isEmpty()) EmptyState(if (list == null) "Data belum terunduh. Sambungkan internet." else "Tidak ada bukti yang menunggu verifikasi.")
        rows.forEach { a ->
            Card(onClick = { selected = a }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(a.reportNo ?: "-", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f))
                    RiskPill(a.riskLevel)
                }
                Text(a.description ?: "-", style = Type.title, color = p.ink, maxLines = 2)
                Text("Bukti dari ${a.picName ?: "-"} · ${fmtDateTime(a.completedAt)}", style = Type.small, color = p.muted)
                Pill("Menunggu verifikasi", p.purpleBg, p.purple)
            }
        }
    }
    selected?.let { a -> VerifyDialog(a) { selected = null } }
}

@Composable
private fun VerifyDialog(a: ActionRow, onClose: () -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var rejecting by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    fun send(decision: String) {
        busy = true
        scope.launch {
            repo.enqueue(ItemType.VERIFY_DECISION, "Verifikasi", "${if (decision == "APPROVE") "Setujui" else "Tolak"} · ${a.reportNo}",
                mapOf("action_id" to a.actionId, "decision" to decision, "reason" to reason.trim().ifBlank { null }), refId = a.actionId)
            busy = false
            onClose()
        }
    }
    DialogShell("Verifikasi · ${a.reportNo}", onClose) {
        Text(a.description ?: "-", style = Type.title, color = p.ink)
        Text("${a.locationName ?: ""} · ${fmtDate(a.reportDate)}", style = Type.small, color = p.muted)
        RemotePhotos(a.photos, "Foto temuan (sebelum)")
        Card(bg = p.bg) {
            KeyValue("Bukti perbaikan dari PIC", "${a.picName ?: "-"} · ${fmtDateTime(a.completedAt)}")
            if (!a.evidenceNote.isNullOrBlank()) Text(a.evidenceNote, style = Type.body, color = p.ink)
        }
        RemotePhotos(a.evidenceUrl, "Foto sesudah")
        if (!rejecting) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("Tolak", { rejecting = true }, Modifier.weight(1f), color = p.red, border = p.red)
                BigButton("Setujui & close", { send("APPROVE") }, Modifier.weight(2f), loading = busy)
            }
        } else {
            Label("Alasan penolakan", required = true)
            Field(reason, { reason = it }, minLines = 2, placeholder = "mis. Foto belum jelas, lampirkan daftar hadir P5M")
            Hint("Jika ditolak, laporan kembali ke PIC (In Progress) dan PIC mendapat notifikasi.")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("Batal", { rejecting = false }, Modifier.weight(1f))
                BigButton("Kirim penolakan", { send("REJECT") }, Modifier.weight(2f), container = p.red, enabled = reason.isNotBlank(), loading = busy)
            }
        }
    }
}

// ------------------------------------------------------------------ Delegator departemen

@Composable
fun DelegatorScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    val inbox by rememberCache<DelegatorInbox>(repo, CacheKey.DELEGATOR)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    var tab by rememberSaveable { mutableStateOf("req") }
    var selected by remember { mutableStateOf<ActionRow?>(null) }
    LaunchedEffect(Unit) { repo.refreshAll() }
    val handled = outbox.filter { (it.type == ItemType.DELEGATOR_DECISION || it.type == ItemType.DELEGATOR_REASSIGN) && it.status != OutboxStatus.SENT }
        .mapNotNull { it.refId }.toSet()
    val requests = inbox?.requests.orEmpty().filter { it.requestId !in handled }
    val stalled = inbox?.stalled.orEmpty().filter { it.actionId !in handled }
    val depts = inbox?.departments.orEmpty().joinToString { it.departmentName ?: "-" }
    Screen("Delegasi PIC", "Anda Delegator Dept. $depts · diatur Admin HSE", onBack = onBack) {
        TabChips(listOf("req" to "Permintaan PIC (${requests.size})", "stall" to "Macet / lewat batas (${stalled.size})"), tab, { tab = it })
        Hint(if (tab == "req") "Permintaan pengalihan atau perpanjangan dari PIC di departemen Anda." else "Hazard departemen Anda yang lewat batas atau tidak bergerak. Anda bisa langsung mengalihkan PIC.")
        val rows = if (tab == "req") requests else stalled
        if (rows.isEmpty()) EmptyState(if (inbox == null) "Data belum terunduh. Sambungkan internet." else "Tidak ada yang perlu diputuskan.")
        rows.forEach { a ->
            val (due, overdue) = dueText(a.dueAt, a.dueDate)
            Card(onClick = { selected = a }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val (label, bg, fg) = when {
                        tab == "stall" -> Triple("Belum ditindaklanjuti", p.redBg, p.redDark)
                        a.requestType == "EXTEND" -> Triple("Minta perpanjangan", p.blueBg, p.blue)
                        else -> Triple("Minta dialihkan", p.purpleBg, p.purple)
                    }
                    Pill(label, bg, fg)
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) { RiskPill(a.riskLevel) }
                }
                Text(a.description ?: "-", style = Type.title, color = p.ink, maxLines = 2)
                Text("${a.reportNo} · PIC ${a.picName ?: "-"}", style = Type.small, color = p.muted)
                if (tab == "req") Text(
                    if (a.requestType == "EXTEND") "Usul batas baru ${fmtDate(a.proposedDueDate)}" else "Usul ke ${a.proposedDepartmentName ?: "— (serahkan ke delegator)"}",
                    style = Type.small, color = p.muted2,
                )
                Text((if (overdue) "⚠ " else "") + due, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (overdue) p.red else p.muted2)
            }
        }
    }
    selected?.let { a -> DelegatorDialog(a, inbox, stalled = tab == "stall") { selected = null } }
}

@Composable
private fun DelegatorDialog(a: ActionRow, inbox: DelegatorInbox?, stalled: Boolean, onClose: () -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val isExtend = !stalled && a.requestType == "EXTEND"
    val deptId = a.departmentId ?: inbox?.departments?.firstOrNull()?.departmentId
    val candidates = inbox?.candidates?.get(deptId).orEmpty().filter { it.id != a.picEmployeeId }
    val forward = inbox?.forwardDepartments.orEmpty()
    // target: "u:<userId>" atau "d:<departmentId>" (teruskan ke departemen lain)
    var target by remember { mutableStateOf<String?>(null) }
    var date by remember { mutableStateOf(a.proposedDueDate?.take(10) ?: LocalDate.now().plusDays(7).toString()) }
    var note by remember { mutableStateOf("") }
    var rejecting by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    fun submit(payload: Map<String, Any?>, type: String, title: String) {
        busy = true
        scope.launch {
            repo.enqueue(type, "Delegasi", title, payload, refId = if (type == ItemType.DELEGATOR_REASSIGN) a.actionId else a.requestId)
            busy = false
            onClose()
        }
    }
    DialogShell("${a.reportNo} · ${if (stalled) "Macet" else if (isExtend) "Perpanjangan" else "Pengalihan"}", onClose) {
        Text(a.description ?: "-", style = Type.title, color = p.ink)
        Card(bg = p.bg) {
            KeyValue(if (stalled) "Catatan sistem" else "Alasan PIC (${a.requesterName ?: a.picName ?: "-"})",
                if (stalled) (a.rejectedReason?.let { "Ditolak verifikasi: $it" } ?: "Lewat batas tanpa penyelesaian.") else a.reason)
        }
        if (isExtend) {
            if (a.riskLevel == "EXTREME") Notice("Hazard risiko Ekstrem tidak bisa diperpanjang — tolak dan minta tindakan segera.", Tone.DANGER)
            else DateField("Batas baru", LocalDate.parse(date), { date = it.toString() }, max = null)
        } else {
            Label("Alihkan ke")
            candidates.forEach { c -> TargetRow("u:${c.id}", target, c.nama ?: "-", "${c.jabatan ?: "-"} · ${c.activeCount ?: 0} hazard aktif") { target = it } }
            if (!stalled) forward.forEach { d -> TargetRow("d:${d.id}", target, "Dept. ${d.name}", "diteruskan ke delegator ${d.name}") { target = it } }
            if (candidates.isEmpty()) Hint("Belum ada karyawan lain di departemen ini.")
            Hint("Batas waktu ikut pindah ke PIC baru. Lintas departemen: diteruskan ke delegator departemen tujuan.")
        }
        if (rejecting) {
            Field(note, { note = it }, label = "Alasan penolakan *", minLines = 2)
        } else Field(note, { note = it }, label = "Catatan (opsional)")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!stalled) GhostButton(if (rejecting) "Batal" else "Tolak", { rejecting = !rejecting }, Modifier.weight(1f), color = p.red, border = p.red)
            when {
                rejecting -> BigButton("Kirim penolakan", {
                    submit(mapOf("request_id" to a.requestId, "decision" to "REJECT", "note" to note.trim()), ItemType.DELEGATOR_DECISION, "Tolak · ${a.reportNo}")
                }, Modifier.weight(2f), container = p.red, enabled = note.isNotBlank(), loading = busy)
                stalled -> BigButton("Alihkan", {
                    submit(mapOf("action_id" to a.actionId, "new_pic_id" to target!!.removePrefix("u:"), "note" to note.trim().ifBlank { null }),
                        ItemType.DELEGATOR_REASSIGN, "Alihkan · ${a.reportNo}")
                }, Modifier.weight(2f), enabled = target?.startsWith("u:") == true, loading = busy)
                isExtend -> BigButton("Setujui", {
                    submit(mapOf("request_id" to a.requestId, "decision" to "APPROVE", "approved_due_date" to date, "note" to note.trim().ifBlank { null }),
                        ItemType.DELEGATOR_DECISION, "Perpanjang · ${a.reportNo}")
                }, Modifier.weight(2f), enabled = a.riskLevel != "EXTREME", loading = busy)
                else -> BigButton(if (target?.startsWith("d:") == true) "Teruskan" else "Alihkan", {
                    val t = target!!
                    val payload = if (t.startsWith("d:")) mapOf("request_id" to a.requestId, "decision" to "FORWARD", "forward_department_id" to t.removePrefix("d:"), "note" to note.trim().ifBlank { null })
                    else mapOf("request_id" to a.requestId, "decision" to "APPROVE", "new_pic_id" to t.removePrefix("u:"), "note" to note.trim().ifBlank { null })
                    submit(payload, ItemType.DELEGATOR_DECISION, "Alihkan · ${a.reportNo}")
                }, Modifier.weight(2f), enabled = target != null, loading = busy)
            }
        }
        Hint("Setiap keputusan tercatat di riwayat hazard dan dikirim ke PIC, pelapor, dan HSE.")
    }
}

@Composable
private fun TargetRow(value: String, selected: String?, title: String, sub: String, onSelect: (String) -> Unit) {
    val on = value == selected
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) p.greenSoft else p.surface)
            .border(if (on) 2.dp else 1.5.dp, if (on) p.green else p.border, RoundedCornerShape(12.dp))
            .clickable(role = Role.RadioButton) { onSelect(value) }.padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(on, { onSelect(value) }, colors = RadioButtonDefaults.colors(selectedColor = p.green))
        Column { Text(title, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink); Text(sub, style = Type.tiny, color = p.muted) }
    }
}

@Composable
fun DialogShell(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.95f).heightIn(max = 720.dp), shape = RoundedCornerShape(20.dp), color = p.surface) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f))
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Tutup", tint = p.ink) }
                }
                content()
            }
        }
    }
}

@Suppress("unused") private val keep = Color.Unspecified
