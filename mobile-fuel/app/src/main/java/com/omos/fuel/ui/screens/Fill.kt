package com.omos.fuel.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.omos.fuel.data.FuelRules
import com.omos.fuel.data.ItemType
import com.omos.fuel.data.PhotoRef
import com.omos.fuel.data.db.OutboxEntity
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.Chips
import com.omos.fuel.ui.Drafts
import com.omos.fuel.ui.KeyValue
import com.omos.fuel.ui.Lookup
import com.omos.fuel.ui.NumberField
import com.omos.fuel.ui.PhotoSlots
import com.omos.fuel.ui.Pill
import com.omos.fuel.ui.Screen
import com.omos.fuel.ui.TextBox
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.fmtLiter
import com.omos.fuel.ui.fmtNum
import com.omos.fuel.ui.missingRequired
import com.omos.fuel.ui.p
import com.omos.fuel.ui.parseDecimal
import com.omos.fuel.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate

private data class LastReading(val hm: Double?, val km: Double?, val at: Instant?, val shiftStart: Instant?, val label: String)

@Composable
fun FillScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val e = Lookup.equipment(b, Drafts.unitId)
    val sourceId = repo.session.sourceLocationId
    val source = Lookup.location(b, sourceId)
    val slots = Lookup.slots(b, "issue_equipment")
    var local by remember { mutableStateOf<List<OutboxEntity>>(emptyList()) }
    LaunchedEffect(e?.id) { local = repo.localFillsSince(System.currentTimeMillis() - 30L * 86_400_000) }

    var hm by remember { mutableStateOf("") }
    var km by remember { mutableStateOf("") }
    var liter by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var productId by remember { mutableStateOf(Lookup.defaultProductId(b)) }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    if (e == null) {
        Screen("Isi unit", onBack = onBack) { Banner("Unit tidak ditemukan di data master HP. Pindai ulang atau segarkan data.", Tone.BAD) }
        return
    }
    val now = Instant.now()
    val slot = FuelRules.operationalSlot(now)
    val slotStart = FuelRules.shiftStart(slot.operationalDate, slot.shiftKind)
    val kmOnly = e.kmOnly == true

    // Pembacaan terakhir: antrean HP (lebih baru) atau master server.
    val localMine = local.filter { repo.payloadOf(it)["equipment_id"] == e.id }.maxByOrNull { it.createdAt }
    val last: LastReading = localMine?.let {
        val pl = repo.payloadOf(it)
        LastReading((pl["hm_reading"] as? Number)?.toDouble(), (pl["odometer_reading"] as? Number)?.toDouble(),
            Instant.ofEpochMilli(it.createdAt), null, "HP ini · ${com.omos.fuel.ui.screens.fmtMillis(it.createdAt)}")
    } ?: run {
        val lastDate = e.lastTanggal?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val lastKind = b?.shifts?.firstOrNull { it.id == e.lastShiftId }?.namaShift?.lowercase()?.let { if (it.contains("malam")) "malam" else "siang" }
        LastReading(e.lastHm, e.lastKm, e.lastFilledAt?.let { runCatching { Instant.parse(it) }.getOrNull() },
            lastDate?.let { FuelRules.shiftStart(it, lastKind ?: "siang") }, e.lastTanggal?.take(10) ?: "belum ada")
    }
    val sudahIsi = (localMine != null && localMine.createdAt >= slotStart.toEpochMilli()) ||
        (e.lastTanggal?.take(10) == slot.operationalDate.toString() && e.lastShiftId != null && e.lastShiftId == Lookup.shiftIdNow(b, now))

    val hmVal = parseDecimal(hm)
    val kmVal = parseDecimal(km)
    val literVal = parseDecimal(liter)
    val hmMundur = FuelRules.isBackwards(last.hm, hmVal)
    val kmMundur = FuelRules.isBackwards(last.km, kmVal)
    val tol = b?.settings?.hmGapToleranceHours ?: 1.0
    val gap = if (!hmMundur) FuelRules.hmGapCheck(last.hm, last.at, last.shiftStart, hmVal, now, tol) else FuelRules.HmGap(false)
    val overTank = literVal != null && FuelRules.overTank(literVal, e.fuelTankCapacityLiter)
    val butuhAlasan = buildList {
        if (gap.exceeded) add("selisih HM melebihi waktu berlalu")
        if (overTank) add("liter melebihi kapasitas tangki")
    }

    fun save() {
        error = when {
            sudahIsi -> "${e.kodeAlat} sudah diisi pada shift ini. Satu unit hanya satu pengisian per shift — laporkan ke admin bila perlu koreksi."
            source == null -> "Pilih lokasi sumber di Beranda."
            !kmOnly && hmVal == null -> "Isi HM saat pengisian."
            kmOnly && kmVal == null -> "Unit Km-only wajib mengisi KM."
            kmMundur -> "KM harus lebih besar dari pembacaan terakhir (${fmtNum(last.km)})."
            literVal == null || literVal <= 0 -> "Isi liter yang diisikan (> 0)."
            (productId ?: Lookup.defaultProductId(b)) == null -> "Pilih produk fuel."
            butuhAlasan.isNotEmpty() && reason.isBlank() -> "Alasan wajib: ${butuhAlasan.joinToString(", ")}."
            missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
            else -> null
        }
        if (error != null) return
        saving = true
        scope.launch {
            val uuid = repo.enqueue(
                ItemType.FILL, "${e.kodeAlat} · ${fmtLiter(literVal)}",
                mapOf(
                    "equipment_id" to e.id, "unit_input" to Drafts.unitInput, "unit_input_reason" to Drafts.manualReason,
                    "source_location_id" to sourceId, "product_id" to (productId ?: Lookup.defaultProductId(b)),
                    "hm_reading" to hmVal, "odometer_reading" to kmVal, "fuel_filled" to literVal,
                    "filled_at" to now.toString(), "mobile_reason" to reason.trim().ifBlank { null },
                    "evidence_config_version" to b?.evidence?.version,
                ),
                photos.values.toList(), liter = literVal!!, sourceLocationId = sourceId,
            )
            saving = false
            onSaved(uuid)
        }
    }

    Screen("${e.kodeAlat}", subtitle = "Isi unit · dari ${source?.locationCode ?: "-"}", onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Simpan pengisian", enabled = !saving) { save() }
    }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(if (Drafts.unitInput == "manual") "Manual" else "QR", if (Drafts.unitInput == "manual") Tone.WARN else Tone.OK)
            Text(listOfNotNull(e.kelasAlat, e.classUnit).joinToString(" · ") + (e.fuelTankCapacityLiter?.let { " · tangki ${fmtLiter(it)}" } ?: ""),
                style = Type.small, color = p.muted)
        }
        if (sudahIsi) Banner("${e.kodeAlat} sudah diisi pada shift ini. Satu unit hanya satu pengisian per shift.", Tone.BAD)
        Card {
            KeyValue("HM terakhir", "${fmtNum(last.hm)} · ${last.label}")
            if (last.km != null || kmOnly) KeyValue("KM terakhir", fmtNum(last.km))
        }
        NumberField(if (kmOnly) "HM saat ini (opsional)" else "HM saat ini", hm, { hm = it; error = null },
            help = if (gap.checked) "Selisih ${fmtNum(gap.deltaHm)} j · waktu berlalu ${fmtNum(gap.elapsedHours)} j" else null)
        if (hmMundur) Banner("HM lebih kecil dari pembacaan terakhir. Pengisian tetap tercatat tetapi HM ditahan sampai admin membuat Event HM (reset/ganti meter) di Input Data.", Tone.WARN)
        if (gap.exceeded) Banner("Selisih HM (${fmtNum(gap.deltaHm)} j) lebih dari waktu berlalu (${fmtNum(gap.elapsedHours)} j) + toleransi ${fmtNum(tol)} j. Periksa angka HM, atau lanjutkan dengan alasan.", Tone.WARN)
        NumberField("KM / odometer saat ini · input manual", km, { km = it; error = null },
            help = "KM terakhir ${fmtNum(last.km)}. Wajib untuk unit Km-only, opsional untuk unit HM.",
            error = if (kmMundur) "KM tidak boleh lebih kecil dari pembacaan terakhir." else null)
        NumberField("Fuel diisi (liter)", liter, { liter = it; error = null },
            help = e.fuelTankCapacityLiter?.let { "Kapasitas tangki ${fmtLiter(it)}" })
        if (overTank) Banner("Liter melebihi kapasitas tangki ${fmtLiter(e.fuelTankCapacityLiter)}. Lanjutkan hanya dengan alasan.", Tone.WARN)
        if ((b?.products?.size ?: 0) > 1) {
            Text("Produk", style = Type.small, color = p.ink)
            Chips(b?.products.orEmpty().map { it.id to (it.productCode ?: "-") }, productId ?: Lookup.defaultProductId(b)) { productId = it }
        }
        if (butuhAlasan.isNotEmpty()) TextBox("Alasan (wajib)", reason, { reason = it; error = null }, help = butuhAlasan.joinToString(" · "))
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
    }
}

