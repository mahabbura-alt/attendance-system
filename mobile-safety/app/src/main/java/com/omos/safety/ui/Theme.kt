package com.omos.safety.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Palet OMOS Safety (dari mockup): hijau tambang tua + kuning keselamatan, kontras tinggi untuk lapangan. */
data class Palette(
    val ink: Color, val bg: Color, val surface: Color, val border: Color, val borderStrong: Color,
    val muted: Color, val muted2: Color, val header: Color, val headerText: Color, val headerMuted: Color,
    val green: Color, val greenBg: Color, val greenSoft: Color, val accent: Color,
    val red: Color, val redDark: Color, val redBg: Color, val amber: Color, val amberText: Color, val amberBg: Color,
    val blue: Color, val blueBg: Color, val purple: Color, val purpleBg: Color,
)

val LightPalette = Palette(
    ink = Color(0xFF14201A), bg = Color(0xFFF5F6F3), surface = Color.White, border = Color(0xFFDDE2DB),
    borderStrong = Color(0xFF9AA59E), muted = Color(0xFF5B665F), muted2 = Color(0xFF4A564F),
    header = Color(0xFF14201A), headerText = Color.White, headerMuted = Color(0xFFC9D3CC),
    green = Color(0xFF1B6E37), greenBg = Color(0xFFDDEFE3), greenSoft = Color(0xFFEEF5F0), accent = Color(0xFFF2B705),
    red = Color(0xFFB3261E), redDark = Color(0xFF8C1D18), redBg = Color(0xFFFDECEA),
    amber = Color(0xFF9A5B00), amberText = Color(0xFF6B4E00), amberBg = Color(0xFFFFF4E5),
    blue = Color(0xFF1D4F86), blueBg = Color(0xFFDCE8F5), purple = Color(0xFF4B2A7A), purpleBg = Color(0xFFE7DDF5),
)

/** Tampilan gelap untuk shift malam: kontras tetap ≥ 4.5:1 untuk teks utama. */
val DarkPalette = Palette(
    ink = Color(0xFFE8EDE9), bg = Color(0xFF0E1511), surface = Color(0xFF17211B), border = Color(0xFF2B3830),
    borderStrong = Color(0xFF5B665F), muted = Color(0xFFA9B4AD), muted2 = Color(0xFFBCC6BF),
    header = Color(0xFF0A100C), headerText = Color.White, headerMuted = Color(0xFFA9B4AD),
    green = Color(0xFF4CB273), greenBg = Color(0xFF173524), greenSoft = Color(0xFF13261A), accent = Color(0xFFF2B705),
    red = Color(0xFFD84A42), redDark = Color(0xFFFFB4AB), redBg = Color(0xFF3B1513),
    amber = Color(0xFFF5B85C), amberText = Color(0xFFF8D08A), amberBg = Color(0xFF33240C),
    blue = Color(0xFF8DB8F0), blueBg = Color(0xFF14263C), purple = Color(0xFFCDB4F2), purpleBg = Color(0xFF2A1D3D),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

/** Warna darurat tetap (tidak ikut tema) agar tombol telepon & insiden selalu kontras tinggi. */
val EmergencyRed = Color(0xFF8C1D18)

object Type {
    val display = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = 0.2.sp)
    val title = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    val body = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 15.sp, lineHeight = 21.sp)
    val small = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 18.sp)
    val tiny = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 16.sp)
    val button = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 17.sp, letterSpacing = 0.8.sp)
}

@Composable
fun OmosTheme(dark: Boolean, content: @Composable () -> Unit) {
    val p = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) darkColorScheme(primary = p.green, background = p.bg, surface = p.surface, onSurface = p.ink, onBackground = p.ink)
    else lightColorScheme(primary = p.green, background = p.bg, surface = p.surface, onSurface = p.ink, onBackground = p.ink)
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/** Warna tingkat risiko (sama dengan mockup & backend LOW/MEDIUM/HIGH/EXTREME). */
object Risk {
    fun label(level: String?) = when (level) { "EXTREME" -> "EKSTREM"; "HIGH" -> "TINGGI"; "MEDIUM" -> "SEDANG"; else -> "RENDAH" }
    fun bg(level: String?) = when (level) { "EXTREME" -> Color(0xFFB91C1C); "HIGH" -> Color(0xFFC2410C); "MEDIUM" -> Color(0xFFF7DC6F); else -> Color(0xFFCDEBD5) }
    fun fg(level: String?) = when (level) { "EXTREME", "HIGH" -> Color.White; "MEDIUM" -> Color(0xFF4A3B00); else -> Color(0xFF14532D) }
    fun cellBg(level: String?) = if (level == "HIGH") Color(0xFFF59E5B) else bg(level)
    fun cellFg(level: String?) = if (level == "HIGH") Color(0xFF3B1A06) else fg(level)
    fun levelOf(score: Int) = when { score >= 17 -> "EXTREME"; score >= 10 -> "HIGH"; score >= 5 -> "MEDIUM"; else -> "LOW" }
    fun slaText(level: String?, hours: Map<String, Int>?) = (hours?.get(level ?: "LOW") ?: when (level) {
        "EXTREME" -> 24; "HIGH" -> 72; "MEDIUM" -> 168; else -> 336
    }).let { if (it < 48) "$it jam" else "${it / 24} hari" }
}
