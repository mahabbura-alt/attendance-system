package com.omos.fuel.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omos.fuel.data.Bootstrap
import com.omos.fuel.data.ItemType
import com.omos.fuel.data.PhotoRef
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.Chips
import com.omos.fuel.ui.Drafts
import com.omos.fuel.ui.Lookup
import com.omos.fuel.ui.NumberField
import com.omos.fuel.ui.PhotoSlots
import com.omos.fuel.ui.Pill
import com.omos.fuel.ui.Screen
import com.omos.fuel.ui.TextBox
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.fmtLiter
import com.omos.fuel.ui.missingRequired
import com.omos.fuel.ui.p
import com.omos.fuel.ui.parseDecimal
import com.omos.fuel.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.Instant

/** Kartu lokasi hasil pindai + tombol pindai ulang. */
@Composable
fun LocationField(label: String, b: Bootstrap?, locationId: String?, onScan: () -> Unit) {
    val l = Lookup.location(b, locationId)
    Card {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = Type.small, color = p.muted)
                Text(l?.let { Lookup.locationLabel(it) } ?: "Belum dipilih", style = Type.title, color = if (l == null) p.muted else p.ink)
            }
            if (l?.scanId != null || l?.equipmentScanId != null) Pill(l.equipmentScanId ?: l.scanId ?: "", Tone.OK)
        }
        BigButton(if (l == null) "Pindai lokasi" else "Pindai ulang", primary = false, height = 46.dp) { onScan() }
    }
}

@Composable
private fun ProductChooser(b: Bootstrap?, productId: String?, onPick: (String) -> Unit) {
    if ((b?.products?.size ?: 0) > 1) {
        Text("Produk", style = Type.small, color = p.ink)
        Chips(b?.products.orEmpty().map { it.id to (it.productCode ?: "-") }, productId, onPick)
    }
}

@Composable
fun TransferScreen(onBack: () -> Unit, onScan: (String) -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val from = Drafts.picked[Purpose.TRANSFER_FROM] ?: repo.session.sourceLocationId
    val to = Drafts.picked[Purpose.TRANSFER_TO]
    var qty by remember { mutableStateOf("") }
    var doc by remember { mutableStateOf("") }
    var productId by remember { mutableStateOf(Lookup.defaultProductId(b)) }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    val slots = Lookup.slots(b, "transfer")
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    Screen("Transfer fuel", subtitle = "Menunggu validasi admin setelah dikirim", onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Kirim transfer", enabled = !saving) {
            val v = parseDecimal(qty)
            error = when {
                from == null -> "Pindai lokasi asal."
                to == null -> "Pindai lokasi tujuan."
                from == to -> "Lokasi asal dan tujuan tidak boleh sama."
                v == null || v <= 0 -> "Isi jumlah transfer (> 0 liter)."
                (productId ?: Lookup.defaultProductId(b)) == null -> "Pilih produk fuel."
                missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
                else -> null
            }
            if (error != null) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(ItemType.TRANSFER,
                    "Transfer ${Lookup.location(b, from)?.locationCode} → ${Lookup.location(b, to)?.locationCode} · ${fmtLiter(v)}",
                    mapOf("from_location_id" to from, "to_location_id" to to, "product_id" to (productId ?: Lookup.defaultProductId(b)), "quantity_liter" to v,
                        "document_number" to doc.trim().ifBlank { null }, "transferred_at" to Instant.now().toString(),
                        "evidence_config_version" to b?.evidence?.version),
                    photos.values.toList(), liter = v!!, sourceLocationId = from)
                Drafts.picked.remove(Purpose.TRANSFER_FROM); Drafts.picked.remove(Purpose.TRANSFER_TO)
                saving = false
                onSaved(uuid)
            }
        }
    }) {
        LocationField("Dari", b, from) { onScan(Purpose.TRANSFER_FROM) }
        LocationField("Ke", b, to) { onScan(Purpose.TRANSFER_TO) }
        NumberField("Jumlah (liter)", qty, { qty = it; error = null })
        TextBox("No. surat jalan", doc, { doc = it })
        ProductChooser(b, productId ?: Lookup.defaultProductId(b)) { productId = it }
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
    }
}

