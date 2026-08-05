package com.perusahaan.absensi.network.dto

data class AbsensiResponse(
    val message: String,
    val status: String,
    val absensi: AbsensiDto
)

data class AbsensiDto(
    val id: String,
    val tanggal_kerja: String,
    val waktu_datang: String?,
    val waktu_pulang: String?,
    val status_datang: String?,
    val status_pulang: String?
)

/** Status per hari untuk kalender rekap kehadiran */
data class RekapHarianDto(
    val tanggal: String,          // "2026-07-30"
    val status: String,           // "hadir" | "telat" | "tidak_absen"
    val status_datang: String?,
    val status_pulang: String?,
    val waktu_datang: String?,
    val waktu_pulang: String?
)

/** Lokasi kantor beserta koordinat dan radius untuk minimap */
data class LokasiKantorDto(
    val id: String,
    val nama_lokasi: String,
    val latitude: Double,
    val longitude: Double,
    val radius_meter: Int
)

/** Dipakai saat backend menolak karena ada sesi kemarin yang belum checkout (HTTP 409). */
data class SesiPendingError(
    val error: String,
    val absensi_id_pending: String?
)

/** Bentuk error umum dari backend, mis. lokasi di luar radius atau wajah tidak cocok. */
data class ApiError(
    val error: String,
    val similarity: Double? = null,
    val jarak_meter: Int? = null
)

data class CheckLokasiRequest(
    val latitude: Double,
    val longitude: Double
)

data class CheckLokasiResponse(
    val valid: Boolean,
    val message: String
)
