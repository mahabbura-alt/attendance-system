package com.omos.safety.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omos.safety.data.ItemType
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Card
import com.omos.safety.ui.DateField
import com.omos.safety.ui.Dropdown
import com.omos.safety.ui.EmergencyCard
import com.omos.safety.ui.Field
import com.omos.safety.ui.GhostButton
import com.omos.safety.ui.Hint
import com.omos.safety.ui.Label
import com.omos.safety.ui.LocationPicker
import com.omos.safety.ui.Notice
import com.omos.safety.ui.PhotoSlots
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Segmented
import com.omos.safety.ui.TimeField
import com.omos.safety.ui.Tone
import com.omos.safety.ui.isoAt
import com.omos.safety.ui.nowWibDate
import com.omos.safety.ui.nowWibTime
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime

private val CATEGORIES = listOf(
    "NEAR_MISS" to "Near Miss", "INJURY" to "Orang cedera", "VEHICLE" to "Kecelakaan unit",
    "PROPERTY" to "Kerusakan alat", "FIRE" to "Kebakaran", "ENVIRONMENTAL" to "Lingkungan",
)
private val CATEGORY_HINTS = mapOf(
    "NEAR_MISS" to "hampir celaka, tanpa korban", "INJURY" to "P3K / berobat / dirujuk",
    "VEHICLE" to "tabrakan, terguling, terperosok", "PROPERTY" to "tanpa korban",
    "FIRE" to "unit, gudang, area", "ENVIRONMENTAL" to "tumpahan oli / BBM / limbah",
)
private val TREATMENTS = listOf("NONE" to "Tidak perlu", "FIRST_AID" to "P3K di lokasi", "MEDICAL" to "Berobat ke klinik", "HOSPITALIZED" to "Dirujuk ke RS")

