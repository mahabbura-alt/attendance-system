package com.omos.fuel.ui

import com.omos.fuel.data.Bootstrap
import com.omos.fuel.data.Equipment
import com.omos.fuel.data.EvidenceSlot
import com.omos.fuel.data.FuelRules
import com.omos.fuel.data.Location
import com.omos.fuel.data.Session
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import java.time.Instant

/** Hasil pindai label OMOS terhadap master di bootstrap (offline). */
sealed class ScanTarget {
    data class Machine(val equipment: Equipment) : ScanTarget()
    data class Place(val location: Location) : ScanTarget()
    data class Revoked(val scanId: String) : ScanTarget()
    data class Unknown(val raw: String) : ScanTarget()
}

object Lookup {
    fun resolve(b: Bootstrap?, raw: String): ScanTarget {
        val id = FuelRules.parseScan(raw) ?: return ScanTarget.Unknown(raw)
        if (b?.revokedScanIds?.contains(id) == true) return ScanTarget.Revoked(id)
        b?.locations?.firstOrNull { it.scanId == id }?.let { return ScanTarget.Place(it) }
        b?.equipment?.firstOrNull { it.scanId == id }?.let { e ->
            // Fuel truck = equipment yang juga lokasi penyimpanan.
            b.locations?.firstOrNull { it.equipmentId == e.id }?.let { return ScanTarget.Place(it) }
            return ScanTarget.Machine(e)
        }
        return ScanTarget.Unknown(raw)
    }

    /** Untuk pengisian: label fuel truck tetap dianggap unit penerima bila dipindai saat "Isi unit". */
    fun resolveUnit(b: Bootstrap?, raw: String): ScanTarget {
        val id = FuelRules.parseScan(raw) ?: return ScanTarget.Unknown(raw)
        if (b?.revokedScanIds?.contains(id) == true) return ScanTarget.Revoked(id)
        b?.equipment?.firstOrNull { it.scanId == id }?.let { return ScanTarget.Machine(it) }
        return resolve(b, raw)
    }

    fun slots(b: Bootstrap?, kind: String): List<EvidenceSlot> =
        b?.evidence?.slots.orEmpty().filter { it.transactionKind == kind }.sortedBy { it.sortOrder ?: 100 }

    fun location(b: Bootstrap?, id: String?): Location? = b?.locations?.firstOrNull { it.id == id }
    fun equipment(b: Bootstrap?, id: String?): Equipment? = b?.equipment?.firstOrNull { it.id == id }
    fun locationLabel(l: Location?): String = l?.let { "${it.locationCode} · ${storageLabel(it.storageType)}" } ?: "—"

    fun storageLabel(type: String?): String = when (type) { "fuel_truck" -> "Fuel truck"; "depot" -> "Depot"; "tank" -> "Tangki"; else -> type ?: "" }

    fun allowed(officer: Session.Officer?, function: String): Boolean = officer?.functions?.contains(function) == true
    fun allowedLocation(officer: Session.Officer?, locationId: String?): Boolean = locationId != null && officer?.locationIds?.contains(locationId) == true

    /** Label shift saat ini dari jam HP (server menghitung ulang). */
    fun shiftLabel(b: Bootstrap?, at: Instant = Instant.now()): String {
        val slot = FuelRules.operationalSlot(at)
        val nama = b?.shifts?.firstOrNull { it.namaShift?.lowercase()?.contains(slot.shiftKind) == true }?.namaShift
            ?: if (slot.shiftKind == "siang") "Shift Siang" else "Shift Malam"
        return "$nama · ${fmtTanggal(slot.operationalDate)} (operasional)"
    }

    fun shiftIdNow(b: Bootstrap?, at: Instant = Instant.now()): String? {
        val kind = FuelRules.operationalSlot(at).shiftKind
        return b?.shifts?.firstOrNull { it.namaShift?.lowercase()?.contains(kind) == true }?.id
    }

    fun fmtTanggal(d: java.time.LocalDate): String =
        java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", java.util.Locale("id", "ID")).format(d)

    fun defaultProductId(b: Bootstrap?): String? = b?.products?.singleOrNull()?.id
}

/** Draf yang dibagi antar layar (pindai → form). State Compose agar form ikut diperbarui. */
object Drafts {
    var unitId by androidx.compose.runtime.mutableStateOf<String?>(null)
    var unitInput by androidx.compose.runtime.mutableStateOf("scan")
    var manualReason by androidx.compose.runtime.mutableStateOf<String?>(null)
    /** Hasil pindai lokasi per tujuan (mis. "transfer_to") → location id. */
    val picked = androidx.compose.runtime.mutableStateMapOf<String, String>()
}
