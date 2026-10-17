package com.omos.fuel.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Palet OMOS Fuel (mockup): hijau tambang + biru tua, kontras tinggi untuk lapangan. */
data class Palette(
    val ink: Color, val bg: Color, val surface: Color, val line: Color, val muted: Color,
    val primary: Color, val onPrimary: Color, val primarySoft: Color,
    val ok: Color, val okBg: Color, val warn: Color, val warnBg: Color, val bad: Color, val badBg: Color,
    val info: Color, val infoBg: Color, val header: Color,
)

val LightPalette = Palette(
    ink = Color(0xFF0F1B2D), bg = Color(0xFFF7F9FB), surface = Color.White, line = Color(0xFFDFE6EE), muted = Color(0xFF5B6B80),
    primary = Color(0xFF0E6E58), onPrimary = Color.White, primarySoft = Color(0xFFE5F3EE),
    ok = Color(0xFF0F7A55), okBg = Color(0xFFE2F4EA), warn = Color(0xFF8A5300), warnBg = Color(0xFFFDF0D8),
    bad = Color(0xFFB42318), badBg = Color(0xFFFDECEB), info = Color(0xFF1F5FBF), infoBg = Color(0xFFE7EFFB),
    header = Color(0xFF0F1B2D),
)

/** Shift malam: teks utama tetap ≥ 4.5:1. */
val DarkPalette = Palette(
    ink = Color(0xFFE8EEF5), bg = Color(0xFF0B121C), surface = Color(0xFF131E2C), line = Color(0xFF253447), muted = Color(0xFF93A3B8),
    primary = Color(0xFF35C39B), onPrimary = Color(0xFF062018), primarySoft = Color(0xFF0F2E25),
    ok = Color(0xFF4CC995), okBg = Color(0xFF0F3324), warn = Color(0xFFF0B44C), warnBg = Color(0xFF382A0E),
    bad = Color(0xFFF2867C), badBg = Color(0xFF3B1714), info = Color(0xFF82ADF2), infoBg = Color(0xFF14284A),
    header = Color(0xFF060B12),
)

/** Siang terik: teks hitam pekat, garis tegas. */
fun Palette.highContrast(): Palette = copy(ink = Color.Black, muted = Color(0xFF1D2733), line = Color(0xFF6B7A8C), primary = Color(0xFF005C45))

val LocalPalette = staticCompositionLocalOf { LightPalette }

val p: Palette
    @Composable @ReadOnlyComposable get() = LocalPalette.current

object Type {
    val display = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 22.sp)
    val big = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 28.sp)
    val title = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
    val body = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 15.sp, lineHeight = 21.sp)
    val small = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 18.sp)
    val button = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 17.sp)
    val input = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 22.sp)
}

@Composable
fun OmosTheme(dark: Boolean, highContrast: Boolean, content: @Composable () -> Unit) {
    val base = if (dark) DarkPalette else LightPalette
    val pal = if (highContrast && !dark) base.highContrast() else base
    val scheme = if (dark) darkColorScheme(primary = pal.primary, background = pal.bg, surface = pal.surface, onSurface = pal.ink, onBackground = pal.ink)
    else lightColorScheme(primary = pal.primary, background = pal.bg, surface = pal.surface, onSurface = pal.ink, onBackground = pal.ink)
    CompositionLocalProvider(LocalPalette provides pal) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
