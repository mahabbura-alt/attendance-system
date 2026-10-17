package com.omos.safety.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.omos.safety.data.Bootstrap
import com.omos.safety.data.ItemType
import com.omos.safety.data.Net
import com.omos.safety.data.db.OutboxEntity
import com.omos.safety.data.db.OutboxStatus
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Card
import com.omos.safety.ui.CheckRow
import com.omos.safety.ui.DateField
import com.omos.safety.ui.EmergencyCard
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.KeyValue
import com.omos.safety.ui.Label
import com.omos.safety.ui.LocationPicker
import com.omos.safety.ui.Notice
import com.omos.safety.ui.PersonPickerDialog
import com.omos.safety.ui.PhotoSlots
import com.omos.safety.ui.Risk
import com.omos.safety.ui.RiskMatrix
import com.omos.safety.ui.RiskPill
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Segmented
import com.omos.safety.ui.TimeField
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.isoAt
import com.omos.safety.ui.locationName
import com.omos.safety.ui.nowWibDate
import com.omos.safety.ui.nowWibTime
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime

/** Draft hazard bersama untuk Isi laporan → Periksa & Kirim. Disimpan di HP agar tidak hilang saat app tertutup. */
data class HazardDraft(
    val mode: String = "create", val hazardId: String? = null, val reportNo: String? = null,
    val category: String = "UNSAFE_CONDITION", val locationId: String? = null,
    val date: String = nowWibDate().toString(), val time: String = nowWibTime().toString(),
    val description: String = "", val potentialConsequence: String = "", val recommendation: String = "", val immediateAction: String = "",
    val stopWork: Boolean = false, val photos: List<String> = emptyList(), val photosChanged: Boolean = false,
    val picIds: List<String> = emptyList(), val likelihood: Int = 3, val consequence: Int = 3,
    /** Nilai awal saat koreksi, untuk mengirim hanya field yang berubah. */
    val original: Map<String, String?>? = null,
) {
    val riskLevel get() = Risk.levelOf(likelihood * consequence)
    val urgent get() = riskLevel == "EXTREME" || stopWork
}

object Drafts {
    var hazard by mutableStateOf(HazardDraft())
    private const val PREF = "omos_safety_drafts"

    fun load(ctx: Context) {
        val json = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("hazard", null) ?: return
        runCatching { Net.rawGson.fromJson(json, HazardDraft::class.java) }.getOrNull()?.let { if (it.mode == "create") hazard = it }
    }

    fun update(ctx: Context, d: HazardDraft) {
        hazard = d
        if (d.mode == "create") ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("hazard", Net.rawGson.toJson(d)).apply()
    }

    fun clear(ctx: Context) {
        hazard = HazardDraft()
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().remove("hazard").apply()
    }
}

