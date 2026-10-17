package com.omos.safety.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
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
import com.omos.safety.data.CacheKey
import com.omos.safety.data.ItemType
import com.omos.safety.data.MyReports
import com.omos.safety.data.Schedule
import com.omos.safety.data.Schedules
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Card
import com.omos.safety.ui.CheckRow
import com.omos.safety.ui.Dropdown
import com.omos.safety.ui.EmptyState
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.Label
import com.omos.safety.ui.LocationPicker
import com.omos.safety.ui.Notice
import com.omos.safety.ui.PersonPickerDialog
import com.omos.safety.ui.PhotoSlots
import com.omos.safety.ui.Pill
import com.omos.safety.ui.Screen
import com.omos.safety.ui.TabChips
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.fmtDate
import com.omos.safety.ui.fmtDateTime
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch

private fun cycleLabel(c: String?) = when (c) { "DAILY" -> "Harian"; "WEEKLY" -> "Mingguan"; "MONTHLY" -> "Bulanan"; "CUSTOM_DAYS" -> "Berkala"; else -> "Terjadwal" }

@Composable
fun InspectionStartScreen(onBack: () -> Unit, onSchedules: () -> Unit, onStart: (templateId: String, locationId: String, scheduleId: String?) -> Unit) {
    val repo = rememberRepo()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    val schedules by rememberCache<Schedules>(repo, CacheKey.SCHEDULES)
    val reports by rememberCache<MyReports>(repo, CacheKey.REPORTS)
    val templates = boot?.inspectionTemplates.orEmpty()
    var tpl by rememberSaveable { mutableStateOf<String?>(null) }
    var loc by rememberSaveable { mutableStateOf<String?>(null) }
    val list = schedules?.schedules.orEmpty()
    val today = list.count { it.dueStatus == "TODAY" }
    val late = list.count { it.dueStatus == "OVERDUE" }
    Screen("Inspeksi", boot?.shift?.current?.let { "${it.name} · Tgl operasional ${fmtDate(it.operationalDate)}" }, onBack = onBack) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.greenSoft).border(1.5.dp, p.green, RoundedCornerShape(14.dp))
                .clickable(role = Role.Button, onClick = onSchedules).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(p.green), contentAlignment = Alignment.Center) { Icon(Icons.Filled.CalendarMonth, null, tint = Color.White) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Jadwal saya: $today hari ini", style = Type.title, color = p.ink)
                Text(if (late > 0) "$late terlewat · kerjakan dulu" else "${list.size} jadwal aktif", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (late > 0) p.redDark else p.muted)
            }
            Icon(Icons.Filled.ChevronRight, null, tint = p.green)
        }
        Text("Inspeksi tidak terjadwal", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2)
        if (templates.isEmpty()) Notice("Belum ada templat inspeksi di HP. Sambungkan internet agar Setup Master Inspeksi terunduh.", Tone.WARN)
        Dropdown("1. Jenis inspeksi", templates.map { it.id to (it.name ?: "-") }, tpl, { tpl = it })
        templates.firstOrNull { it.id == tpl }?.let { Hint("${it.items.orEmpty().size} item checklist · dari Setup Master Inspeksi") }
        LocationPicker(boot?.areas.orEmpty(), loc, { loc = it }, label = "2. Lokasi")
        BigButton("Mulai checklist", { onStart(tpl!!, loc!!, null) }, enabled = tpl != null && loc != null)
        val recent = reports?.inspections.orEmpty().take(3)
        if (recent.isNotEmpty()) {
            Text("Inspeksi terakhir saya", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2)
            recent.forEach { r ->
                val pct = if ((r.answeredCount ?: 0) > 0) 100 * (r.okCount ?: 0) / (r.answeredCount ?: 1) else 100
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${r.templateName} · ${r.locationName ?: ""}", style = Type.title, color = p.ink)
                            Text("${fmtDateTime(r.inspectedAt)} · ${r.findingsCount ?: 0} temuan", style = Type.tiny, color = p.muted)
                        }
                        Pill("$pct%", if (pct == 100) p.greenBg else Color(0xFFFDEFC3), if (pct == 100) p.green else Color(0xFF6B4E00))
                    }
                }
            }
        }
    }
}

