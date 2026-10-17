package com.omos.safety.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omos.safety.data.CacheKey
import com.omos.safety.data.Employee
import com.omos.safety.data.ItemType
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.CheckRow
import com.omos.safety.ui.DateField
import com.omos.safety.ui.Dropdown
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.Label
import com.omos.safety.ui.LocationPicker
import com.omos.safety.ui.Notice
import com.omos.safety.ui.PersonPickerDialog
import com.omos.safety.ui.PhotoSlots
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Segmented
import com.omos.safety.ui.TimeField
import com.omos.safety.ui.Tone
import com.omos.safety.ui.nowWibDate
import com.omos.safety.ui.nowWibTime
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime

/** P5M & Safety Talk / General: peserta = karyawan berstatus WAJIB (Setup Master), sesuai aturan server. */
@Composable
fun EventFormScreen(kind: String, onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    val participants by rememberCache<List<Employee>>(repo, CacheKey.participants(kind))
    LaunchedEffect(kind) { repo.refreshParticipants(kind) }
    val isP5m = kind == "p5m"
    val opDate = boot?.shift?.current?.operationalDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: nowWibDate()
    var date by rememberSaveable { mutableStateOf(opDate.toString()) }
    var shiftId by rememberSaveable { mutableStateOf(boot?.shift?.current?.id) }
    var locationId by rememberSaveable { mutableStateOf<String?>(null) }
    var topics by rememberSaveable { mutableStateOf("") }
    var people by remember { mutableStateOf(setOf<String>()) }
    var leaders by remember { mutableStateOf(setOf<String>()) }
    var photos by rememberSaveable { mutableStateOf(listOf<String>()) }
    var pickPeople by remember { mutableStateOf(false) }
    var pickLeader by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    if (shiftId == null && boot?.shift?.current?.id != null) shiftId = boot?.shift?.current?.id
    val topicList = topics.split('\n').map { it.trim() }.filter { it.isNotBlank() }
    val missing = buildList {
        if (shiftId == null) add("shift"); if (locationId == null) add("lokasi"); if (topicList.isEmpty()) add("topik")
        if (people.isEmpty()) add("peserta"); if (photos.isEmpty()) add("foto")
    }
    val label = if (isP5m) "P5M" else "Safety Talk / General"
    Screen(label, "Kegiatan keselamatan · tersimpan offline", onBack = onBack, footer = {
        if (tried && missing.isNotEmpty()) Hint("Lengkapi: ${missing.joinToString()}", p.red)
        BigButton("Simpan & kirim", {
            tried = true
            if (missing.isNotEmpty()) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(
                    if (isP5m) ItemType.P5M_CREATE else ItemType.SAFETYTALK_CREATE, label, "$label · ${topicList.first()}",
                    mapOf(
                        "event_date" to date, "shift_id" to shiftId, "location_id" to locationId, "topics" to topicList,
                        "participant_ids" to people.toList(), "led_by_ids" to leaders.toList().ifEmpty { listOfNotNull(boot?.me?.id) }, "photos" to photos,
                    ),
                )
                saving = false
                onSaved(uuid)
            }
        }, loading = saving)
    }) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField("Tanggal operasional", LocalDate.parse(date), { date = it.toString() }, Modifier.weight(1f))
        }
        Dropdown("Shift", boot?.shift?.list.orEmpty().map { it.id to (it.name ?: "-") }, shiftId, { shiftId = it })
        LocationPicker(boot?.areas.orEmpty(), locationId, { locationId = it })
        Label("Topik", required = true)
        Field(topics, { topics = it }, minLines = 2, placeholder = if (isP5m) "mis. Jarak aman di jalan hauling\n(satu topik per baris)" else "mis. Prosedur kerja saat hujan")
        Label("Peserta", required = true)
        val names = participants.orEmpty().filter { it.id in people }.map { it.nama ?: "-" }
        GhostButton(if (names.isEmpty()) "Pilih peserta" else "${names.size} peserta · ${names.take(4).joinToString()}${if (names.size > 4) "…" else ""}",
            { pickPeople = true }, Modifier.fillMaxWidth(), border = p.green)
        if (participants.isNullOrEmpty()) Notice(if (participants == null) "Daftar peserta belum terunduh. Sambungkan internet." else "Belum ada karyawan berstatus WAJIB di Seleksi Karyawan Setup ${if (isP5m) "P5M" else "Safety Talk"}. Minta admin HSE mengatur target & seleksi karyawan.", Tone.WARN)
        else Hint("Daftar dari Seleksi Karyawan di Setup ${if (isP5m) "P5M" else "Safety Talk"} yang berstatus WAJIB (${participants.orEmpty().size} orang).")
        Label("Pemateri / pemimpin")
        val leaderNames = boot?.employees.orEmpty().filter { it.id in leaders }.map { it.nama ?: "-" }
        GhostButton(if (leaderNames.isEmpty()) "Saya sendiri (ketuk untuk ganti)" else leaderNames.joinToString(), { pickLeader = true }, Modifier.fillMaxWidth())
        PhotoSlots(photos, { photos = it }, max = 3, minRequired = 1, label = "Foto kegiatan")
    }
    if (pickPeople) PersonPickerDialog("Peserta", participants.orEmpty(), people, { people = it; pickPeople = false }, { pickPeople = false })
    if (pickLeader) PersonPickerDialog("Pemateri", boot?.employees.orEmpty(), leaders, { leaders = it; pickLeader = false }, { pickLeader = false }, groupByJabatan = false)
}

