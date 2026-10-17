package com.omos.safety.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.omos.safety.App
import com.omos.safety.data.Area
import com.omos.safety.data.Employee
import com.omos.safety.data.OnDutyPerson
import com.omos.safety.data.RiskRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

val p: Palette @Composable get() = LocalPalette.current

// ------------------------------------------------------------------ Kerangka layar

@Composable
fun Screen(
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    scroll: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    StatusBarIcons(darkBackground = false)
    Column(Modifier.fillMaxSize().background(p.bg).statusBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().background(p.surface).padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali", tint = p.ink)
                }
            } else Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = Type.display, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Text(subtitle, style = Type.small, color = p.muted, maxLines = 2)
            }
            trailing()
        }
        HorizontalDivider(color = p.border)
        val body = Modifier.weight(1f).fillMaxWidth()
        Column(
            if (scroll) body.verticalScroll(rememberScrollState()).padding(16.dp) else body.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            content = content,
        )
        if (footer != null) {
            HorizontalDivider(color = p.border)
            Column(
                Modifier.fillMaxWidth().background(p.surface).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = footer,
            )
        }
    }
}

@Composable
fun Label(text: String, required: Boolean = false, hint: String? = null) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(text, style = Type.title.copy(fontSize = 15.sp), color = p.ink)
        if (required) Text(" *", style = Type.title, color = p.red)
        if (hint != null) Text("  $hint", style = Type.tiny, color = p.muted)
    }
}

@Composable
fun Hint(text: String, color: Color = p.muted) = Text(text, style = Type.tiny, color = color)

@Composable
fun BigButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    container: Color = p.green, content: Color = Color.White, loading: Boolean = false, height: Dp = 56.dp,
) {
    val bg = if (enabled) container else p.border
    val fg = if (enabled) content else p.muted
    Box(
        modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(12.dp)).background(bg)
            .clickable(enabled = enabled && !loading, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(24.dp), color = fg, strokeWidth = 3.dp)
        else Text(text.uppercase(), style = Type.button, color = fg, textAlign = TextAlign.Center)
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = p.ink, border: Color = p.borderStrong, enabled: Boolean = true) {
    Box(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).border(1.5.dp, if (enabled) border else p.border, RoundedCornerShape(10.dp))
            .background(p.surface).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = if (enabled) color else p.muted, textAlign = TextAlign.Center) }
}

@Composable
fun Pill(text: String, bg: Color, fg: Color) {
    Text(
        text, style = Type.tiny.copy(fontWeight = FontWeight.Bold), color = fg,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
fun RiskPill(level: String?) = Pill(Risk.label(level), Risk.bg(level), Risk.fg(level))

@Composable
fun Card(modifier: Modifier = Modifier, border: Color = p.border, bg: Color = p.surface, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).border(1.dp, border, RoundedCornerShape(14.dp))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

enum class Tone { INFO, WARN, DANGER, OK }

@Composable
fun Notice(text: String, tone: Tone = Tone.INFO, title: String? = null) {
    val (bg, fg) = when (tone) {
        Tone.INFO -> p.blueBg to p.blue
        Tone.WARN -> p.amberBg to p.amberText
        Tone.DANGER -> p.redBg to p.redDark
        Tone.OK -> p.greenBg to p.green
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (title != null) Text(title, style = Type.small.copy(fontWeight = FontWeight.Bold), color = fg)
        Text(text, style = Type.small, color = fg)
    }
}

@Composable
fun Field(
    value: String, onChange: (String) -> Unit, label: String? = null, placeholder: String? = null,
    minLines: Int = 1, keyboard: KeyboardType = KeyboardType.Text, password: Boolean = false, modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value, onValueChange = onChange, modifier = modifier.fillMaxWidth(),
        label = label?.let { { Text(it) } }, placeholder = placeholder?.let { { Text(it, color = p.muted) } },
        minLines = minLines, singleLine = minLines == 1,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        textStyle = Type.body.copy(fontSize = 16.sp, color = p.ink),
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedBorderColor = p.borderStrong, focusedBorderColor = p.green,
            unfocusedContainerColor = p.surface, focusedContainerColor = p.surface,
        ),
    )
}