@Composable
fun HazardFormScreen(onBack: () -> Unit, onNext: () -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var showPic by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (Drafts.hazard.mode == "create" && Drafts.hazard.description.isBlank()) Drafts.load(ctx) }
    val d = Drafts.hazard
    val set: (HazardDraft) -> Unit = { Drafts.update(ctx, it) }
    val correcting = d.mode == "correct"
    val missing = buildList {
        if (d.locationId == null) add("lokasi")
        if (d.description.isBlank()) add("uraian temuan")
        if (d.potentialConsequence.isBlank()) add("konsekuensi / dampak")
        if (d.recommendation.isBlank()) add("rekomendasi perbaikan")
        if (!correcting || d.photosChanged) { if (d.photos.isEmpty()) add("foto") }
        if (!correcting && d.picIds.isEmpty()) add("PIC")
    }
    Screen(
        if (correcting) "Koreksi Laporan" else "Lapor Hazard",
        if (correcting) "${d.reportNo ?: ""} · revisi baru" else "Langkah 1 dari 2 · Isi laporan · draft tersimpan otomatis",
        onBack = onBack,
        footer = {
            if (tried && missing.isNotEmpty()) Hint("Lengkapi: ${missing.joinToString()}", p.red)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                GhostButton("Kembali", onBack, Modifier.weight(1f))
                BigButton("Periksa", { tried = true; if (missing.isEmpty()) onNext() }, Modifier.weight(1f))
            }
        },
    ) {
        if (boot == null) Notice("Data master belum ada di HP. Sambungkan internet sekali agar lokasi, PIC, dan matriks risiko terunduh.", Tone.WARN)
        Label("Jenis temuan", required = true)
        Segmented(listOf("UNSAFE_CONDITION" to "Kondisi Tidak Aman", "UNSAFE_ACT" to "Tindakan Tidak Aman"), d.category, { set(d.copy(category = it)) })
        LocationPicker(boot?.areas.orEmpty(), d.locationId, { set(d.copy(locationId = it)) })
        Hint("Main Area → Sub Area, dari Setup Area di Master Setup HSE.")
        Label("Waktu kejadian", required = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField("Tanggal", LocalDate.parse(d.date), { set(d.copy(date = it.toString())) }, Modifier.weight(3f))
            TimeField("Jam", LocalTime.parse(d.time), { set(d.copy(time = it.toString())) }, Modifier.weight(2f))
        }
        Hint("Otomatis terisi waktu sekarang · ubah bila dilaporkan setelah kejadian.")
        Label("Apa yang Anda lihat?", required = true)
        Field(d.description, { set(d.copy(description = it)) }, minLines = 3, placeholder = "mis. Tanggul KM 3 longsor, tinggi kurang dari ½ roda HD")
        Label("Konsekuensi / potensi dampak", required = true)
        Field(d.potentialConsequence, { set(d.copy(potentialConsequence = it)) }, minLines = 2, placeholder = "Apa yang bisa terjadi? mis. HD tergelincir keluar jalur, operator cedera")
        Label("Rekomendasi perbaikan", required = true)
        Field(d.recommendation, { set(d.copy(recommendation = it)) }, minLines = 2, placeholder = "Usulan perbaikan, mis. tinggikan tanggul, pasang rambu")
        Hint("Menjadi tugas (CAPA) setiap PIC. Laporan otomatis selesai saat semua PIC selesai dan diverifikasi.")
        Label("Tindakan segera yang sudah dilakukan", hint = "(opsional)")
        Field(d.immediateAction, { set(d.copy(immediateAction = it)) }, minLines = 2, placeholder = "mis. pasang cone, hentikan unit, beri tahu pengawas lewat radio")
        CheckRow(d.stopWork, { set(d.copy(stopWork = it)) }, "Stop Work — pekerjaan di lokasi ini dihentikan",
            "Hak setiap pekerja. Pekerjaan baru boleh lanjut setelah pengawas area menyatakan aman.", danger = true)
        if (correcting && !d.photosChanged) {
            Notice("Foto lama tetap dipakai. Ambil foto baru hanya bila ingin menggantinya.")
            GhostButton("Ganti foto", { set(d.copy(photosChanged = true, photos = emptyList())) }, Modifier.fillMaxWidth())
        } else {
            PhotoSlots(d.photos, { set(d.copy(photos = it, photosChanged = true)) }, max = 3, minRequired = 1)
        }
        if (!correcting) {
            val names = boot?.employees.orEmpty().filter { it.id in d.picIds }.map { it.nama ?: "-" }
            Label("PIC tindak lanjut", required = true)
            GhostButton(if (names.isEmpty()) "Pilih PIC (bisa lebih dari satu)" else "${names.size} PIC · ${names.joinToString()}", { showPic = true }, Modifier.fillMaxWidth(), color = p.ink, border = p.green)
        }
        RiskMatrix(d.likelihood, d.consequence, { l, s -> set(d.copy(likelihood = l, consequence = s)) }, boot?.riskMatrix.orEmpty(), boot?.slaHours)
        if (d.urgent) UrgentCard(boot, if (d.riskLevel == "EXTREME") "Risiko EKSTREM — eskalasi segera" else "Stop Work dilaporkan — eskalasi segera")
    }
    if (showPic) PersonPickerDialog(
        "Pilih PIC", boot?.employees.orEmpty(), d.picIds.toSet(), { set(d.copy(picIds = it.toList())); showPic = false }, { showPic = false },
        hint = "Centang jabatan untuk memilih semua personelnya sekaligus.",
    )
}

