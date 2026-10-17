package com.omos.fuel.ui.screens

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.omos.fuel.data.FuelRules
import com.omos.fuel.data.ItemType
import com.omos.fuel.data.PhotoRef
import com.omos.fuel.data.db.OutboxStatus
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.KeyValue
import com.omos.fuel.ui.Lookup
import com.omos.fuel.ui.NumberField
import com.omos.fuel.ui.PhotoSlots
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

/** Buka shift: totalizer awal fuel truck/tangki sumber + foto. */
@Composable
fun OpenShiftScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val sourceId = repo.session.sourceLocationId
    val source = Lookup.location(b, sourceId)
    var totalizer by remember { mutableStateOf("") }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    val slots = Lookup.slots(b, "shift_open")
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    Screen("Buka shift", subtitle = Lookup.shiftLabel(b), onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Buka shift", enabled = !saving) {
            val v = parseDecimal(totalizer)
            error = when {
                source == null -> "Pilih lokasi sumber di Beranda."
                v == null || v < 0 -> "Isi angka totalizer awal."
                missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
                else -> null
            }
            if (error != null) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(ItemType.SHIFT_OPEN, "Buka shift ${source?.locationCode} · totalizer ${fmtNum(v)}",
                    mapOf("location_id" to sourceId, "totalizer_open" to v, "opened_at" to Instant.now().toString(),
                        "evidence_config_version" to b?.evidence?.version),
                    photos.values.toList())
                saving = false
                onSaved(uuid)
            }
        }
    }) {
        Card {
            Text("Lokasi sumber", style = Type.small, color = p.muted)
            Text(Lookup.locationLabel(source), style = Type.title, color = p.ink)
        }
        NumberField("Totalizer awal", totalizer, { totalizer = it; error = null }, help = "Baca angka di flow meter (liter)")
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
    }
}

/** Tutup shift: totalizer akhir → selisih vs pengisian + transfer keluar (server menghitung ulang). */
@Composable
fun CloseShiftScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    val sourceId = repo.session.sourceLocationId
    val source = Lookup.location(b, sourceId)
    val open = openShiftFor(sourceId, b?.openSessions, outbox) { repo.payloadOf(it) }
    var totalizer by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    val slots = Lookup.slots(b, "shift_close")
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    if (open == null) {
        Screen("Tutup shift", onBack = onBack) { Banner("Belum ada shift terbuka untuk ${source?.locationCode ?: "lokasi sumber"}.", Tone.WARN) }
        return
    }
    // Estimasi HP: pengisian + transfer keluar yang dicatat di HP ini sejak shift dibuka.
    val keluar = outbox.filter {
        (it.type == ItemType.FILL || it.type == ItemType.TRANSFER) && it.sourceLocationId == sourceId &&
            it.createdAt >= open.openedAt.toEpochMilli() && it.status != OutboxStatus.REJECTED
    }
    val recorded = keluar.sumOf { it.liter }
    val close = parseDecimal(totalizer)
    val pct = b?.settings?.totalizerTolerancePct ?: 0.5
    val minL = b?.settings?.totalizerToleranceLiter ?: 20.0
    val v = close?.let { FuelRules.totalizerVariance(open.totalizerOpen, it, recorded, pct, minL) }

    Screen("Tutup shift", subtitle = "${source?.locationCode ?: ""} · dibuka ${fmtMillis(open.openedAt.toEpochMilli())}", onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Tutup shift", enabled = !saving) {
            error = when {
                close == null -> "Isi angka totalizer akhir."
                v?.investigate == true && reason.isBlank() -> if (v.rollover) "Totalizer akhir lebih kecil dari awal: alasan wajib." else "Selisih melewati ambang: alasan wajib."
                missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
                else -> null
            }
            if (error != null) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(ItemType.SHIFT_CLOSE, "Tutup shift ${source?.locationCode} · totalizer ${fmtNum(close)}",
                    mapOf("session_id" to open.sessionId, "session_client_uuid" to open.clientUuid, "totalizer_close" to close,
                        "closed_at" to Instant.now().toString(), "reason" to reason.trim().ifBlank { null },
                        "evidence_config_version" to b?.evidence?.version),
                    photos.values.toList())
                saving = false
                onSaved(uuid)
            }
        }
    }) {
        Card { KeyValue("Totalizer awal", fmtNum(open.totalizerOpen)) }
        NumberField("Totalizer akhir", totalizer, { totalizer = it; error = null })
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
        if (v != null) Card {
            if (v.rollover) Banner("Totalizer akhir lebih kecil dari awal (rollover/reset meter). Wajib alasan; ditandai investigasi.", Tone.BAD)
            else {
                KeyValue("Totalizer akhir − awal", fmtLiter(v.meterDelta, 1))
                KeyValue("Pengisian + transfer dicatat (HP ini, ${keluar.size})", fmtLiter(recorded, 1))
                KeyValue("Selisih", "${fmtLiter(v.variance, 1)} · ${fmtNum(v.variancePct, 2)}%", if (v.investigate) p.bad else p.ok)
                KeyValue("Ambang", "maks(${fmtNum(pct, 2)}%, ${fmtNum(minL, 0)} L) = ${fmtLiter(v.threshold, 1)}")
            }
            Text("Angka akhir dihitung server dari semua transaksi lokasi ini.", style = Type.small, color = p.muted)
        }
        if (v?.investigate == true) {
            Banner("Selisih melewati ambang. Status \"Perlu investigasi\" dikirim ke dashboard.", Tone.WARN)
            TextBox("Alasan / keterangan (wajib)", reason, { reason = it; error = null })
        }
    }
}