/** Pilihan besar 2 kolom (Kondisi/Tindakan, jenis kejadian, OK/Tidak OK). */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T?, onSelect: (T) -> Unit, columns: Int = 2, activeBg: Color = p.green, hints: Map<T, String> = emptyMap()) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (value, label) ->
                    val on = value == selected
                    Column(
                        Modifier.weight(1f).heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
                            .background(if (on) activeBg else p.surface)
                            .border(if (on) 2.dp else 1.5.dp, if (on) activeBg else p.borderStrong, RoundedCornerShape(12.dp))
                            .clickable(role = Role.RadioButton) { onSelect(value) }.padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(label, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = if (on) Color.White else p.ink)
                        hints[value]?.let { Text(it, style = Type.tiny, color = if (on) Color.White.copy(alpha = 0.85f) else p.muted) }
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, title: String, subtitle: String? = null, danger: Boolean = false) {
    val border = if (checked && danger) p.red else p.borderStrong
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (checked && danger) p.redBg else p.surface)
            .border(if (checked) 2.dp else 1.5.dp, border, RoundedCornerShape(12.dp))
            .clickable(role = Role.Checkbox) { onChange(!checked) }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked, onCheckedChange = onChange, colors = CheckboxDefaults.colors(checkedColor = if (danger) p.red else p.green))
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.body.copy(fontWeight = FontWeight.Bold), color = if (checked && danger) p.redDark else p.ink)
            if (subtitle != null) Text(subtitle, style = Type.tiny, color = if (checked && danger) p.redDark else p.muted)
        }
    }
}

// ------------------------------------------------------------------ Dropdown

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> Dropdown(label: String?, options: List<Pair<T, String>>, selected: T?, onSelect: (T) -> Unit, placeholder: String = "Pilih…") {
    var open by remember { mutableStateOf(false) }
    val text = options.firstOrNull { it.first == selected }?.second ?: ""
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = text, onValueChange = {}, readOnly = true, modifier = Modifier.menuAnchor().fillMaxWidth(),
            label = label?.let { { Text(it) } }, placeholder = { Text(placeholder, color = p.muted) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            textStyle = Type.body.copy(fontSize = 16.sp, color = p.ink), shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = p.borderStrong, focusedBorderColor = p.green,
                unfocusedContainerColor = p.surface, focusedContainerColor = p.surface),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, l) ->
                DropdownMenuItem(text = { Text(l, style = Type.body) }, onClick = { onSelect(v); open = false })
            }
        }
    }
}

/** Lokasi bertingkat Main Area → Sub Area (dari Setup Area di Master Setup HSE). */
@Composable
fun LocationPicker(areas: List<Area>, selectedId: String?, onSelect: (String) -> Unit, label: String = "Lokasi") {
    val options = areas.flatMap { a ->
        val subs = a.subs.orEmpty()
        if (subs.isEmpty()) listOf((a.id ?: "") to (a.name ?: "-"))
        else subs.map { s -> (s.id ?: "") to "${a.name} — ${s.name}" }
    }.filter { it.first.isNotBlank() }
    Dropdown(label, options, selectedId, onSelect, placeholder = "Pilih area → sub area")
}

fun locationName(areas: List<Area>?, id: String?): String {
    areas.orEmpty().forEach { a ->
        if (a.id == id) return a.name ?: "-"
        a.subs.orEmpty().forEach { s -> if (s.id == id) return "${a.name} — ${s.name}" }
    }
    return "-"
}

// ------------------------------------------------------------------ Tanggal & jam

@Composable
fun DateField(label: String, date: LocalDate, onChange: (LocalDate) -> Unit, modifier: Modifier = Modifier, max: LocalDate? = LocalDate.now()) {
    val ctx = LocalContext.current
    PickerBox(label, "%02d/%02d/%d".format(date.dayOfMonth, date.monthValue, date.year), modifier) {
        DatePickerDialog(ctx, { _, y, m, d -> onChange(LocalDate.of(y, m + 1, d)) }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            if (max != null) datePicker.maxDate = max.toEpochDay() * 86_400_000L + 86_399_000L
        }.show()
    }
}

