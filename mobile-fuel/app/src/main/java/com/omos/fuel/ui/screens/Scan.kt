package com.omos.fuel.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.omos.fuel.data.Location
import com.omos.fuel.scan.QrScanner
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.Chips
import com.omos.fuel.ui.Drafts
import com.omos.fuel.ui.Lookup
import com.omos.fuel.ui.ScanTarget
import com.omos.fuel.ui.Screen
import com.omos.fuel.ui.TextBox
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.p
import com.omos.fuel.ui.rememberRepo

private fun titleOf(purpose: String) = when (purpose) {
    Purpose.UNIT -> "Arahkan ke QR / barcode unit"
    Purpose.SOURCE -> "Pindai lokasi sumber (fuel truck / tangki)"
    Purpose.TRANSFER_FROM -> "Pindai lokasi asal transfer"
    Purpose.TRANSFER_TO -> "Pindai lokasi tujuan transfer"
    Purpose.RECEIPT_TO -> "Pindai tangki penerima"
    else -> "Pindai lokasi opname"
}

/** Lokasi wajib termasuk penugasan akun, kecuali tujuan transfer. */
private fun needsAssignment(purpose: String) = purpose != Purpose.TRANSFER_TO

@Composable
fun ScanScreen(purpose: String, onBack: () -> Unit, onUnit: () -> Unit, onManual: () -> Unit) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    val officer = repo.session.state.collectAsState().value.officer
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var torch by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var listMode by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (!granted) askCamera.launch(Manifest.permission.CAMERA) }

    fun acceptLocation(l: Location) {
        if (needsAssignment(purpose) && !Lookup.allowedLocation(officer, l.id)) {
            message = "${l.locationCode} tidak ditugaskan ke akun Anda. Hubungi admin Fuel."; return
        }
        if (purpose == Purpose.SOURCE) repo.session.sourceLocationId = l.id else Drafts.picked[purpose] = l.id
        onBack()
    }

    fun handle(raw: String) {
        val target = if (purpose == Purpose.UNIT) Lookup.resolveUnit(b, raw) else Lookup.resolve(b, raw)
        when (target) {
            is ScanTarget.Machine -> if (purpose == Purpose.UNIT) {
                Drafts.unitId = target.equipment.id; Drafts.unitInput = "scan"; Drafts.manualReason = null; onUnit()
            } else message = "${target.equipment.kodeAlat} adalah unit, bukan lokasi penyimpanan."
            is ScanTarget.Place -> if (purpose == Purpose.UNIT) message = "Ini label lokasi ${target.location.locationCode}, bukan unit." else acceptLocation(target.location)
            is ScanTarget.Revoked -> message = "ID ${target.scanId} sudah dicabut (stiker diganti). Minta label baru ke admin."
            is ScanTarget.Unknown -> message = if (b == null) "Data master belum ada di HP. Cari sinyal dulu." else "Bukan label OMOS atau ID tidak dikenal."
        }
    }

    if (listMode) {
        LocationPicker(purpose, b?.locations.orEmpty(), officer?.locationIds.orEmpty(), onBack = { listMode = false }) { acceptLocation(it) }
        return
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF06090D))) {
        if (granted) QrScanner(Modifier.fillMaxSize(), torch) { handle(it) }
        Box(Modifier.align(Alignment.Center).size(240.dp).border(4.dp, Color(0xFF35C39B), RoundedCornerShape(18.dp)))
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Pillish("← Batal", onBack)
            Pillish(if (torch) "Senter: nyala" else "Senter: mati") { torch = !torch }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(titleOf(purpose), style = Type.title, color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Text("Bekerja tanpa sinyal", style = Type.small, color = Color(0xFFB8C4D4), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            if (!granted) Banner("Izin kamera ditolak. Pilih manual, atau izinkan kamera di Pengaturan HP.", Tone.WARN)
            message?.let { Banner(it, Tone.BAD) }
            BigButton(if (purpose == Purpose.UNIT) "Pilih unit manual" else "Pilih lokasi dari daftar", primary = false) {
                if (purpose == Purpose.UNIT) onManual() else listMode = true
            }
        }
    }
}

@Composable
private fun Pillish(text: String, onClick: () -> Unit) {
    Text(text, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = Color.White,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0x33FFFFFF)).clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp))
}

@Composable
private fun LocationPicker(purpose: String, locations: List<Location>, allowed: List<String>, onBack: () -> Unit, onPick: (Location) -> Unit) {
    val list = if (needsAssignment(purpose)) locations.filter { it.id in allowed } else locations
    Screen("Pilih lokasi", subtitle = titleOf(purpose), onBack = onBack) {
        if (list.isEmpty()) Banner("Belum ada lokasi yang ditugaskan ke akun Anda.", Tone.WARN)
        list.forEach { l ->
            Box(Modifier.clickable(role = Role.Button) { onPick(l) }) {
                Card {
                    Text(l.locationCode ?: "-", style = Type.title, color = p.ink)
                    Text("${Lookup.storageLabel(l.storageType)} · ${l.locationName ?: ""}", style = Type.small, color = p.muted)
                }
            }
        }
    }
}

/** Unit manual bila QR tidak terbaca — alasan wajib, ditandai untuk review admin. */
@Composable
fun ManualPickScreen(onBack: () -> Unit, onPicked: () -> Unit) {
    val repo = rememberRepo()
    val b by repo.observeBootstrap().collectAsState(initial = null)
    var q by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val units = b?.equipment.orEmpty().filter { q.isBlank() || (it.kodeAlat ?: "").contains(q.trim(), ignoreCase = true) }.take(40)
    Screen("Pilih unit manual", subtitle = "QR tidak terbaca", onBack = onBack, footer = {
        BigButton("Lanjut", enabled = picked != null) {
            if (reason == null) { error = "Pilih alasan input manual."; return@BigButton }
            Drafts.unitId = picked; Drafts.unitInput = "manual"; Drafts.manualReason = reason
            onPicked()
        }
    }) {
        TextBox("Cari kode unit", q, { q = it })
        Text("Alasan input manual (wajib)", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.ink)
        Chips(listOf("stiker_rusak" to "Stiker rusak", "tidak_ada" to "Tidak ada", "kamera" to "Kamera"), reason) { reason = it; error = null }
        Text("Pengisian manual ditandai untuk diperiksa admin.", style = Type.small, color = p.muted)
        error?.let { Banner(it, Tone.BAD) }
        units.forEach { e ->
            val on = e.id == picked
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (on) p.primarySoft else p.surface)
                    .border(1.5.dp, if (on) p.primary else p.line, RoundedCornerShape(14.dp)).clickable(role = Role.RadioButton) { picked = e.id }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(e.kodeAlat ?: "-", style = Type.title, color = p.ink)
                    Text(listOfNotNull(e.kelasAlat, e.classUnit).joinToString(" · "), style = Type.small, color = p.muted)
                }
                if (on) Text("Dipilih", style = Type.small, color = p.primary)
            }
        }
    }
}