/** Pertemuan K3 / Umum: peserta lintas departemen + tamu luar, lokasi bisa "Lainnya", pemimpin bisa eksternal. */
@Composable
fun MeetingScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var kind by rememberSaveable { mutableStateOf("K3") }
    var title by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf(nowWibDate().toString()) }
    var time by rememberSaveable { mutableStateOf(nowWibTime().toString()) }
    var locationId by rememberSaveable { mutableStateOf<String?>(null) }
    var otherLocation by rememberSaveable { mutableStateOf(false) }
    var locationText by rememberSaveable { mutableStateOf("") }
    var leaderExternal by rememberSaveable { mutableStateOf(false) }
    var leaderId by rememberSaveable { mutableStateOf(boot?.me?.id) }
    var leaderName by rememberSaveable { mutableStateOf("") }
    var people by remember { mutableStateOf(setOf<String>()) }
    var guests by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var photos by rememberSaveable { mutableStateOf(listOf<String>()) }
    var pick by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    val guestList = guests.split(',', '\n').map { it.trim() }.filter { it.isNotBlank() }
    val missing = buildList {
        if (title.isBlank()) add("agenda")
        if (if (otherLocation) locationText.isBlank() else locationId == null) add("lokasi")
        if (if (leaderExternal) leaderName.isBlank() else leaderId == null) add("pimpinan")
        if (people.isEmpty() && guestList.isEmpty()) add("peserta")
        if (photos.isEmpty()) add("foto")
    }
    Screen("Pertemuan K3 / Umum", "Rapat P2K3, sosialisasi, pertemuan umum", onBack = onBack, footer = {
        if (tried && missing.isNotEmpty()) Hint("Lengkapi: ${missing.joinToString()}", p.red)
        BigButton("Simpan & kirim", {
            tried = true
            if (missing.isNotEmpty()) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(
                    ItemType.MEETING_CREATE, "Pertemuan K3", title.take(60),
                    mapOf(
                        "meeting_kind" to kind, "title" to title.trim(), "meeting_date" to date, "start_time" to time,
                        "location_id" to if (otherLocation) null else locationId, "location_other" to if (otherLocation) locationText.trim() else null,
                        "leader_user_id" to if (leaderExternal) null else leaderId, "leader_external_name" to if (leaderExternal) leaderName.trim() else null,
                        "participant_ids" to people.toList(), "external_participants" to guestList, "notes" to notes.trim().ifBlank { null }, "photos" to photos,
                    ),
                )
                saving = false
                onSaved(uuid)
            }
        }, loading = saving)
    }) {
        Segmented(listOf("K3" to "Pertemuan K3", "UMUM" to "Pertemuan Umum"), kind, { kind = it })
        Label("Agenda / topik", required = true)
        Field(title, { title = it }, placeholder = "mis. Rapat P2K3 · evaluasi September")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField("Tanggal", LocalDate.parse(date), { date = it.toString() }, Modifier.weight(3f))
            TimeField("Mulai", LocalTime.parse(time), { time = it.toString() }, Modifier.weight(2f))
        }
        CheckRow(otherLocation, { otherLocation = it }, "Lokasi lainnya (isi manual)", "Untuk tempat di luar daftar area")
        if (otherLocation) Field(locationText, { locationText = it }, label = "Lokasi")
        else LocationPicker(boot?.areas.orEmpty(), locationId, { locationId = it })
        Label("Pemateri / pimpinan", required = true)
        CheckRow(leaderExternal, { leaderExternal = it }, "Pemateri dari luar perusahaan")
        if (leaderExternal) Field(leaderName, { leaderName = it }, label = "Nama & instansi", placeholder = "mis. Inspektur Tambang, Dinas ESDM")
        else Dropdown(null, boot?.employees.orEmpty().map { it.id to "${it.nama} · ${it.jabatan ?: "-"}" }, leaderId, { leaderId = it })
        Label("Peserta (lintas departemen)", required = true)
        val names = boot?.employees.orEmpty().filter { it.id in people }.map { it.nama ?: "-" }
        GhostButton(if (names.isEmpty()) "Pilih peserta: Departemen → Jabatan → Nama" else "${names.size} peserta · ${names.take(4).joinToString()}${if (names.size > 4) "…" else ""}",
            { pick = true }, Modifier.fillMaxWidth(), border = p.green)
        Field(guests, { guests = it }, label = "Tamu / peserta luar (opsional, pisahkan koma)")
        Field(notes, { notes = it }, label = "Catatan / hasil (opsional)", minLines = 2)
        PhotoSlots(photos, { photos = it }, max = 3, minRequired = 1, label = "Foto / daftar hadir")
    }
    if (pick) PersonPickerDialog("Peserta", boot?.employees.orEmpty(), people, { people = it; pick = false }, { pick = false })
}