@Composable
fun TimeField(label: String, time: LocalTime, onChange: (LocalTime) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    PickerBox(label, "%02d:%02d".format(time.hour, time.minute), modifier) {
        TimePickerDialog(ctx, { _, h, m -> onChange(LocalTime.of(h, m)) }, time.hour, time.minute, true).show()
    }
}

@Composable
private fun PickerBox(label: String, value: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = Type.tiny, color = p.muted2)
        Box(
            Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(12.dp)).background(p.surface)
                .border(1.5.dp, p.borderStrong, RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Text(value, style = Type.body.copy(fontSize = 16.sp), color = p.ink) }
    }
}

// ------------------------------------------------------------------ Foto

/**
 * Slot foto: ambil dari kamera (bukan galeri, agar bukti tidak memakai foto lama).
 * refs = referensi "local-photo:" yang sudah dikompres di HP.
 */
@Composable
fun PhotoSlots(refs: List<String>, onChange: (List<String>) -> Unit, max: Int = 3, minRequired: Int = 1, label: String = "Foto bukti") {
    val ctx = LocalContext.current
    val repo = remember { App.repo(ctx) }
    val scope = rememberCoroutineScope()
    var pendingFile by remember { mutableStateOf<File?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val storage = remember(refs.size) { repo.photos.storageInfo() }
    val critical = storage.freeBytes < 200L * 1024 * 1024
    val effectiveMax = if (critical) minOf(max, maxOf(1, refs.size)) else max
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = pendingFile
        pendingFile = null
        if (ok && f != null) scope.launch {
            val ref = withContext(Dispatchers.IO) { runCatching { repo.photos.importCameraFile(f) }.getOrNull() }
            if (ref != null) onChange(refs + ref) else error = "Foto gagal disimpan. Coba lagi."
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Label(label, required = minRequired > 0)
            Spacer(Modifier.weight(1f))
            Hint(if (minRequired > 0) "Wajib $minRequired · maks $effectiveMax" else "Opsional · maks $effectiveMax")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (i in 0 until max) {
                val ref = refs.getOrNull(i)
                Box(Modifier.weight(1f).height(80.dp)) {
                    when {
                        ref != null -> {
                            val bmp = remember(ref) { repo.photos.thumbnail(ref) }
                            if (bmp != null) Image(bmp.asImageBitmap(), contentDescription = "Foto ${i + 1}", contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)))
                            else Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(p.muted))
                            IconButton(
                                onClick = { repo.photos.delete(ref); onChange(refs - ref) },
                                modifier = Modifier.align(Alignment.TopEnd).size(36.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)),
                            ) { Icon(Icons.Filled.Close, "Hapus foto ${i + 1}", tint = Color.White, modifier = Modifier.size(18.dp)) }
                        }
                        i == refs.size && i < effectiveMax -> {
                            val required = i < minRequired
                            Column(
                                Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(if (required) p.redBg else p.greenSoft)
                                    .border(2.dp, if (required) p.red else p.green, RoundedCornerShape(12.dp))
                                    .clickable(role = Role.Button) {
                                        error = null
                                        val (uri, file) = repo.photos.newCameraUri()
                                        pendingFile = file
                                        try { launcher.launch(uri) } catch (_: Exception) { error = "Kamera tidak tersedia di HP ini." }
                                    }
                                    .semantics { contentDescription = "Ambil foto ${i + 1}" },
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                Icon(Icons.Filled.CameraAlt, null, tint = if (required) p.redDark else p.green)
                                Text(if (required) "Wajib" else "Kamera", style = Type.tiny.copy(fontWeight = FontWeight.SemiBold), color = if (required) p.redDark else p.green)
                            }
                        }
                        else -> Box(
                            Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).border(1.5.dp, p.border, RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center,
                        ) { Text(if (critical && i >= effectiveMax) "Ruang HP penuh" else "Opsional", style = Type.tiny, color = p.muted, textAlign = TextAlign.Center) }
                    }
                }
            }
        }
        if (refs.size < minRequired) Hint("Ambil minimal $minRequired foto sebelum lanjut.", p.red)
        if (critical) Hint("Ruang HP hampir penuh — hanya 1 foto per laporan. Kelola di Antrean Kirim.", p.amberText)
        error?.let { Hint(it, p.red) }
    }
}