@Composable
fun ReceiptScreen(onBack: () -> Unit, onScan: (String) -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val to = Drafts.picked[Purpose.RECEIPT_TO]
    var doc by remember { mutableStateOf("") }
    var transporter by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var productId by remember { mutableStateOf(Lookup.defaultProductId(b)) }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    val slots = Lookup.slots(b, "receipt")
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    Screen("Terima fuel", subtitle = "Menunggu validasi admin setelah dikirim", onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Kirim penerimaan", enabled = !saving) {
            val v = parseDecimal(qty)
            error = when {
                to == null -> "Pindai tangki penerima."
                doc.isBlank() -> "Isi nomor DO."
                v == null || v <= 0 -> "Isi jumlah diterima (> 0 liter)."
                (productId ?: Lookup.defaultProductId(b)) == null -> "Pilih produk fuel."
                missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
                else -> null
            }
            if (error != null) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(ItemType.RECEIPT, "Terima ${doc.trim()} · ${fmtLiter(v)}",
                    mapOf("destination_location_id" to to, "product_id" to (productId ?: Lookup.defaultProductId(b)), "quantity_liter" to v,
                        "document_number" to doc.trim(), "transporter" to transporter.trim().ifBlank { null },
                        "received_at" to Instant.now().toString(), "evidence_config_version" to b?.evidence?.version),
                    photos.values.toList())
                Drafts.picked.remove(Purpose.RECEIPT_TO)
                saving = false
                onSaved(uuid)
            }
        }
    }) {
        LocationField("Ke lokasi", b, to) { onScan(Purpose.RECEIPT_TO) }
        TextBox("No. DO", doc, { doc = it; error = null })
        TextBox("Transportir", transporter, { transporter = it })
        NumberField("Jumlah diterima (liter)", qty, { qty = it; error = null })
        ProductChooser(b, productId ?: Lookup.defaultProductId(b)) { productId = it }
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
    }
}

@Composable
fun OpnameScreen(onBack: () -> Unit, onScan: (String) -> Unit, onSaved: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val at = Drafts.picked[Purpose.OPNAME_AT]
    var qty by remember { mutableStateOf("") }
    var method by remember { mutableStateOf("dipstick") }
    var note by remember { mutableStateOf("") }
    var productId by remember { mutableStateOf(Lookup.defaultProductId(b)) }
    val photos = remember { mutableStateMapOf<String, PhotoRef>() }
    val slots = Lookup.slots(b, "opname")
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    Screen("Opname fisik", subtitle = "Disetujui oleh pengguna berbeda", onBack = onBack, footer = {
        error?.let { Banner(it, Tone.BAD) }
        BigButton(if (saving) "Menyimpan…" else "Kirim opname", enabled = !saving) {
            val v = parseDecimal(qty)
            error = when {
                at == null -> "Pindai lokasi yang diukur."
                v == null || v < 0 -> "Isi stok fisik terukur (≥ 0 liter)."
                (productId ?: Lookup.defaultProductId(b)) == null -> "Pilih produk fuel."
                missingRequired(slots, photos).isNotEmpty() -> "Foto wajib belum lengkap: ${missingRequired(slots, photos).joinToString(", ")}."
                else -> null
            }
            if (error != null) return@BigButton
            saving = true
            scope.launch {
                val uuid = repo.enqueue(ItemType.OPNAME, "Opname ${Lookup.location(b, at)?.locationCode} · ${fmtLiter(v)}",
                    mapOf("location_id" to at, "product_id" to (productId ?: Lookup.defaultProductId(b)), "physical_quantity" to v, "measurement_method" to method,
                        "note" to note.trim().ifBlank { null }, "counted_at" to Instant.now().toString(),
                        "evidence_config_version" to b?.evidence?.version),
                    photos.values.toList())
                Drafts.picked.remove(Purpose.OPNAME_AT)
                saving = false
                onSaved(uuid)
            }
        }
    }) {
        LocationField("Lokasi", b, at) { onScan(Purpose.OPNAME_AT) }
        NumberField("Stok fisik terukur (liter)", qty, { qty = it; error = null })
        Text("Metode", style = Type.small, color = p.ink)
        Chips(listOf("dipstick" to "Dipstick", "sounding" to "Sounding", "flow_meter" to "Flow meter"), method) { method = it }
        TextBox("Catatan", note, { note = it })
        ProductChooser(b, productId ?: Lookup.defaultProductId(b)) { productId = it }
        PhotoSlots(slots, photos, { photos[it.slot] = it; error = null })
    }
}
