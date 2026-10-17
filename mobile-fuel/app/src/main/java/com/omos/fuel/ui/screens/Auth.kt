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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalGasStation
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.omos.fuel.data.LoginOutcome
import com.omos.fuel.data.OfflinePin
import com.omos.fuel.data.friendlyMessage
import com.omos.fuel.ui.Banner
import com.omos.fuel.ui.BigButton
import com.omos.fuel.ui.Card
import com.omos.fuel.ui.KeyValue
import com.omos.fuel.ui.Pill
import com.omos.fuel.ui.Screen
import com.omos.fuel.ui.TextBox
import com.omos.fuel.ui.Tone
import com.omos.fuel.ui.Type
import com.omos.fuel.ui.p
import com.omos.fuel.ui.rememberRepo
import kotlinx.coroutines.launch

/** Login Employee ID + PIN 6 digit. Tanpa sinyal → buka offline (≤ N hari sejak login online). */
@Composable
fun LoginScreen(expired: Boolean) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    val known = remember { repo.session.officers() }
    var employeeId by remember { mutableStateOf(repo.session.state.value.officer?.employeeId ?: known.lastOrNull()?.employeeId ?: "") }
    var pin by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingCode by remember { mutableStateOf<String?>(null) }
    val deviceCode = repo.session.state.value.deviceCode

    fun submit() {
        if (employeeId.isBlank()) { error = "Isi Employee ID."; return }
        if (!OfflinePin.validFormat(pin)) { error = "PIN harus 6 digit."; return }
        busy = true; error = null
        scope.launch {
            when (val r = repo.login(employeeId, pin)) {
                LoginOutcome.Online, LoginOutcome.Offline -> pendingCode = null
                is LoginOutcome.DevicePending -> pendingCode = r.deviceCode ?: "-"
                is LoginOutcome.Failed -> { error = r.message; pin = "" }
            }
            busy = false
        }
    }

    if (pendingCode != null) {
        DevicePending(pendingCode!!, busy, onRetry = { submit() }, onBack = { pendingCode = null; pin = "" })
        return
    }

    Column(
        Modifier.fillMaxSize().background(p.bg).statusBarsPadding().navigationBarsPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(p.primarySoft), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.LocalGasStation, null, tint = p.primary, modifier = Modifier.size(34.dp))
            }
            Text("OMOS Fuel", style = Type.display, color = p.ink, modifier = Modifier.padding(top = 8.dp))
            Text(if (deviceCode != null) "Perangkat $deviceCode" else "Perangkat belum terdaftar", style = Type.small, color = p.muted)
        }
        if (expired) Banner("Sesi berakhir. Masuk lagi dengan PIN; data di HP tetap aman.", Tone.WARN)
        TextBox("Employee ID", employeeId, { employeeId = it; error = null })
        Text("PIN 6 digit", style = Type.small, color = p.ink)
        Row(Modifier.fillMaxWidth().semantics { contentDescription = "${pin.length} dari 6 digit PIN" },
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
            repeat(6) { i ->
                Box(Modifier.size(16.dp).clip(CircleShape).background(if (i < pin.length) p.primary else p.surface).border(2.dp, if (i < pin.length) p.primary else p.line, CircleShape))
            }
        }
        PinPad(
            onDigit = { d -> if (pin.length < 6) { pin += d; error = null } },
            onDelete = { pin = pin.dropLast(1) },
            onSubmit = { submit() }, busy = busy,
        )
        error?.let { Banner(it, Tone.BAD) }
        Text("Tanpa sinyal: PIN tetap bisa dipakai bila Anda pernah login online di perangkat ini dalam ${known.firstOrNull()?.offlinePinDays ?: 7} hari terakhir.",
            style = Type.small, color = p.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
fun PinPad(onDigit: (String) -> Unit, onDelete: () -> Unit, onSubmit: () -> Unit, busy: Boolean, submitLabel: String = "Masuk") {
    val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "DEL", "0", "OK")
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        keys.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { k ->
                    val primary = k == "OK"
                    Box(
                        Modifier.weight(1f).height(62.dp).clip(RoundedCornerShape(16.dp))
                            .background(if (primary) p.primary else p.surface).border(1.dp, if (primary) p.primary else p.line, RoundedCornerShape(16.dp))
                            .clickable(enabled = !busy, role = Role.Button) { when (k) { "DEL" -> onDelete(); "OK" -> onSubmit(); else -> onDigit(k) } },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            when (k) { "DEL" -> "Hapus"; "OK" -> if (busy) "…" else submitLabel; else -> k },
                            style = if (k.length == 1) Type.big else Type.button,
                            color = if (primary) p.onPrimary else p.ink,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DevicePending(code: String, busy: Boolean, onRetry: () -> Unit, onBack: () -> Unit) {
    Screen("Perangkat belum disetujui", onBack = onBack, footer = {
        BigButton(if (busy) "Memeriksa…" else "Periksa lagi", enabled = !busy, onClick = onRetry)
    }) {
        Column(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(72.dp).clip(RoundedCornerShape(20.dp)).background(p.warnBg), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Lock, null, tint = p.warn, modifier = Modifier.size(36.dp))
            }
        }
        Text("Perangkat ini sudah didaftarkan. Minta admin Fuel menyetujuinya di Input Fuel → Akses Fuel → Perangkat.",
            style = Type.body, color = p.ink, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Card {
            KeyValue("Kode perangkat", code)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Status", style = Type.small, color = p.muted)
                Pill("Menunggu", Tone.WARN)
            }
        }
    }
}

/** Ganti PIN (wajib saat PIN masih sementara dari admin). */
@Composable
fun ChangePinScreen(forced: Boolean, onDone: () -> Unit, onBack: (() -> Unit)?) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Screen("Ganti PIN", subtitle = if (forced) "PIN sementara wajib diganti" else null, onBack = onBack, footer = {
        BigButton(if (busy) "Menyimpan…" else "Simpan PIN baru", enabled = !busy) {
            error = when {
                !OfflinePin.validFormat(old) -> "PIN lama harus 6 digit."
                !OfflinePin.validFormat(new) -> "PIN baru harus 6 digit."
                OfflinePin.isTrivial(new) -> "PIN terlalu mudah ditebak (angka sama/berurutan)."
                new != confirm -> "Konfirmasi PIN tidak sama."
                new == old -> "PIN baru harus berbeda."
                else -> null
            }
            if (error != null) return@BigButton
            busy = true
            scope.launch {
                repo.changePin(old, new).onSuccess { onDone() }.onFailure { error = it.friendlyMessage() }
                busy = false
            }
        }
        if (forced) BigButton("Keluar", primary = false) { repo.lock() }
    }) {
        if (forced) Banner("Ganti PIN sementara dari admin sebelum mencatat transaksi. Butuh sinyal.", Tone.INFO)
        TextBox("PIN lama", old, { old = it; error = null }, secret = true, digitsOnly = true)
        TextBox("PIN baru", new, { new = it; error = null }, secret = true, digitsOnly = true, help = "6 digit, bukan angka sama/berurutan")
        TextBox("Ulangi PIN baru", confirm, { confirm = it; error = null }, secret = true, digitsOnly = true)
        error?.let { Banner(it, Tone.BAD) }
    }
}