@Composable
fun IncidentScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    var category by rememberSaveable { mutableStateOf("NEAR_MISS") }
    var date by rememberSaveable { mutableStateOf(nowWibDate().toString()) }
    var time by rememberSaveable { mutableStateOf(nowWibTime().toString()) }
    var locationId by rememberSaveable { mutableStateOf<String?>(null) }
    var unit by rememberSaveable { mutableStateOf("") }
    var victimId by rememberSaveable { mutableStateOf<String?>(null) }
    var victimName by rememberSaveable { mutableStateOf("") }
    var bodyPart by rememberSaveable { mutableStateOf("") }
    var treatment by rememberSaveable { mutableStateOf("FIRST_AID") }
    var chronology by rememberSaveable { mutableStateOf("") }
    var immediate by rememberSaveable { mutableStateOf("") }
    var witness by rememberSaveable { mutableStateOf("") }
    var photos by rememberSaveable { mutableStateOf(listOf<String>()) }
    var saving by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    val hasVictim = category == "INJURY" || category == "VEHICLE"
    val urgent = category !in listOf("NEAR_MISS", "PROPERTY")
    val missing = buildList {
        if (locationId == null) add("lokasi")
        if (chronology.isBlank()) add("kronologi")
        if (immediate.isBlank()) add("tindakan segera")
        if (category == "INJURY" && victimId == null && victimName.isBlank()) add("korban")
    }
    val contact = boot?.emergencyContacts.orEmpty().firstOrNull { !it.phoneNo.isNullOrBlank() }

    Screen("Lapor Insiden / Near Miss", "Laporan awal · investigasi dilanjutkan HSE", onBack = onBack, footer = {
        if (tried && missing.isNotEmpty()) Hint("Lengkapi: ${missing.joinToString()}", p.red)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GhostButton("Batal", onBack, Modifier.weight(1f))
            BigButton("Kirim laporan", {
                tried = true
                if (missing.isNotEmpty()) return@BigButton
                saving = true
                scope.launch {
                    val victim = if (hasVictim && (victimId != null || victimName.isNotBlank()))
                        mapOf("user_id" to victimId, "name" to victimName.ifBlank { null }, "body_part" to bodyPart, "treatment" to treatment) else null
                    val uuid = repo.enqueue(
                        ItemType.INCIDENT_CREATE, "Insiden", "${CATEGORIES.first { it.first == category }.second} · ${chronology.take(50)}",
                        mapOf(
                            "category" to category, "occurred_at" to isoAt(LocalDate.parse(date), LocalTime.parse(time)),
                            "location_id" to locationId, "unit_code" to unit.trim().ifBlank { null }, "description" to chronology.trim(),
                            "immediate_action" to immediate.trim(), "victim" to victim,
                            "witnesses" to witness.split(',', '\n').map { it.trim() }.filter { it.isNotBlank() }, "photos" to photos,
                        ),
                        urgent = urgent,
                    )
                    saving = false
                    onSaved(uuid)
                }
            }, Modifier.weight(2f), container = p.red, loading = saving)
        }
    }) {
        EmergencyCard(
            "Ada korban atau bahaya masih berlangsung?",
            "Amankan lokasi dan hubungi tim tanggap darurat dulu. Laporan ini bisa diisi setelahnya.",
            boot?.hseOnDuty?.current.orEmpty(), contact?.name ?: "ERT", contact?.phoneNo,
            boot?.shift?.current?.name,
        )
        Label("Jenis kejadian", required = true)
        Segmented(CATEGORIES, category, { category = it }, activeBg = com.omos.safety.ui.EmergencyRed, hints = CATEGORY_HINTS)
        Hint("Klasifikasi akhir (FAI / MTI / LTI) ditetapkan HSE setelah investigasi.")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField("Tanggal kejadian", LocalDate.parse(date), { date = it.toString() }, Modifier.weight(3f))
            TimeField("Jam", LocalTime.parse(time), { time = it.toString() }, Modifier.weight(2f))
        }
        LocationPicker(boot?.areas.orEmpty(), locationId, { locationId = it })
        Field(unit, { unit = it }, label = "Unit / peralatan terlibat (opsional)", placeholder = "mis. DT-045")
        if (hasVictim) Card(border = p.amber) {
            Label("Orang yang cedera", required = category == "INJURY")
            Dropdown("Nama korban (karyawan aktif)", listOf<Pair<String?, String>>(null to "Orang luar / kontraktor (isi manual)") +
                boot?.employees.orEmpty().map { it.id to "${it.nama} · ${it.jabatan ?: "-"}" }, victimId, { victimId = it })
            if (victimId == null) Field(victimName, { victimName = it }, label = "Nama korban (orang luar)")
            Field(bodyPart, { bodyPart = it }, label = "Bagian tubuh yang cedera", placeholder = "mis. tangan kiri")
            Label("Penanganan saat ini")
            Segmented(TREATMENTS, treatment, { treatment = it }, activeBg = p.ink)
        }
        Label("Kronologi singkat", required = true)
        Field(chronology, { chronology = it }, minLines = 3, placeholder = "Apa yang terjadi, urutan kejadian")
        Label("Tindakan segera yang sudah dilakukan", required = true)
        Field(immediate, { immediate = it }, minLines = 2, placeholder = "mis. unit dihentikan, area dipasang cone, korban dibawa ke klinik")
        Field(witness, { witness = it }, label = "Saksi (opsional, pisahkan dengan koma)")
        PhotoSlots(photos, { photos = it }, max = 3, minRequired = 0, label = "Foto")
        Notice(
            if (urgent) "Saat terkirim, laporan ditandai DARURAT untuk HSE on-duty. Notifikasi di HP mereka bisa tertunda ±15 menit — tetap telepon atau hubungi lewat radio."
            else "Saat terkirim, HSE on-duty mendapat notifikasi pada sinkron berikutnya (±15 menit). Tanpa sinyal, laporan disimpan di HP dan dikirim otomatis.",
            if (urgent) Tone.DANGER else Tone.INFO,
        )
    }
}