@Composable
fun RemotePhotos(dataUrls: List<String>?, label: String? = null) {
    val list = dataUrls.orEmpty().filter { it.startsWith("data:image") }
    if (list.isEmpty()) return
    if (label != null) Hint(label)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        list.take(3).forEach { url ->
            val bmp = remember(url) {
                runCatching {
                    val b = android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                    android.graphics.BitmapFactory.decodeByteArray(b, 0, b.size)
                }.getOrNull()
            }
            if (bmp != null) Image(bmp.asImageBitmap(), null, contentScale = ContentScale.Crop,
                modifier = Modifier.weight(1f).height(84.dp).clip(RoundedCornerShape(10.dp)))
        }
        repeat(3 - minOf(3, list.size)) { Spacer(Modifier.weight(1f)) }
    }
}

// ------------------------------------------------------------------ Matriks risiko 5×5

@Composable
fun RiskMatrix(likelihood: Int, consequence: Int, onPick: (Int, Int) -> Unit, defs: List<RiskRow>, slaHours: Map<String, Int>?) {
    val level = Risk.levelOf(likelihood * consequence)
    val like = defs.firstOrNull { it.kind == "LIKELIHOOD" && it.value == likelihood }
    val sev = defs.firstOrNull { it.kind == "CONSEQUENCE" && it.value == consequence }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("Penilaian risiko", required = true)
            Spacer(Modifier.weight(1f))
            Pill("${Risk.label(level)} · ${likelihood * consequence}", Risk.bg(level), Risk.fg(level))
        }
        Hint("Kemungkinan ↑ (baris)  ·  Keparahan → (kolom). Ketuk kotak untuk memilih.")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (l in 5 downTo 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("$l", style = Type.tiny, color = p.muted, modifier = Modifier.width(14.dp))
                    for (s in 1..5) {
                        val score = l * s
                        val lv = Risk.levelOf(score)
                        val on = l == likelihood && s == consequence
                        Box(
                            Modifier.weight(1f).height(38.dp).clip(RoundedCornerShape(6.dp)).background(Risk.cellBg(lv))
                                .then(if (on) Modifier.border(3.dp, p.ink, RoundedCornerShape(6.dp)) else Modifier)
                                .clickable(role = Role.RadioButton) { onPick(l, s) }
                                .semantics { contentDescription = "Kemungkinan $l, keparahan $s, skor $score" },
                            contentAlignment = Alignment.Center,
                        ) { Text("$score", style = Type.small.copy(fontWeight = if (on) FontWeight.Bold else FontWeight.Normal), color = Risk.cellFg(lv)) }
                    }
                }
            }
        }
        Card {
            Text("Kemungkinan $likelihood — ${like?.label ?: "-"}: ${like?.description ?: ""}", style = Type.small, color = p.ink)
            Text("Keparahan $consequence — ${sev?.label ?: "-"}: ${sev?.description ?: ""}", style = Type.small, color = p.ink)
            Text("Batas tindak lanjut PIC: ${Risk.slaText(level, slaHours)} (${Risk.label(level).lowercase()})", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2)
        }
    }
}

// ------------------------------------------------------------------ Pemilih orang (PIC / peserta)

