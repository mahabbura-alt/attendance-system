package com.perusahaan.absensi.network.dto

// ── Auth ──────────────────────────────────────────────────────────────────

data class LoginRequest(val email: String, val password: String)

data class LoginResponse(val token: String, val user: UserDto)

data class UserDto(val id: String, val nama: String, val email: String, val role: String)

data class DaftarRequest(
    val nama: String,
    val email: String,
    val jabatan: String?,
    val departemen: String?,
    val password: String,
    val shift_id: String?,
    val lokasi_kantor_id: String?
)

data class LupaSandiRequest(val email: String)

data class ResetSandiRequest(
    val email: String,
    val token: String,
    val password_baru: String
)

data class PesanResponse(val message: String)

// ── Opsi Pendaftaran & Shift ───────────────────────────────────────────────

data class OpsiPendaftaranDto(
    val shifts: List<ShiftItem>,
    val lokasi: List<LokasiItem>,
    val departemen_jabatan: Map<String, List<String>>? = null
) {
    data class ShiftItem(
        val id: String,
        val nama_shift: String,
        val jam_masuk_maks: String,
        val jam_pulang_min: String,
        val lintas_hari: Boolean
    )

    data class LokasiItem(
        val id: String,
        val nama_lokasi: String
    )
}