fun fmtMillis(ms: Long): String = java.time.format.DateTimeFormatter.ofPattern("d MMM HH:mm", java.util.Locale("id", "ID"))
    .format(Instant.ofEpochMilli(ms).atZone(FuelRules.WIB))

/** Konfirmasi tersimpan di antrean HP. */
@Composable
fun SavedScreen(clientUuid: String, onAgain: () -> Unit, onHome: () -> Unit) {
    val repo = rememberRepo()
    var item by remember { mutableStateOf<OutboxEntity?>(null) }
    LaunchedEffect(clientUuid) { item = repo.get(clientUuid) }
    val pending by repo.observePendingCount().collectAsState(initial = 0)
    Screen("Tersimpan di perangkat", footer = {
        if (item?.type == ItemType.FILL) BigButton("Isi unit berikutnya", onClick = onAgain)
        BigButton("Ke beranda", primary = item?.type == ItemType.FILL == false, onClick = onHome)
    }) {
        Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("✓", style = Type.big, color = p.ok)
            Text(item?.title ?: "", style = Type.title, color = p.ink, textAlign = TextAlign.Center)
            Text("Akan dikirim otomatis saat ada sinyal ($pending menunggu).", style = Type.small, color = p.muted, textAlign = TextAlign.Center)
        }
        Card {
            KeyValue("Kode transaksi", clientUuid.take(8) + "…")
            KeyValue("Foto", "${item?.let { repo.photosOf(it).size } ?: 0} terlampir")
        }
    }
}
