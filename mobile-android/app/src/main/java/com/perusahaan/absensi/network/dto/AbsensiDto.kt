package com.perusahaan.absensi.network.dto

import androidx.annotation.Keep
import com.google.gson.annotations.SerializedName

@Keep
data class AbsensiResponse(
    @SerializedName("message") val message: String,
    @SerializedName("status") val status: String,
    @SerializedName("absensi") val absensi: AbsensiDto
)

@Keep
data class AbsensiDto(
    @SerializedName("id") val id: String,
    @SerializedName("tanggal_kerja") val tanggal_kerja: String,
    @SerializedName("waktu_datang") val waktu_datang: String?,
    @SerializedName("waktu_pulang") val waktu_pulang: String?,
    @SerializedName("status_datang") val status_datang: String?,
    @SerializedName("status_pulang") val status_pulang: String?
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