@Composable
fun UrgentCard(boot: Bootstrap?, title: String) {
    val contact = boot?.emergencyContacts.orEmpty().firstOrNull { !it.phoneNo.isNullOrBlank() }
    EmergencyCard(
        title,
        "Laporan dikirim lebih dulu dari antrean lain dan ditandai DARURAT untuk HSE on-duty. Notifikasi di HP mereka bisa tertunda hingga ±15 menit — telepon sekarang, jangan menunggu aplikasi.",
        boot?.hseOnDuty?.current.orEmpty(), contact?.name, contact?.phoneNo,
        boot?.shift?.current?.let { "${it.name} ${com.omos.safety.ui.fmtDate(it.operationalDate)}" },
    )
}

@Composable
fun HazardReviewScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var saving by remember { mutableStateOf(false) }
    val d = Drafts.hazard
    val correcting = d.mode == "correct"
    Screen(if (correcting) "Periksa Koreksi" else "Periksa & Kirim", "Langkah 2 dari 2", onBack = onBack, footer = {
        BigButton(if (correcting) "Kirim koreksi" else "Kirim laporan", {
            saving = true
            scope.launch {
                val title = d.description.take(60)
                val uuid = if (correcting) {
                    val fields = mutableMapOf<String, Any?>()
                    val o = d.original.orEmpty()
                    if (o["category"] != d.category) fields["category_code"] = d.category
                    if (o["location_id"] != d.locationId) fields["location_id"] = d.locationId
                    if (o["description"] != d.description) fields["description"] = d.description
                    if (o["potential_consequence"] != d.potentialConsequence) fields["potential_consequence"] = d.potentialConsequence.trim()
                    if (o["recommendation"] != d.recommendation) fields["recommendation"] = d.recommendation.trim()
                    if (o["immediate_action"] != d.immediateAction) fields["immediate_action"] = d.immediateAction
                    if (o["stop_work"] != d.stopWork.toString()) fields["stop_work"] = d.stopWork
                    if (o["occurred_at"] != isoAt(LocalDate.parse(d.date), LocalTime.parse(d.time))) fields["occurred_at"] = isoAt(LocalDate.parse(d.date), LocalTime.parse(d.time))
                    if (o["likelihood"] != d.likelihood.toString()) fields["likelihood"] = d.likelihood
                    if (o["consequence"] != d.consequence.toString()) fields["consequence"] = d.consequence
                    if (d.photosChanged) fields["photos"] = d.photos
                    repo.enqueue(ItemType.HAZARD_CORRECT, "Hazard", "Koreksi · ${d.reportNo}", mapOf("hazard_id" to d.hazardId, "fields" to fields), refId = d.hazardId)
                } else {
                    repo.enqueue(
                        ItemType.HAZARD_CREATE, "Hazard", title,
                        mapOf(
                            "category_code" to d.category, "location_id" to d.locationId,
                            "occurred_at" to isoAt(LocalDate.parse(d.date), LocalTime.parse(d.time)),
                            "description" to d.description.trim(), "potential_consequence" to d.potentialConsequence.trim(),
                            "recommendation" to d.recommendation.trim(),
                            "immediate_action" to d.immediateAction.trim(), "stop_work" to d.stopWork,
                            "likelihood" to d.likelihood, "consequence" to d.consequence,
                            "photos" to d.photos, "pic_ids" to d.picIds,
                        ),
                        urgent = d.urgent,
                    )
                }
                Drafts.clear(ctx)
                saving = false
                onSaved(uuid)
            }
        }, loading = saving)
    }) {
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (d.category == "UNSAFE_ACT") "Tindakan Tidak Aman" else "Kondisi Tidak Aman", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f))
                RiskPill(d.riskLevel)
            }
            Text(d.description, style = Type.title, color = p.ink)
            KeyValue("Lokasi", locationName(boot?.areas, d.locationId))
            KeyValue("Waktu kejadian", "${com.omos.safety.ui.fmtDate(d.date)} ${d.time}")
            KeyValue("Konsekuensi / dampak", d.potentialConsequence)
            KeyValue("Rekomendasi perbaikan", d.recommendation)
            if (d.immediateAction.isNotBlank()) KeyValue("Tindakan segera", d.immediateAction)
            if (d.stopWork) Text("STOP WORK dilaporkan", style = Type.small.copy(fontWeight = FontWeight.Bold), color = p.red)
            if (!correcting) KeyValue("PIC", boot?.employees.orEmpty().filter { it.id in d.picIds }.joinToString { it.nama ?: "-" })
            KeyValue("Batas tindak lanjut PIC", Risk.slaText(d.riskLevel, boot?.slaHours))
            KeyValue("Foto", if (correcting && !d.photosChanged) "Tetap (foto lama)" else "${d.photos.size} foto")
        }
        if (d.urgent) UrgentCard(boot, "Eskalasi darurat")
        Notice("Tanpa sinyal pun aman: laporan disimpan di HP dan dikirim otomatis saat online. Kirim ulang tidak membuat laporan ganda.")
    }
}

