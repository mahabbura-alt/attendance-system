package com.omos.fuel.data

/**
 * DTO API `/api/fuel/mobile` & `/api/fuel-evidence` (backend/src/services/fuelMobile.js).
 * Gson memakai LOWER_CASE_WITH_UNDERSCORES: properti camelCase ↔ JSON snake_case.
 */

data class LoginRequest(
    val employeeId: String, val pin: String, val deviceUid: String,
    val deviceName: String?, val model: String?, val appVersion: String?,
)

data class LoginUser(val id: String?, val nama: String?, val employeeId: String?, val jabatan: String?, val departemen: String?)
data class Access(val functions: List<String>?, val locationIds: List<String>?, val mustChangePin: Boolean? = null)
data class DeviceInfo(val id: String?, val deviceCode: String?, val deviceName: String? = null, val status: String?)

data class LoginResponse(
    val token: String?, val mustChangePin: Boolean?, val user: LoginUser?, val access: Access?,
    val device: DeviceInfo?, val offlinePinDays: Int?,
)

data class ApiError(val error: String?, val code: String?, val details: Map<String, Any?>?)

data class Settings(
    val hmGapToleranceHours: Double?, val totalizerTolerancePct: Double?, val totalizerToleranceLiter: Double?,
    val offlinePinDays: Int?, val pinMaxAttempts: Int?, val lateEntryGraceHours: Double?,
)

data class CurrentShift(val operationalDate: String?, val shiftKind: String?, val shiftId: String?, val shiftName: String?)
data class ShiftRow(val id: String?, val namaShift: String?, val operationalStart: String?, val operationalEnd: String?, val lintasHari: Boolean?)
data class Product(val id: String, val productCode: String?, val productName: String?)

data class Location(
    val id: String, val locationCode: String?, val locationName: String?, val storageType: String?,
    val scanId: String?, val equipmentId: String?, val equipmentScanId: String?,
    val capacityLiter: Double?, val minimumStockLiter: Double?,
)

data class StockRow(
    val locationId: String, val productId: String, val postedLiter: Double?, val pendingInLiter: Double?,
    val pendingOutLiter: Double?, val estimateLiter: Double?,
)

data class Equipment(
    val id: String, val kodeAlat: String?, val kelasAlat: String?, val classUnit: String?, val tipeAlat: String?,
    val scanId: String?, val kmOnly: Boolean?, val fuelTankCapacityLiter: Double?,
    val lastTanggal: String?, val lastShiftId: String?, val lastFilledAt: String?, val lastHm: Double?, val lastKm: Double?,
)

data class EvidenceSlot(
    val transactionKind: String, val slotCode: String, val label: String?, val isRequired: Boolean?,
    val captureSource: String?, val sortOrder: Int?,
)
data class EvidenceConfig(val version: Int?, val slots: List<EvidenceSlot>?)

data class OpenSession(
    val id: String?, val clientUuid: String?, val locationId: String?, val shiftId: String?,
    val operationalDate: String?, val openedAt: String?, val totalizerOpen: Double?, val openedBy: String?,
)

data class Bootstrap(
    val serverTime: String?, val me: LoginUser?, val access: Access?, val device: DeviceInfo?, val settings: Settings?,
    val currentShift: CurrentShift?, val shifts: List<ShiftRow>?, val products: List<Product>?,
    val locations: List<Location>?, val stock: List<StockRow>?, val equipment: List<Equipment>?,
    val evidence: EvidenceConfig?, val revokedScanIds: List<String>?, val openSessions: List<OpenSession>?,
)

data class SyncItem(val clientUuid: String, val type: String, val payload: Map<String, Any?>)
data class SyncRequest(val items: List<SyncItem>)
data class SyncResult(
    val clientUuid: String?, val result: String?, val serverId: String?, val status: String?, val code: String?,
    val message: String?, val details: Map<String, Any?>?, val flags: List<String>?, val heldHm: Boolean?,
)
data class SyncResponse(val processed: Int?, val results: List<SyncResult>?)

data class StatusRequest(val clientUuids: List<String>)
data class StatusRow(val clientUuid: String?, val serverId: String?, val status: String?, val reason: String?, val flags: List<String>?)

data class Attachment(val id: String?, val slotCode: String?, val idempotentReplay: Boolean?)

data class AppVersion(
    val available: Boolean?, val versionCode: Int?, val versionName: String?, val minimumSupportedVersion: Int?,
    val mandatory: Boolean?, val apkUrl: String?, val sha256: String?, val releaseNotes: List<String>?,
)
