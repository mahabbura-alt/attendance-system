package com.omos.safety.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.omos.safety.BuildConfig
import com.omos.safety.data.friendlyMessage
import com.omos.safety.sync.SyncWorker
import com.omos.safety.ui.BigButton
import com.omos.safety.ui.Field
import com.omos.safety.ui.Hint
import com.omos.safety.ui.Notice
import com.omos.safety.ui.Screen
import com.omos.safety.ui.Tone
import com.omos.safety.ui.Type
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberRepo
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onForgot: () -> Unit, expiredNotice: Boolean) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var id by rememberSaveable { mutableStateOf(repo.session.state.value.employeeId ?: "") }
    var pass by rememberSaveable { mutableStateOf("") }
    var loading by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    com.omos.safety.ui.StatusBarIcons(darkBackground = true)
    Column(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(0f to p.header, 0.3f to p.header, 0.3f to p.bg, 1f to p.bg)).statusBarsPadding().imePadding().verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(p.accent), contentAlignment = Alignment.Center) {
                Text("!", style = Type.display.copy(fontSize = 30.sp), color = p.header)
            }
            Text("OMOS Safety", style = Type.display.copy(fontSize = 30.sp), color = p.headerText, modifier = Modifier.padding(top = 12.dp))
            Text("Lapor hazard, insiden, inspeksi, dan P5M — tetap jalan tanpa sinyal.", style = Type.body, color = p.headerMuted)
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(p.bg).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (expiredNotice) Notice("Sesi login berakhir. Masuk lagi — data yang belum terkirim tetap aman di HP.", Tone.WARN)
            Field(id, { id = it.trim() }, label = "Employee ID", placeholder = "mis. EMP-0001")
            Field(pass, { pass = it }, label = "Sandi", password = true, keyboard = KeyboardType.Password)
            error?.let { Notice(it, Tone.DANGER) }
            BigButton("Masuk", {
                error = null
                if (id.isBlank() || pass.isBlank()) { error = "Isi Employee ID dan sandi."; return@BigButton }
                loading = true
                scope.launch {
                    repo.login(id, pass).onSuccess { SyncWorker.runNow(repo.appContext) }.onFailure { error = it.friendlyMessage() }
                    loading = false
                }
            }, loading = loading)
            Text(
                "Lupa sandi? Minta reset ke admin", style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.green,
                modifier = Modifier.clickable(role = Role.Button, onClick = onForgot).padding(vertical = 10.dp),
            )
            Hint("Pakai akun OMOS yang sama dengan aplikasi absensi. Versi ${BuildConfig.VERSION_NAME}")
        }
    }
}

@Composable
fun ForgotScreen(onBack: () -> Unit) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var id by rememberSaveable { mutableStateOf("") }
    var loading by rememberSaveable { mutableStateOf(false) }
    var done by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    Screen("Lupa Sandi", "Minta reset ke admin", onBack = onBack) {
        Notice("Karyawan lapangan tidak memakai email. Permintaan dikirim ke admin; admin memberi sandi sementara langsung (tatap muka/atasan). Setelah masuk, Anda wajib mengganti sandi.")
        Field(id, { id = it.trim() }, label = "Employee ID")
        error?.let { Notice(it, Tone.DANGER) }
        done?.let { Notice(it, Tone.OK, title = "Permintaan terkirim") }
        BigButton("Kirim permintaan", {
            error = null
            if (id.isBlank()) { error = "Isi Employee ID."; return@BigButton }
            loading = true
            scope.launch {
                repo.requestReset(id).onSuccess { done = it }.onFailure { error = it.friendlyMessage() }
                loading = false
            }
        }, loading = loading, enabled = done == null)
        Hint("Butuh sinyal internet. Bila tidak ada sinyal, temui admin/atasan secara langsung.")
    }
}

@Composable
fun ChangePasswordScreen(forced: Boolean, onDone: () -> Unit, onBack: (() -> Unit)?) {
    val repo = rememberRepo()
    val scope = rememberCoroutineScope()
    var old by rememberSaveable { mutableStateOf("") }
    var new1 by rememberSaveable { mutableStateOf("") }
    var new2 by rememberSaveable { mutableStateOf("") }
    var loading by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    Screen(if (forced) "Ganti Sandi Sementara" else "Ganti Sandi", if (forced) "Wajib sebelum memakai aplikasi" else null, onBack = onBack) {
        if (forced) Notice("Anda masuk memakai sandi sementara dari admin. Buat sandi baru yang hanya Anda ketahui.", Tone.WARN)
        Field(old, { old = it }, label = if (forced) "Sandi sementara" else "Sandi lama", password = true, keyboard = KeyboardType.Password)
        Field(new1, { new1 = it }, label = "Sandi baru (min. 8 karakter)", password = true, keyboard = KeyboardType.Password)
        Field(new2, { new2 = it }, label = "Ulangi sandi baru", password = true, keyboard = KeyboardType.Password)
        error?.let { Notice(it, Tone.DANGER) }
        BigButton("Simpan sandi baru", {
            error = when {
                new1.length < 8 -> "Sandi baru minimal 8 karakter."
                new1 != new2 -> "Ulangi sandi baru tidak sama."
                new1 == old -> "Sandi baru harus berbeda."
                else -> null
            }
            if (error != null) return@BigButton
            loading = true
            scope.launch {
                repo.changePassword(old, new1).onSuccess { onDone() }.onFailure { error = it.friendlyMessage() }
                loading = false
            }
        }, loading = loading)
        if (forced) Text("Keluar", style = Type.body, color = p.red, modifier = Modifier.clickable { repo.logout() }.padding(8.dp))
    }
}
