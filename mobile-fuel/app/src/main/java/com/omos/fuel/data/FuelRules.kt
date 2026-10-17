package com.omos.fuel.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.max

/**
 * Aturan lapangan yang dicek di HP SEBELUM disimpan — cermin backend/src/services/fuelMobile.js
 * (server tetap penentu akhir dan menghitung ulang). Satuan liter observed; presisi penuh,
 * pembulatan hanya saat tampil. Keputusan owner: grilling + validasi formula 17 Okt 2026.
 */
object FuelRules {
    val WIB: ZoneId = ZoneId.of("Asia/Jakarta")
    private const val DAY_START_HOUR = 6
    private const val NIGHT_START_HOUR = 18

    data class Slot(val operationalDate: LocalDate, val shiftKind: String)

    /** Hari operasional mulai 06:00 WIB; 06:00–17:59 siang, selain itu malam. */
    fun operationalSlot(at: Instant): Slot {
        val local = at.atZone(WIB)
        val hour = local.hour
        val date = if (hour < DAY_START_HOUR) local.toLocalDate().minusDays(1) else local.toLocalDate()
        val kind = if (hour in DAY_START_HOUR until NIGHT_START_HOUR) "siang" else "malam"
        return Slot(date, kind)
    }

    /** Awal shift (dasar waktu paling longgar untuk data lama tanpa jam pengisian). */
    fun shiftStart(date: LocalDate, kind: String): Instant =
        date.atTime(if (kind == "malam") NIGHT_START_HOUR else DAY_START_HOUR, 0).atZone(WIB).toInstant()

    data class HmGap(val checked: Boolean, val deltaHm: Double = 0.0, val elapsedHours: Double = 0.0,
                     val limitHours: Double = 0.0, val exceeded: Boolean = false)

    /** V3: selisih HM tidak boleh melebihi jam yang berlalu + toleransi (peringatan, bukan blokir). */
    fun hmGapCheck(previousHm: Double?, previousAt: Instant?, previousShiftStart: Instant?, currentHm: Double?,
                   currentAt: Instant, toleranceHours: Double): HmGap {
        val base = previousAt ?: previousShiftStart
        if (previousHm == null || currentHm == null || base == null || !currentAt.isAfter(base)) return HmGap(false)
        val delta = currentHm - previousHm
        val elapsed = (currentAt.toEpochMilli() - base.toEpochMilli()) / 3_600_000.0
        val limit = elapsed + toleranceHours
        return HmGap(true, delta, elapsed, limit, delta > limit)
    }

    /** HM/KM wajib naik dibanding pembacaan terakhir (server: HM_NOT_INCREASING / KM_NOT_INCREASING). */
    fun isBackwards(previous: Double?, current: Double?): Boolean =
        previous != null && current != null && current <= previous

    data class Variance(val rollover: Boolean, val meterDelta: Double, val variance: Double?, val variancePct: Double?,
                        val threshold: Double?, val investigate: Boolean)

    /** V4: selisih = (akhir − awal) − tercatat keluar; investigasi bila |selisih| > maks(pct × meter, liter). */
    fun totalizerVariance(open: Double, close: Double, recordedOut: Double, tolerancePct: Double, toleranceLiter: Double): Variance {
        if (close < open) return Variance(true, close - open, null, null, null, true)
        val meter = close - open
        val variance = meter - recordedOut
        val threshold = max(meter * tolerancePct / 100.0, toleranceLiter)
        return Variance(false, meter, variance, if (meter > 0) variance / meter * 100.0 else null, threshold, abs(variance) > threshold)
    }

    /** Entri terlambat: kejadian dicatat lebih dari grace jam setelah terjadi → alasan wajib. */
    fun isLateEntry(occurredAt: Instant, recordedAt: Instant, graceHours: Double): Boolean =
        (recordedAt.toEpochMilli() - occurredAt.toEpochMilli()) / 3_600_000.0 > graceHours

    private val SCAN_RE = Regex("^(?:OMOS:(?:EQ|LOC):)?((?:EQ|LOC)-[2-9A-HJKMNP-TV-Z]{6})$")

    /** QR "OMOS:EQ:EQ-7K3M9Q" / "OMOS:LOC:LOC-..." / ID polos → ID scan; null bila bukan label OMOS. */
    fun parseScan(raw: String?): String? = raw?.trim()?.uppercase()?.let { SCAN_RE.matchEntire(it)?.groupValues?.get(1) }

    /** V6 + antrean lokal: estimasi = (posted + pending masuk − pending keluar) − keluar yang belum terkirim. */
    fun stockEstimate(row: StockRow?, unsentOutLiter: Double): Double =
        (row?.estimateLiter ?: ((row?.postedLiter ?: 0.0) + (row?.pendingInLiter ?: 0.0) - (row?.pendingOutLiter ?: 0.0))) - unsentOutLiter

    fun overTank(liter: Double, capacity: Double?): Boolean = capacity != null && capacity > 0 && liter > capacity
}
