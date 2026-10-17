package com.omos.safety.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.google.gson.reflect.TypeToken
import com.omos.safety.App
import com.omos.safety.data.Repo
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

val WIB: ZoneId = ZoneId.of("Asia/Jakarta")
private val ID = Locale("id", "ID")

@Composable
fun rememberRepo(): Repo {
    val ctx = LocalContext.current
    return remember { App.repo(ctx) }
}

/** Observasi cache offline (data terakhir dari server) dengan tipe generik. */
@Composable
inline fun <reified T> rememberCache(repo: Repo, key: String): State<T?> {
    val type = remember { object : TypeToken<T>() {}.type }
    val flow = remember(key) { repo.observe<T>(key, type) }
    return flow.collectAsState(initial = null)
}

fun isoAt(date: LocalDate, time: LocalTime): String = date.atTime(time).atZone(WIB).toInstant().toString()

fun nowWibDate(): LocalDate = LocalDate.now(WIB)
fun nowWibTime(): LocalTime = LocalTime.now(WIB).withSecond(0).withNano(0)

fun parseInstant(v: String?): Instant? = v?.let {
    runCatching { Instant.parse(it) }.getOrNull() ?: runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull()
}

fun fmtDateTime(v: String?): String = parseInstant(v)?.let {
    DateTimeFormatter.ofPattern("d MMM HH:mm", ID).format(it.atZone(WIB))
} ?: fmtDate(v)

fun fmtDate(v: String?): String {
    if (v.isNullOrBlank()) return "-"
    val d = runCatching { LocalDate.parse(v.take(10)) }.getOrNull() ?: return v
    return DateTimeFormatter.ofPattern("d MMM yyyy", ID).format(d)
}

fun fmtMillis(ms: Long): String = if (ms <= 0) "-" else DateTimeFormatter.ofPattern("d MMM HH:mm", ID).format(Instant.ofEpochMilli(ms).atZone(WIB))

/** Sisa waktu / lewat batas untuk tindak lanjut PIC. */
fun dueText(dueAt: String?, dueDate: String?): Pair<String, Boolean> {
    val due = parseInstant(dueAt) ?: dueDate?.let { runCatching { LocalDate.parse(it.take(10)).atTime(23, 59).atZone(WIB).toInstant() }.getOrNull() }
        ?: return "Batas belum ditentukan" to false
    val diffMin = (due.toEpochMilli() - System.currentTimeMillis()) / 60_000
    val abs = kotlin.math.abs(diffMin)
    val text = when {
        abs >= 1440 -> "${abs / 1440} hari ${(abs % 1440) / 60} jam"
        abs >= 60 -> "${abs / 60} jam ${abs % 60} menit"
        else -> "$abs menit"
    }
    return if (diffMin >= 0) "Sisa $text" to false else "Lewat batas $text" to true
}

fun fmtBytes(b: Long): String = when {
    b >= 1L shl 30 -> "%.1f GB".format(ID, b / (1L shl 30).toDouble())
    b >= 1L shl 20 -> "%.1f MB".format(ID, b / (1L shl 20).toDouble())
    b >= 1024 -> "${b / 1024} KB"
    else -> "$b B"
}

/** Label status hazard (server 7 tahap → tampilan lapangan). */
fun hazardStatusLabel(s: String?): String = when (s) {
    "NEW" -> "Baru · belum diproses"
    "ASSESSED" -> "Ditriase HSE"
    "IN_ACTION" -> "In Progress"
    "VERIFY" -> "Menunggu verifikasi"
    "CLOSED" -> "Closed"
    "CANCELLED" -> "Dibatalkan"
    "DUPLICATE" -> "Digabung (laporan sama)"
    "REJECTED" -> "Ditolak HSE"
    else -> s ?: "-"
}

fun actionStatusLabel(s: String?, rejected: Boolean): String = when {
    s == "IN_PROGRESS" && rejected -> "Ditolak · perlu perbaikan"
    s == "OPEN" -> "Open"
    s == "IN_PROGRESS" -> "In Progress"
    s == "DONE_PENDING_VERIFY" -> "Menunggu verifikasi"
    s == "CLOSED" -> "Closed"
    s == "CANCELLED" -> "Dibatalkan"
    else -> s ?: "-"
}

@Composable
fun statusColors(s: String?, rejected: Boolean = false): Pair<Color, Color> = when {
    rejected -> p.redBg to p.redDark
    s == "OPEN" || s == "NEW" -> Color(0xFFFDEFC3) to Color(0xFF6B4E00)
    s == "IN_PROGRESS" || s == "IN_ACTION" || s == "ASSESSED" -> p.blueBg to p.blue
    s == "DONE_PENDING_VERIFY" || s == "VERIFY" -> p.purpleBg to p.purple
    s == "CLOSED" -> p.greenBg to p.green
    else -> p.border to p.muted2
}

fun moduleOf(type: String): String = when (type) {
    "HAZARD_CREATE", "HAZARD_CORRECT", "HAZARD_CANCEL", "HAZARD_NOTE" -> "Hazard"
    "ACTION_START", "ACTION_EVIDENCE", "PIC_REQUEST" -> "Tindak lanjut"
    "VERIFY_DECISION" -> "Verifikasi"
    "DELEGATOR_DECISION", "DELEGATOR_REASSIGN" -> "Delegasi"
    "INCIDENT_CREATE" -> "Insiden"
    "INSPECTION_CREATE" -> "Inspeksi"
    "P5M_CREATE" -> "P5M"
    "SAFETYTALK_CREATE" -> "Safety Talk"
    "MEETING_CREATE" -> "Pertemuan K3"
    else -> type
}
