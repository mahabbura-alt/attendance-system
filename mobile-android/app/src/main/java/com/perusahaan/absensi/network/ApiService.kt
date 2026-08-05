package com.perusahaan.absensi.network

import com.perusahaan.absensi.network.dto.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ── Auth ──────────────────────────────────────────────────────────────────

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @Multipart
    @POST("api/auth/daftar")
    suspend fun daftar(
        @Part("nama") nama: RequestBody,
        @Part("email") email: RequestBody,
        @Part("jabatan") jabatan: RequestBody?,
        @Part("departemen") departemen: RequestBody?,
        @Part("password") password: RequestBody,
        @Part("shift_id") shiftId: RequestBody?,
        @Part("lokasi_kantor_id") lokasiId: RequestBody?,
        @Part foto1: MultipartBody.Part?,
        @Part foto2: MultipartBody.Part?,
        @Part foto3: MultipartBody.Part?
    ): Response<PesanResponse>

    @POST("api/auth/lupa-sandi")
    suspend fun lupaSandi(@Body request: LupaSandiRequest): Response<PesanResponse>

    @POST("api/auth/reset-sandi")
    suspend fun resetSandi(@Body request: ResetSandiRequest): Response<PesanResponse>

    /** Daftar shift & lokasi untuk form pendaftaran dan spinner absen */
    @GET("api/auth/opsi-pendaftaran")
    suspend fun opsiPendaftaran(): Response<OpsiPendaftaranDto>

    // ── Absensi ───────────────────────────────────────────────────────────────

    @POST("api/absensi/check-lokasi")
    suspend fun checkLokasi(@Body request: CheckLokasiRequest): Response<CheckLokasiResponse>

    @Multipart
    @POST("api/absensi/datang")
    suspend fun absenDatang(
        @Part("latitude") latitude: RequestBody,
        @Part("longitude") longitude: RequestBody,
        @Part foto: MultipartBody.Part
    ): Response<AbsensiResponse>

    @Multipart
    @POST("api/absensi/pulang")
    suspend fun absenPulang(
        @Part("latitude") latitude: RequestBody,
        @Part("longitude") longitude: RequestBody,
        @Part foto: MultipartBody.Part
    ): Response<AbsensiResponse>

    @GET("api/absensi/riwayat")
    suspend fun riwayat(): Response<List<AbsensiDto>>

    @GET("api/absensi/rekap")
    suspend fun rekapKehadiran(): Response<List<RekapHarianDto>>

    @GET("api/absensi/rekap-hm")
    suspend fun getRekapHm(): Response<RekapHmResponse>

    @GET("api/absensi/lokasi-kantor")
    suspend fun lokasiKantor(): Response<LokasiKantorDto>

    @Streaming
    @GET("api/absensi/slip-gaji")
    suspend fun unduhSlipGaji(
        @Query("bulan") bulan: Int,
        @Query("tahun") tahun: Int,
        @Header("X-Password") password: String
    ): Response<ResponseBody>
}