@Composable
fun SchedulesScreen(onBack: () -> Unit, onStart: (Schedule) -> Unit) {
    val repo = rememberRepo()
    val data by rememberCache<Schedules>(repo, CacheKey.SCHEDULES)
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var tab by rememberSaveable { mutableStateOf("today") }
    LaunchedEffect(Unit) { repo.refreshAll() }
    val all = data?.schedules.orEmpty()
    val groups = mapOf(
        "today" to all.filter { it.dueStatus == "TODAY" },
        "week" to all.filter { it.dueStatus == "WEEK" || it.dueStatus == "LATER" },
        "late" to all.filter { it.dueStatus == "OVERDUE" },
    )
    Screen("Jadwal Inspeksi Saya", "${boot?.me?.jabatan ?: ""} · Tgl operasional ${fmtDate(data?.operationalDate)}", onBack = onBack) {
        TabChips(listOf("today" to "Hari ini (${groups["today"]!!.size})", "week" to "Mendatang (${groups["week"]!!.size})", "late" to "Terlewat (${groups["late"]!!.size})"), tab, { tab = it })
        val list = groups[tab].orEmpty()
        if (list.isEmpty()) EmptyState(if (data == null) "Jadwal belum terunduh. Sambungkan internet." else "Tidak ada jadwal di sini.")
        list.forEach { s ->
            val late = s.dueStatus == "OVERDUE"
            Card(border = if (late) p.red else p.border) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(cycleLabel(s.scheduleCycle).uppercase(), style = Type.tiny.copy(fontWeight = FontWeight.Bold), color = p.muted2, modifier = Modifier.weight(1f))
                    if (late) Pill("Terlewat", p.redBg, p.redDark) else Pill("Belum", Color(0xFFFDEFC3), Color(0xFF6B4E00))
                }
                Text(s.templateName ?: "-", style = Type.title, color = p.ink)
                Text(s.locationName ?: s.assetId?.let { "Unit $it" } ?: "-", style = Type.body, color = p.muted2)
                Text(if (s.assigneeType == "POSITION") "Ditugaskan ke jabatan Anda · ${s.assigneePositionName ?: ""}" else "Ditugaskan ke Anda", style = Type.small, color = p.muted)
                Text(if (late) "Jatuh tempo ${fmtDate(s.nextDueDate)} · terlewat, tercatat di statistik" else "Jatuh tempo ${fmtDate(s.nextDueDate)}",
                    style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (late) p.red else p.muted2)
                if (s.templateId != null) BigButton(if (late) "Kerjakan sekarang" else "Mulai inspeksi", { onStart(s) }, height = 52.dp)
            }
        }
        Notice("Jadwal dibuat Admin HSE di Setup Jadwal Inspeksi, ditugaskan ke Anda langsung atau ke jabatan Anda. Tersimpan offline. Setelah selesai, jadwal berikutnya dihitung otomatis.")
    }
}

private class Answer {
    var answer by mutableStateOf<String?>(null)
    var note by mutableStateOf("")
    var photos by mutableStateOf(listOf<String>())
    var makeHazard by mutableStateOf(false)
    var picIds by mutableStateOf(setOf<String>())
}

private class CustomItem { var question by mutableStateOf(""); val a = Answer() }

