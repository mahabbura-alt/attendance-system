package com.omos.fuel

import com.omos.fuel.data.FuelRules
import com.omos.fuel.data.OfflinePin
import com.omos.fuel.data.StockRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

/** Cermin test backend/test/fuel-mobile.test.js — aturan HP harus sama dengan server. */
class FuelRulesTest {
    @Test fun slotOperasionalMulai0600Wib() {
        assertEquals(FuelRules.Slot(LocalDate.parse("2026-10-16"), "malam"), FuelRules.operationalSlot(Instant.parse("2026-10-16T22:59:00Z")))
        assertEquals(FuelRules.Slot(LocalDate.parse("2026-10-17"), "siang"), FuelRules.operationalSlot(Instant.parse("2026-10-16T23:00:00Z")))
        assertEquals(FuelRules.Slot(LocalDate.parse("2026-10-17"), "malam"), FuelRules.operationalSlot(Instant.parse("2026-10-17T11:00:00Z")))
    }

    @Test fun selisihHmMelebihiWaktuBerlaluPlusToleransi() {
        val g = FuelRules.hmGapCheck(12345.5, Instant.parse("2026-10-16T15:10:00Z"), null, 12355.0, Instant.parse("2026-10-16T23:16:00Z"), 1.0)
        assertTrue(g.checked)
        assertEquals(8.1, g.elapsedHours, 1e-9)
        assertTrue(g.exceeded)
        val longgar = FuelRules.hmGapCheck(100.0, null, FuelRules.shiftStart(LocalDate.parse("2026-10-16"), "siang"), 108.0, Instant.parse("2026-10-16T09:00:00Z"), 1.0)
        assertFalse("awal shift 06:00 WIB → 9 jam berlalu", longgar.exceeded)
        assertFalse(FuelRules.hmGapCheck(1.0, null, null, 2.0, Instant.now(), 1.0).checked)
    }

    @Test fun totalizerAmbangMaksPersenAtauLiter() {
        val v = FuelRules.totalizerVariance(1284530.0, 1292680.0, 8060.0, 0.5, 20.0)
        assertEquals(8150.0, v.meterDelta, 1e-9)
        assertEquals(90.0, v.variance!!, 1e-9)
        assertEquals(40.75, v.threshold!!, 1e-9)
        assertTrue(v.investigate)
        val kecil = FuelRules.totalizerVariance(0.0, 1000.0, 985.0, 0.5, 20.0)
        assertEquals(20.0, kecil.threshold!!, 1e-9)
        assertFalse(kecil.investigate)
        assertTrue("selisih negatif juga diperiksa", FuelRules.totalizerVariance(0.0, 1000.0, 1030.0, 0.5, 20.0).investigate)
        val roll = FuelRules.totalizerVariance(999990.0, 120.0, 100.0, 0.5, 20.0)
        assertTrue(roll.rollover); assertTrue(roll.investigate); assertNull(roll.variance)
    }

    @Test fun pindaiLabelOmos() {
        assertEquals("EQ-7K3M9Q", FuelRules.parseScan("OMOS:EQ:EQ-7K3M9Q"))
        assertEquals("LOC-2M8VXA", FuelRules.parseScan(" loc-2m8vxa "))
        assertNull("huruf O tidak dipakai", FuelRules.parseScan("EQ-7K3M9O"))
        assertNull(FuelRules.parseScan("https://contoh.test"))
    }

    @Test fun hmKmMundurDanTangki() {
        assertTrue(FuelRules.isBackwards(100.0, 99.0))
        assertTrue(FuelRules.isBackwards(100.0, 100.0))
        assertFalse(FuelRules.isBackwards(null, 5.0))
        assertTrue(FuelRules.overTank(1200.0, 1100.0))
        assertFalse(FuelRules.overTank(1200.0, null))
    }

    @Test fun estimasiStokDikurangiAntreanLokal() {
        val row = StockRow("l", "p", 4000.0, 12000.0, 0.0, 16000.0)
        assertEquals(7940.0, FuelRules.stockEstimate(row, 8060.0), 1e-9)
        assertEquals(-100.0, FuelRules.stockEstimate(null, 100.0), 1e-9)
    }

    @Test fun entriTerlambat() {
        assertTrue(FuelRules.isLateEntry(Instant.parse("2026-10-17T00:00:00Z"), Instant.parse("2026-10-17T03:00:00Z"), 2.0))
        assertFalse(FuelRules.isLateEntry(Instant.parse("2026-10-17T00:00:00Z"), Instant.parse("2026-10-17T01:00:00Z"), 2.0))
    }

    @Test fun pinOfflineDanPinTrivial() {
        val salt = OfflinePin.newSalt()
        val h = OfflinePin.hash("482915", salt)
        assertTrue(OfflinePin.verify("482915", salt, h))
        assertFalse(OfflinePin.verify("482916", salt, h))
        listOf("000000", "123456", "654321", "345678").forEach { assertTrue(it, OfflinePin.isTrivial(it)) }
        assertFalse(OfflinePin.isTrivial("482915"))
        assertFalse(OfflinePin.validFormat("12345"))
    }
}
