package com.perusahaan.absensi.util

import org.junit.Assert.assertEquals
import org.junit.Test

class WibDateTimeFormatterTest {
    @Test
    fun `UTC timestamp ditampilkan sebagai WIB`() {
        assertEquals("07:30 WIB", WibDateTimeFormatter.time("2026-10-05T00:30:00.000Z"))
        assertEquals("05 Okt 07:30 WIB", WibDateTimeFormatter.dateTime("2026-10-05T00:30:00.000Z"))
    }

    @Test
    fun `timestamp ber-offset dikonversi ke instant WIB yang sama`() {
        assertEquals("07:30 WIB", WibDateTimeFormatter.time("2026-10-05T08:30:00+08:00"))
    }

    @Test
    fun `timestamp lama tanpa offset dianggap sudah WIB`() {
        assertEquals("07:30 WIB", WibDateTimeFormatter.time("2026-10-05T07:30:00"))
    }
}
