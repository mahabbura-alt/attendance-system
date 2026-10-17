package com.perusahaan.absensi.util

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

object WibDateTimeFormatter {
    private val wibZone = ZoneId.of("Asia/Jakarta")
    private val locale = Locale("id", "ID")
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm", locale)
    private val dateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM HH:mm", locale)

    fun time(value: String?): String? = parse(value)?.format(timeFormatter)?.let { "$it WIB" }

    fun dateTime(value: String?): String? = parse(value)?.format(dateTimeFormatter)?.let { "$it WIB" }

    private fun parse(value: String?): ZonedDateTime? {
        if (value.isNullOrBlank()) return null

        return runCatching { Instant.parse(value).atZone(wibZone) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).atZoneSameInstant(wibZone) }.getOrNull()
            // Kompatibilitas data lama tanpa offset: jam tersebut sudah dianggap WIB.
            ?: runCatching { LocalDateTime.parse(value).atZone(wibZone) }.getOrNull()
    }
}
