package com.omos.fuel.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.omos.fuel.App
import com.omos.fuel.data.EvidenceSlot
import com.omos.fuel.data.PhotoRef
import com.omos.fuel.data.Repo
import java.io.File
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

private val ID = Locale("id", "ID")

@Composable
fun rememberRepo(): Repo {
    val ctx = LocalContext.current
    return remember { App.repo(ctx) }
}

/** Angka lapangan: koma atau titik sebagai desimal, tanpa pemisah ribuan. */
fun parseDecimal(raw: String): Double? {
    val s = raw.trim().replace(',', '.')
    if (s.isEmpty() || s.count { it == '.' } > 1) return null
    return s.toDoubleOrNull()?.takeIf { it.isFinite() }
}

fun fmtNum(v: Double?, digits: Int = 1): String =
    if (v == null) "—" else NumberFormat.getNumberInstance(ID).apply { maximumFractionDigits = digits }.format(v)

fun fmtLiter(v: Double?, digits: Int = 0): String = if (v == null) "—" else "${fmtNum(v, digits)} L"

// ------------------------------------------------------------------ Kerangka layar

@Composable
fun Screen(
    title: String, subtitle: String? = null, onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Row(
            Modifier.fillMaxWidth().background(p.header).statusBarsPadding().padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Kembali", tint = Color.White) }
            else Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                if (subtitle != null) Text(subtitle, style = Type.small, color = Color(0xFFB8C4D4))
                Text(title, style = Type.display, color = Color.White)
            }
            actions()
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp), content = content,
        )
        if (footer != null) {
            Column(
                Modifier.fillMaxWidth().background(p.surface).border(BorderStroke(1.dp, p.line)).navigationBarsPadding().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp), content = footer,
            )
        }
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.surface)
            .border(1.dp, p.line, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp), content = content,
    )
}

@Composable
fun KeyValue(label: String, value: String, valueColor: Color = p.ink) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = Type.small, color = p.muted)
        Text(value, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = valueColor, textAlign = TextAlign.End)
    }
}

@Composable
fun BigButton(text: String, modifier: Modifier = Modifier, primary: Boolean = true, enabled: Boolean = true, height: Dp = 56.dp, onClick: () -> Unit) {
    val bg = if (!enabled) p.line else if (primary) p.primary else p.surface
    val fg = if (!enabled) p.muted else if (primary) p.onPrimary else p.ink
    Box(
        modifier.fillMaxWidth().heightIn(min = height).clip(RoundedCornerShape(14.dp)).background(bg)
            .border(1.dp, if (primary) bg else p.line, RoundedCornerShape(14.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Type.button, color = fg, textAlign = TextAlign.Center) }
}

enum class Tone { OK, WARN, BAD, INFO, MUTED }

@Composable
fun toneColors(t: Tone): Pair<Color, Color> = when (t) {
    Tone.OK -> p.okBg to p.ok
    Tone.WARN -> p.warnBg to p.warn
    Tone.BAD -> p.badBg to p.bad
    Tone.INFO -> p.infoBg to p.info
    Tone.MUTED -> p.line to p.muted
}

@Composable
fun Pill(text: String, tone: Tone) {
    val (bg, fg) = toneColors(tone)
    Text(text, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 10.dp, vertical = 3.dp))
}

@Composable
fun Banner(text: String, tone: Tone) {
    val (bg, fg) = toneColors(tone)
    Text(text, style = Type.small, color = fg, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).padding(12.dp))
}

@Composable
fun Chips(options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.surface).border(1.dp, p.line, RoundedCornerShape(12.dp)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (on) p.primarySoft else Color.Transparent)
                    .clickable(role = Role.RadioButton) { onSelect(value) }.padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (on) p.primary else p.muted, textAlign = TextAlign.Center) }
        }
    }
}

/** Kolom angka besar (bisa dipakai bersarung tangan). Label di atas, bantuan & error di bawah. */
@Composable
fun NumberField(label: String, value: String, onChange: (String) -> Unit, help: String? = null, error: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.ink)
        OutlinedTextField(
            value = value, onValueChange = { v -> onChange(v.filter { it.isDigit() || it == ',' || it == '.' }) },
            singleLine = true, textStyle = Type.input.copy(color = p.ink), isError = error != null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = p.primary, unfocusedBorderColor = p.line),
        )
        if (error != null) Text(error, style = Type.small, color = p.bad)
        else if (help != null) Text(help, style = Type.small, color = p.muted)
    }
}

