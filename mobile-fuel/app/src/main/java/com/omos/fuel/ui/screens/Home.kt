package com.omos.fuel.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Straighten
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.omos.fuel.data.FuelRules
import com.omos.fuel.data.ItemType
import com.omos.fuel.data.db.OutboxEntity
import com.omos.fuel.data.db.OutboxStatus
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.KeyValue
import com.omos.fuel.ui.Lookup
import com.omos.fuel.ui.Pill
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.fmtLiter
import com.omos.fuel.ui.p
import com.omos.fuel.ui.rememberRepo
import kotlinx.coroutines.launch
import java.time.Instant

object R {
    const val HOME = "home"
    const val SCAN = "scan"
    const val MANUAL = "manual"
    const val FILL = "fill"
    const val SAVED = "saved"
    const val TRANSFER = "transfer"
    const val RECEIPT = "receipt"
    const val OPNAME = "opname"
    const val OPEN_SHIFT = "open_shift"
    const val CLOSE_SHIFT = "close_shift"
    const val HISTORY = "history"
    const val ACCOUNT = "account"
    const val CHANGE_PIN = "change_pin"
}

/** Tujuan pindai: unit penerima atau lokasi untuk form tertentu. */
object Purpose {
    const val UNIT = "unit"
    const val SOURCE = "source"
    const val TRANSFER_FROM = "transfer_from"
    const val TRANSFER_TO = "transfer_to"
    const val RECEIPT_TO = "receipt_to"
    const val OPNAME_AT = "opname_at"
}

/** Sesi shift terbuka untuk lokasi: dari server, atau buka shift di HP yang belum terkirim. */
data class OpenShiftInfo(val sessionId: String?, val clientUuid: String?, val openedAt: Instant, val totalizerOpen: Double)

fun openShiftFor(locationId: String?, server: List<com.omos.fuel.data.OpenSession>?, outbox: List<OutboxEntity>, payloadOf: (OutboxEntity) -> Map<String, Any?>): OpenShiftInfo? {
    if (locationId == null) return null
    val closedLocal = outbox.filter { it.type == ItemType.SHIFT_CLOSE && it.status != OutboxStatus.REJECTED }
        .mapNotNull { payloadOf(it)["session_client_uuid"]?.toString() ?: payloadOf(it)["session_id"]?.toString() }.toSet()
    server?.firstOrNull { it.locationId == locationId }?.let { s ->
        if (s.id !in closedLocal && s.clientUuid !in closedLocal) {
            return OpenShiftInfo(s.id, s.clientUuid, s.openedAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: Instant.now(), s.totalizerOpen ?: 0.0)
        }
    }
    val local = outbox.filter { it.type == ItemType.SHIFT_OPEN && it.status != OutboxStatus.REJECTED && payloadOf(it)["location_id"] == locationId }
        .maxByOrNull { it.createdAt } ?: return null
    if (local.clientUuid in closedLocal) return null
    val pl = payloadOf(local)
    return OpenShiftInfo(null, local.clientUuid, runCatching { Instant.parse(pl["opened_at"].toString()) }.getOrDefault(Instant.ofEpochMilli(local.createdAt)),
        (pl["totalizer_open"] as? Number)?.toDouble() ?: 0.0)
}