@Composable
fun PersonPickerDialog(
    title: String, people: List<Employee>, selected: Set<String>, onDone: (Set<String>) -> Unit, onDismiss: () -> Unit,
    groupByJabatan: Boolean = true, hint: String? = null,
) {
    var picked by rememberSaveable { mutableStateOf(selected.toList()) }
    var query by rememberSaveable { mutableStateOf("") }
    val depts = remember(people) { people.mapNotNull { it.departemen?.trim()?.ifBlank { null } }.distinct().sorted() }
    var dept by rememberSaveable { mutableStateOf(depts.firstOrNull()) }
    val visible = people.filter { e ->
        (query.isBlank() || (e.nama ?: "").contains(query, true) || (e.jabatan ?: "").contains(query, true)) &&
            (query.isNotBlank() || dept == null || e.departemen?.trim() == dept)
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.94f).heightIn(max = 640.dp), shape = RoundedCornerShape(20.dp), color = p.surface) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = Type.display, color = p.ink, modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, "Tutup", tint = p.ink) }
                }
                Field(query, { query = it }, placeholder = "Cari nama / jabatan")
                if (query.isBlank() && depts.isNotEmpty()) Dropdown("Departemen", depts.map { it to it }, dept, { dept = it })
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).border(1.dp, p.border, RoundedCornerShape(12.dp))) {
                    val groups = if (groupByJabatan) visible.groupBy { it.jabatan ?: "-" }.toSortedMap() else sortedMapOf("" to visible)
                    groups.forEach { (jab, list) ->
                        val ids = list.mapNotNull { it.id }
                        val all = ids.isNotEmpty() && ids.all { it in picked }
                        if (groupByJabatan) Row(
                            Modifier.fillMaxWidth().background(p.greenSoft).clickable(role = Role.Checkbox) {
                                picked = if (all) picked - ids.toSet() else (picked + ids).distinct()
                            }.padding(horizontal = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(all, { picked = if (all) picked - ids.toSet() else (picked + ids).distinct() }, colors = CheckboxDefaults.colors(checkedColor = p.green))
                            Text(jab, style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = p.ink, modifier = Modifier.weight(1f))
                            Text("${ids.count { it in picked }}/${ids.size}", style = Type.tiny, color = p.muted, modifier = Modifier.padding(end = 8.dp))
                        }
                        list.forEach { e ->
                            val id = e.id ?: return@forEach
                            val on = id in picked
                            Row(
                                Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { picked = if (on) picked - id else picked + id }
                                    .padding(start = if (groupByJabatan) 28.dp else 6.dp, end = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(on, { picked = if (on) picked - id else picked + id }, colors = CheckboxDefaults.colors(checkedColor = p.green))
                                Column {
                                    Text(e.nama ?: "-", style = Type.body, color = p.ink)
                                    if (!groupByJabatan || query.isNotBlank()) Text("${e.jabatan ?: "-"} · ${e.departemen ?: "-"}", style = Type.tiny, color = p.muted)
                                }
                            }
                        }
                    }
                    if (visible.isEmpty()) Text("Tidak ada karyawan.", style = Type.small, color = p.muted, modifier = Modifier.padding(16.dp))
                }
                if (hint != null) Hint(hint)
                BigButton("Simpan · ${picked.size} dipilih", { onDone(picked.toSet()) })
            }
        }
    }
}

// ------------------------------------------------------------------ Darurat

@Composable
fun CallButton(label: String, phone: String?, dark: Boolean = true) {
    val ctx = LocalContext.current
    val enabled = !phone.isNullOrBlank()
    Row(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(12.dp)).background(if (dark) Color.White else EmergencyRed)
            .clickable(enabled = enabled, role = Role.Button) {
                ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone!!.filter { it.isDigit() || it == '+' }}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Phone, null, tint = if (dark) EmergencyRed else Color.White)
        Spacer(Modifier.width(8.dp))
        Text(if (enabled) label else "$label (nomor belum diatur)", style = Type.body.copy(fontWeight = FontWeight.Bold),
            color = if (dark) EmergencyRed else Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Kartu darurat merah dengan telepon HSE on-duty (roster shift HSE) + kontak darurat site. */
@Composable
fun EmergencyCard(title: String, message: String, onDuty: List<OnDutyPerson>, fallbackName: String?, fallbackPhone: String?, shiftLabel: String?) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(EmergencyRed).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, style = Type.title, color = Color.White)
        Text(message, style = Type.small, color = Color(0xFFF8D7D4))
        val first = onDuty.firstOrNull { !it.phone.isNullOrBlank() }
        if (first != null) CallButton("Telepon HSE on-duty · ${first.nama}", first.phone)
        if (fallbackPhone != null) CallButton("Telepon ${fallbackName ?: "kontak darurat"}", fallbackPhone)
        if (first == null && fallbackPhone == null) Text("Nomor darurat belum diatur di server. Hubungi lewat radio.", style = Type.small, color = Color.White)
        Text(
            if (onDuty.isEmpty()) "Roster HSE shift ini kosong — memakai kontak darurat site." else "Dari roster shift HSE${shiftLabel?.let { " · $it" } ?: ""}. Tersimpan offline.",
            style = Type.tiny, color = Color(0xFFF8D7D4),
        )
    }
}