@Composable
fun ChecklistScreen(templateId: String, locationId: String, scheduleId: String?, onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    val tpl = boot?.inspectionTemplates.orEmpty().firstOrNull { it.id == templateId }
    val items = tpl?.items.orEmpty().sortedBy { it.sortOrder ?: 0 }
    val answers = remember(items) { items.associate { (it.id ?: "") to Answer() } }
    val custom = remember { mutableStateListOf<CustomItem>() }
    var team by remember { mutableStateOf(setOf<String>()) }
    var photos by remember { mutableStateOf(listOf<String>()) }
    var objectId by rememberSaveable { mutableStateOf("") }
    var picFor by remember { mutableStateOf<Answer?>(null) }
    var teamOpen by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }

    val all = items.map { answers[it.id ?: ""]!! } + custom.map { it.a }
    val answered = all.count { it.answer != null }
    val problems = buildList {
        if (answered < all.size) add("${all.size - answered} butir belum dijawab")
        if (all.any { it.answer == "NO" && (it.note.isBlank() || it.photos.isEmpty()) }) add("butir Tidak OK wajib catatan + foto")
        if (all.any { it.answer == "NO" && it.makeHazard && it.picIds.isEmpty() }) add("PIC untuk temuan hazard")
        if (custom.any { it.question.isBlank() }) add("pertanyaan item tambahan")
        if (photos.isEmpty()) add("foto inspeksi")
    }

    Screen("Inspeksi ${tpl?.name ?: ""}", "${com.omos.safety.ui.locationName(boot?.areas, locationId)} · ${boot?.shift?.current?.name ?: ""}", onBack = onBack, footer = {
        Text("$answered dari ${all.size} butir terjawab", style = Type.small, color = p.muted2)
        if (tried && problems.isNotEmpty()) Hint("Lengkapi: ${problems.joinToString()}", p.red)
        BigButton("Selesai & kirim", {
            tried = true
            if (problems.isNotEmpty()) return@BigButton
            saving = true
            scope.launch {
                fun pack(question: String, itemId: String?, critical: Boolean, a: Answer) = mapOf(
                    "item_id" to itemId, "question" to question, "is_critical" to critical, "answer" to a.answer,
                    "note" to a.note.ifBlank { null }, "photo" to a.photos.firstOrNull(),
                    "make_hazard" to (a.answer == "NO" && a.makeHazard), "hazard_pic_ids" to a.picIds.toList(),
                )
                val payload = mapOf(
                    "template_id" to templateId, "location_id" to locationId, "schedule_id" to scheduleId,
                    "object_identifier" to objectId.ifBlank { null }, "photos" to photos, "participant_ids" to team.toList(),
                    "answers" to items.map { pack(it.question ?: "", it.id, it.isCritical == true, answers[it.id ?: ""]!!) },
                    "custom_items" to custom.map { pack(it.question, null, false, it.a) },
                )
                val urgent = all.any { it.answer == "NO" && it.makeHazard } && items.any { it.isCritical == true && answers[it.id ?: ""]?.answer == "NO" }
                val uuid = repo.enqueue(ItemType.INSPECTION_CREATE, "Inspeksi", "${tpl?.name} · ${com.omos.safety.ui.locationName(boot?.areas, locationId)}", payload, urgent = urgent)
                saving = false
                onSaved(uuid)
            }
        }, loading = saving)
    }) {
        if (tpl == null) Notice("Templat tidak ditemukan di HP. Sambungkan internet.", Tone.WARN)
        Hint("Pertanyaan tampil otomatis sesuai jenis inspeksi, dari Setup Master Inspeksi.")
        Field(objectId, { objectId = it }, label = "Objek / nomor unit (opsional)", placeholder = "mis. DT-045 atau KM 0–2")
        items.forEachIndexed { i, it ->
            AnswerCard("${i + 1}. ${it.question}", it.isCritical == true, answers[it.id ?: ""]!!, onPickPic = { a -> picFor = a })
        }
        custom.forEachIndexed { i, c ->
            Card(border = p.borderStrong) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Item tambahan ${i + 1}", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f))
                    Text("Hapus", style = Type.small, color = p.red, modifier = Modifier.clickable { custom.remove(c) }.padding(6.dp))
                }
                Field(c.question, { c.question = it }, placeholder = "Tulis pertanyaan / butir yang diperiksa")
                AnswerBody(c.a, onPickPic = { a -> picFor = a })
            }
        }
        GhostButton("+ Insert kolom (item manual)", { custom.add(CustomItem()) }, Modifier.fillMaxWidth(), color = p.green, border = p.green)
        Label("Peserta inspeksi")
        val teamNames = boot?.employees.orEmpty().filter { it.id in team }.map { it.nama ?: "-" }
        GhostButton(if (teamNames.isEmpty()) "Pilih anggota tim (opsional)" else "${teamNames.size} peserta · ${teamNames.joinToString()}", { teamOpen = true }, Modifier.fillMaxWidth())
        PhotoSlots(photos, { photos = it }, max = 3, minRequired = 1, label = "Foto inspeksi")
    }
    picFor?.let { a ->
        PersonPickerDialog("PIC tindak lanjut", boot?.employees.orEmpty(), a.picIds, { a.picIds = it; picFor = null }, { picFor = null })
    }
    if (teamOpen) PersonPickerDialog("Peserta inspeksi", boot?.employees.orEmpty(), team, { team = it; teamOpen = false }, { teamOpen = false })
}

@Composable
private fun AnswerCard(question: String, critical: Boolean, a: Answer, onPickPic: (Answer) -> Unit) {
    Card(border = if (a.answer == "NO") p.amber else p.border) {
        Row {
            Text(question, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink, modifier = Modifier.weight(1f))
            if (critical) Pill("Kritis", p.redBg, p.redDark)
        }
        AnswerBody(a, onPickPic)
    }
}

@Composable
private fun AnswerBody(a: Answer, onPickPic: (Answer) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("YES" to "OK", "NO" to "Tidak OK", "NA" to "N/A").forEach { (v, l) ->
            val on = a.answer == v
            val bg = when { !on -> p.surface; v == "YES" -> p.green; v == "NO" -> p.red; else -> p.muted2 }
            Box(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).background(bg)
                    .border(if (on) 2.dp else 1.5.dp, if (on) bg else p.borderStrong, RoundedCornerShape(10.dp))
                    .clickable(role = Role.RadioButton) { a.answer = v },
                contentAlignment = Alignment.Center,
            ) { Text(l, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = if (on) Color.White else p.ink) }
        }
    }
    if (a.answer == "NO") {
        Field(a.note, { a.note = it }, label = "Catatan temuan *", minLines = 2)
        PhotoSlots(a.photos, { a.photos = it }, max = 1, minRequired = 1, label = "Foto temuan")
        CheckRow(a.makeHazard, { a.makeHazard = it }, "Jadikan temuan hazard & kirim ke PIC", "Hazard dibuat otomatis dari temuan ini dengan foto & catatan di atas.")
        if (a.makeHazard) GhostButton(if (a.picIds.isEmpty()) "Pilih PIC tindak lanjut *" else "${a.picIds.size} PIC dipilih", { onPickPic(a) }, Modifier.fillMaxWidth(), border = p.green)
    }
}