@Composable
fun TextBox(label: String, value: String, onChange: (String) -> Unit, help: String? = null, error: String? = null,
            secret: Boolean = false, digitsOnly: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.ink)
        OutlinedTextField(
            value = value, onValueChange = { v -> onChange(if (digitsOnly) v.filter { it.isDigit() }.take(6) else v) },
            singleLine = true, textStyle = Type.body.copy(color = p.ink), isError = error != null,
            visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (digitsOnly) KeyboardType.NumberPassword else KeyboardType.Text),
            modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = p.primary, unfocusedBorderColor = p.line),
        )
        if (error != null) Text(error, style = Type.small, color = p.bad)
        else if (help != null) Text(help, style = Type.small, color = p.muted)
    }
}

// ------------------------------------------------------------------ Foto bukti per slot

@SuppressLint("MissingPermission")
private fun lastLocation(ctx: Context): Pair<Double, Double>? {
    val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!granted) return null
    val lm = ctx.getSystemService(LocationManager::class.java) ?: return null
    return runCatching {
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }?.let { it.latitude to it.longitude }
    }.getOrNull()
}

/**
 * Slot foto sesuai konfigurasi server (wajib/opsional). Kamera bawaan, bukan galeri.
 * GPS hanya metadata bila izin lokasi diberikan (opsional, tidak divalidasi).
 */
@Composable
fun PhotoSlots(slots: List<EvidenceSlot>, photos: Map<String, PhotoRef>, onPhoto: (PhotoRef) -> Unit, error: String? = null) {
    val ctx = LocalContext.current
    val repo = rememberRepo()
    var pending by remember { mutableStateOf<Pair<String, File>?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val (slot, file) = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (!ok) { file.delete(); return@rememberLauncherForActivityResult }
        val loc = lastLocation(ctx)
        val ref = runCatching { repo.photos.importCameraFile(file, slot, Instant.now().toString(), loc?.first, loc?.second) }.getOrNull()
        if (ref == null) failed = "Foto gagal disimpan. Ambil ulang." else { failed = null; onPhoto(ref) }
    }
    val wajib = slots.count { it.isRequired == true }
    val terisi = slots.count { it.isRequired == true && photos.containsKey(it.slotCode) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Foto bukti", style = Type.title, color = p.ink)
            Text("$terisi / $wajib wajib", style = Type.small, color = if (terisi == wajib) p.ok else p.muted)
        }
        slots.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { slot ->
                    val ref = photos[slot.slotCode]
                    val thumb = remember(ref?.ref) { ref?.let { repo.photos.thumbnail(it.ref) } }
                    Box(
                        Modifier.weight(1f).aspectRatio(4f / 3f).clip(RoundedCornerShape(14.dp)).background(if (ref != null) p.okBg else p.surface)
                            .border(1.5.dp, if (ref != null) p.ok else p.line, RoundedCornerShape(14.dp))
                            .clickable(role = Role.Button) {
                                val (uri, file) = repo.photos.newCameraUri()
                                pending = slot.slotCode to file
                                camera.launch(uri)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (thumb != null) Image(thumb.asImageBitmap(), slot.label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Column(
                            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(if (thumb != null) Color(0xAA000000) else Color.Transparent).padding(6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            if (thumb == null) Icon(Icons.Filled.PhotoCamera, null, tint = p.muted, modifier = Modifier.size(24.dp))
                            Text(
                                (slot.label ?: slot.slotCode) + if (slot.isRequired == true) " *" else " (opsional)",
                                style = Type.small, color = if (thumb != null) Color.White else p.muted, textAlign = TextAlign.Center,
                            )
                            if (slot.captureSource == "camera_or_scan" && thumb == null) Text("kamera / foto dokumen", style = Type.small, color = p.muted)
                        }
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        (failed ?: error)?.let { Text(it, style = Type.small, color = p.bad) }
    }
}

fun missingRequired(slots: List<EvidenceSlot>, photos: Map<String, PhotoRef>): List<String> =
    slots.filter { it.isRequired == true && !photos.containsKey(it.slotCode) }.map { it.label ?: it.slotCode }
