package com.omos.safety

import com.omos.safety.ui.Risk
import org.junit.Assert.assertEquals
import org.junit.Test

/** Ambang risiko & SLA harus sama dengan backend (hse.calculateRisk + hseMobile.SLA_HOURS). */
class RiskTest {
    @Test fun levelThresholdsMatchBackend() {
        assertEquals("LOW", Risk.levelOf(4))
        assertEquals("MEDIUM", Risk.levelOf(5))
        assertEquals("MEDIUM", Risk.levelOf(9))
        assertEquals("HIGH", Risk.levelOf(10))
        assertEquals("HIGH", Risk.levelOf(16))
        assertEquals("EXTREME", Risk.levelOf(17))
        assertEquals("EXTREME", Risk.levelOf(25))
    }

    @Test fun slaFallbackMatchesOwnerDecision() {
        assertEquals("24 jam", Risk.slaText("EXTREME", null))
        assertEquals("3 hari", Risk.slaText("HIGH", null))
        assertEquals("7 hari", Risk.slaText("MEDIUM", null))
        assertEquals("14 hari", Risk.slaText("LOW", null))
        assertEquals("2 hari", Risk.slaText("HIGH", mapOf("HIGH" to 48)))
    }
}