@Composable
fun SavedScreen(clientUuid: String, onHome: () -> Unit, onAgain: (route: String) -> Unit, onOutbox: () -> Unit) {
    val repo = rememberRepo()
    val items by repo.observeOutbox().collectAsState(initial = emptyList())
    val item: OutboxEntity? = items.firstOrNull { it.clientUuid == clientUuid }
    val sync by repo.sync.collectAsState()
    val pending = items.filter { it.status != OutboxStatus.SENT }
    val sent = item?.status == OutboxStatus.SENT
    Screen(if (sent) "Terkirim" else "Laporan tersimpan", onBack = onHome, footer = {
        BigButton("Lapor lagi", {
            onAgain(when (item?.type) {
                ItemType.INCIDENT_CREATE -> R.INCIDENT; ItemType.INSPECTION_CREATE -> R.INSPECTION
                ItemType.P5M_CREATE -> R.P5M; ItemType.SAFETYTALK_CREATE -> R.SAFETYTALK; ItemType.MEETING_CREATE -> R.MEETING
                else -> R.HAZARD
            })
        })
        GhostButton("Ke Beranda", onHome, Modifier.fillMaxWidth())
    }) {
        if (!sync.online && !sent) Notice("Tidak ada sinyal. Data aman di HP, terkirim otomatis saat online.", Tone.WARN, title = "Offline")
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (sent) Icons.Filled.CheckCircle else Icons.Filled.CloudOff, null, tint = if (sent) p.green else p.amber, modifier = Modifier.size(72.dp))
            Text(
                when {
                    item == null -> "Tersimpan."
                    sent -> "${item.module} ${item.serverNo ?: ""} diterima server."
                    item.status == OutboxStatus.FAILED -> "Ditolak server: ${item.errorMessage}"
                    else -> "${item.module} disimpan di HP. Anda tidak perlu menunggu — data dikirim otomatis begitu sinyal tersedia."
                },
                style = Type.body, color = p.muted2, textAlign = TextAlign.Center,
            )
        }
        if (pending.isNotEmpty()) Card(onClick = onOutbox) {
            Text("Menunggu dikirim (${pending.size})", style = Type.title, color = p.ink)
            pending.take(5).forEach { Text("• ${it.module} · ${it.title}", style = Type.small, color = p.muted2) }
            Text("Lihat antrean ›", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.green)
        }
        StorageWarning(onOutbox)
    }
}

@Composable
fun StorageWarning(onOpen: () -> Unit) {
    val repo = rememberRepo()
    val info = remember { repo.photos.storageInfo() }
    if (info.freeBytes < 1024L * 1024 * 1024) {
        Card(bg = p.amberBg, border = p.amber, onClick = onOpen) {
            Text("Ruang HP hampir penuh · sisa ${com.omos.safety.ui.fmtBytes(info.freeBytes)}", style = Type.small.copy(fontWeight = FontWeight.Bold), color = p.amberText)
            Text("Bebaskan ruang agar foto berikutnya tetap tersimpan. Kelola ›", style = Type.tiny, color = p.amberText)
        }
    }
}

@Suppress("unused") private val dot = CircleShape