@Composable
fun HomeScreen(nav: (String) -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val session by repo.session.state.collectAsState()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val outbox by repo.observeOutbox().collectAsState(initial = emptyList())
    val unsentOut by repo.observeUnsentOut().collectAsState(initial = emptyMap())
    val sync by repo.sync.collectAsState()
    val officer = session.officer
    LaunchedEffect(session.userId) { runCatching { repo.refreshBootstrap() } }

    val sourceId = repo.session.sourceLocationId
    val source = Lookup.location(b, sourceId)
    val productId = Lookup.defaultProductId(b)
    val stockRow = b?.stock?.firstOrNull { it.locationId == sourceId && (productId == null || it.productId == productId) }
    val estimate = if (source != null) FuelRules.stockEstimate(stockRow, unsentOut[sourceId] ?: 0.0) else null
    val open = openShiftFor(sourceId, b?.openSessions, outbox) { repo.payloadOf(it) }
    val slot = FuelRules.operationalSlot(Instant.now())
    val slotStart = FuelRules.shiftStart(slot.operationalDate, slot.shiftKind).toEpochMilli()
    val fills = outbox.filter { it.type == ItemType.FILL && it.createdAt >= slotStart && it.status != OutboxStatus.REJECTED }
    val pending = outbox.count { it.status == OutboxStatus.WAITING || it.status == OutboxStatus.SENDING }
    val rejected = outbox.count { it.status == OutboxStatus.REJECTED || it.serverStatus == "rejected" }

    Column(Modifier.fillMaxSize().background(p.bg)) {
        Column(Modifier.fillMaxWidth().background(p.header).statusBarsPadding().padding(horizontal = 18.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(Lookup.shiftLabel(b), style = Type.small, color = Color(0xFFB8C4D4))
                    Text(officer?.nama ?: "-", style = Type.display, color = Color.White)
                }
                Text("Ganti petugas", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = Color.White,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0x33FFFFFF)).clickable(role = Role.Button) { repo.lock() }
                        .padding(horizontal = 12.dp, vertical = 6.dp))
            }
            Text(
                (if (sync.online) "● Online" else "● Offline") + " · $pending antre" + if (sync.running) " · mengirim…" else "",
                style = Type.small, color = if (sync.online) Color(0xFF7FE0BE) else Color(0xFFF5C26B), modifier = Modifier.padding(top = 4.dp),
            )
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (b == null) Banner("Data master belum tersedia di HP ini. Cari sinyal lalu tarik ulang (Akun → Segarkan data).", Tone.WARN)
            if (rejected > 0) Box(Modifier.clickable { nav(R.HISTORY) }) { Banner("$rejected transaksi ditolak. Ketuk untuk melihat alasan.", Tone.BAD) }

            Card {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Sumber · ${Lookup.locationLabel(source)}", style = Type.small, color = p.muted)
                        Text(if (estimate != null) fmtLiter(estimate) else "Pilih lokasi sumber", style = Type.big, color = p.ink)
                    }
                    if (open != null) Pill("Shift dibuka", Tone.OK) else if (source != null) Pill("Shift belum dibuka", Tone.WARN)
                }
                if (stockRow != null && (stockRow.pendingInLiter ?: 0.0) > 0) {
                    Text("Termasuk ${fmtLiter(stockRow.pendingInLiter)} masuk yang belum divalidasi admin.", style = Type.small, color = p.warn)
                }
                if ((unsentOut[sourceId] ?: 0.0) > 0) Text("Dikurangi ${fmtLiter(unsentOut[sourceId])} keluar yang belum terkirim.", style = Type.small, color = p.muted)
                source?.capacityLiter?.let { cap -> if (estimate != null) KeyValue("Kapasitas", "${fmtLiter(cap)} · min ${fmtLiter(source.minimumStockLiter)}") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmallAction(if (source == null) "Pindai lokasi sumber" else "Ganti sumber") { nav("${R.SCAN}/${Purpose.SOURCE}") }
                    if (Lookup.allowed(officer, "shift") && source != null) {
                        SmallAction(if (open == null) "Buka shift" else "Tutup shift") { nav(if (open == null) R.OPEN_SHIFT else R.CLOSE_SHIFT) }
                    }
                }
            }

            if (Lookup.allowed(officer, "fill")) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 80.dp).clip(RoundedCornerShape(18.dp)).background(if (source != null) p.primary else p.line)
                        .clickable(enabled = source != null, role = Role.Button) { nav("${R.SCAN}/${Purpose.UNIT}") }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x2EFFFFFF)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.QrCodeScanner, null, tint = p.onPrimary, modifier = Modifier.size(28.dp))
                    }
                    Column {
                        Text("Isi unit", style = Type.display, color = if (source != null) p.onPrimary else p.muted)
                        Text(if (source != null) "Pindai QR unit untuk mulai" else "Pilih lokasi sumber dulu", style = Type.small,
                            color = if (source != null) p.onPrimary else p.muted)
                    }
                }
            }

            val tiles = buildList {
                if (Lookup.allowed(officer, "transfer")) add(Triple("Transfer", "Antar lokasi", Icons.Filled.SwapHoriz) to R.TRANSFER)
                if (Lookup.allowed(officer, "receipt")) add(Triple("Terima fuel", "Dari transportir", Icons.Filled.Inventory) to R.RECEIPT)
                if (Lookup.allowed(officer, "opname")) add(Triple("Opname", "Ukur stok fisik", Icons.Filled.Straighten) to R.OPNAME)
                if (Lookup.allowed(officer, "shift") && open != null) add(Triple("Tutup shift", "Totalizer akhir", Icons.Filled.Lock) to R.CLOSE_SHIFT)
            }
            tiles.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { (t, route) -> Tile(t.first, t.second, t.third, Modifier.weight(1f)) { nav(route) } }
                    if (row.size == 1) Box(Modifier.weight(1f))
                }
            }

            Card {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Shift ini (HP ini)", style = Type.title, color = p.ink)
                    Text("${fills.size} pengisian", style = Type.small, color = p.muted)
                }
                KeyValue("Total keluar", fmtLiter(fills.sumOf { it.liter }))
                KeyValue("Belum tersinkron", "$pending transaksi", if (pending > 0) p.warn else p.ink)
                if (pending > 0) BigButton(if (sync.running) "Mengirim…" else "Kirim sekarang", primary = false, enabled = !sync.running, height = 46.dp) {
                    scope.launch { repo.retryNow() }
                }
                sync.lastError?.let { Text(it, style = Type.small, color = p.bad) }
            }
        }
        BottomNav(R.HOME, nav)
    }
}

@Composable
private fun SmallAction(text: String, onClick: () -> Unit) {
    Text(text, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.info,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(p.infoBg).clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp))
}

@Composable
private fun Tile(title: String, sub: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 96.dp).clip(RoundedCornerShape(16.dp)).background(p.surface).border(1.dp, p.line, RoundedCornerShape(16.dp))
            .clickable(role = Role.Button, onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(p.primarySoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = p.primary, modifier = Modifier.size(20.dp))
        }
        Text(title, style = Type.title, color = p.ink)
        Text(sub, style = Type.small, color = p.muted)
    }
}

@Composable
fun BottomNav(current: String, nav: (String) -> Unit) {
    val items = listOf(
        Triple(R.HOME, "Beranda", Icons.Filled.Home),
        Triple("${R.SCAN}/${Purpose.UNIT}", "Pindai", Icons.Filled.QrCodeScanner),
        Triple(R.HISTORY, "Riwayat", Icons.AutoMirrored.Filled.List),
        Triple(R.ACCOUNT, "Akun", Icons.Filled.Person),
    )
    Row(Modifier.fillMaxWidth().background(p.surface).border(1.dp, p.line).navigationBarsPadding().height(64.dp)) {
        items.forEach { (route, label, icon) ->
            val on = route == current
            Column(
                Modifier.weight(1f).fillMaxSize().clickable(role = Role.Tab) { if (!on) nav(route) },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Icon(icon, label, tint = if (on) p.primary else p.muted, modifier = Modifier.size(24.dp))
                Text(label, style = Type.small.copy(fontWeight = if (on) FontWeight.Bold else FontWeight.Normal), color = if (on) p.primary else p.muted)
            }
        }
    }
}