@Composable
fun EmptyState(text: String) {
    Text(text, style = Type.body, color = p.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp))
}

@Composable
fun TabChips(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { (k, label) ->
            val on = k == selected
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(if (on) p.ink else p.surface)
                    .border(if (on) 0.dp else 1.5.dp, if (on) p.ink else p.borderStrong, RoundedCornerShape(22.dp))
                    .clickable(role = Role.Tab) { onSelect(k) }.padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (on) p.surface else p.ink, textAlign = TextAlign.Center, maxLines = 2) }
        }
    }
}

@Composable
fun Divider() = HorizontalDivider(color = p.border)

@Composable
fun Stack(gap: Dp = 8.dp, content: @Composable ColumnScope.() -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(gap), content = content)

val NoPadding = PaddingValues(0.dp)

@Composable
fun KeyValue(k: String, v: String?) {
    Column { Text(k, style = Type.tiny.copy(fontWeight = FontWeight.SemiBold), color = p.muted2); Text(v ?: "-", style = Type.body, color = p.ink) }
}

@Composable
fun OutlineBox(content: @Composable ColumnScope.() -> Unit) =
    Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, p.border), color = p.surface) { Column(Modifier.padding(12.dp), content = content) }

/** Ikon status bar terang (untuk header gelap) atau gelap (untuk latar terang); otomatis terang di mode gelap. */
@Composable
fun StatusBarIcons(darkBackground: Boolean) {
    val view = androidx.compose.ui.platform.LocalView.current
    val lightIcons = darkBackground || p.bg != LightPalette.bg
    androidx.compose.runtime.DisposableEffect(lightIcons) {
        val window = (view.context as? android.app.Activity)?.window
        val ctl = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, view) }
        ctl?.isAppearanceLightStatusBars = !lightIcons
        // Tiap layar menetapkan sendiri; tidak dipulihkan saat keluar agar urutan transisi tidak menimpa.
        onDispose { }
    }
}

/** Progres CAPA hazard: status laporan close otomatis saat semua tindak lanjut PIC closed. */
@Composable
fun CapaProgressCard(closed: Int, total: Int, waitingVerify: Int = 0, inProgress: Int = 0) {
    if (total <= 0) return
    val frac = (closed.toFloat() / total).coerceIn(0f, 1f)
    val parts = listOfNotNull(
        if (waitingVerify > 0) "$waitingVerify menunggu verifikasi" else null,
        if (inProgress > 0) "$inProgress dikerjakan" else null,
    )
    Card(bg = p.bg) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Progres tindak lanjut · $closed/$total selesai", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.ink, modifier = Modifier.weight(1f))
            Text("${(frac * 100).toInt()}%", style = Type.small.copy(fontWeight = FontWeight.Bold), color = p.green)
        }
        Box(
            Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(999.dp)).background(p.border)
                .semantics { contentDescription = "$closed dari $total tindak lanjut selesai" },
        ) {
            Box(Modifier.fillMaxWidth(frac).height(6.dp).clip(RoundedCornerShape(999.dp)).background(p.green))
        }
        Hint(if (parts.isEmpty()) "Laporan otomatis ditutup saat semua PIC selesai & diverifikasi." else parts.joinToString(" · "))
    }
}
