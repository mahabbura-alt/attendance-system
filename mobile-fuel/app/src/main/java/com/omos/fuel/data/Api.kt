package com.omos.fuel.data

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.omos.fuel.BuildConfig
import okhttp3.Interceptor
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.PartMap
import java.util.concurrent.TimeUnit

interface FuelApi {
    @POST("api/fuel/mobile/login") suspend fun login(@Body body: LoginRequest): LoginResponse
    @POST("api/fuel/mobile/change-pin") suspend fun changePin(@Body body: Map<String, String>): Map<String, Any?>
    @GET("api/fuel/mobile/bootstrap") suspend fun bootstrap(): Bootstrap
    // Antrean dikirim atas nama pencatatnya (HP bersama): token per petugas lewat header eksplisit.
    @POST("api/fuel/mobile/sync") suspend fun sync(@Header("Authorization") auth: String?, @Body body: SyncRequest): SyncResponse
    @POST("api/fuel/mobile/status") suspend fun status(@Header("Authorization") auth: String?, @Body body: StatusRequest): List<StatusRow>
    @GET("api/fuel/mobile/app-version") suspend fun appVersion(): AppVersion

    /** Unggah satu foto bukti (tahap 1). Idempoten per client_uuid foto. */
    @Multipart
    @POST("api/fuel-evidence/attachments")
    suspend fun upload(@Header("Authorization") auth: String?, @Part file: MultipartBody.Part, @PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>): Attachment
}

object Net {
    val gson: Gson = GsonBuilder()
        .setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES)
        .serializeNulls()
        .create()

    /** Gson tanpa ubah nama field (payload antrean sudah snake_case dari Map). */
    val rawGson: Gson = GsonBuilder().serializeNulls().create()

    @Volatile private var cached: FuelApi? = null

    fun api(session: Session): FuelApi = cached ?: synchronized(this) {
        cached ?: build(session).also { cached = it }
    }

    private fun build(session: Session): FuelApi {
        val auth = Interceptor { chain ->
            val token = session.token
            val original = chain.request()
            val explicit = original.header("Authorization")
            val req = original.newBuilder()
                .header("Accept", "application/json")
                .apply { if (explicit == null && !token.isNullOrBlank()) header("Authorization", "Bearer $token") }
                .build()
            val res = chain.proceed(req)
            // Hanya token petugas aktif yang menandai sesi berakhir (token petugas lain ditangani Repo).
            val used = req.header("Authorization")?.removePrefix("Bearer ")
            if (res.code == 401 && !token.isNullOrBlank() && used == token && !req.url.encodedPath.endsWith("/login")) session.markExpired()
            res
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(90, TimeUnit.SECONDS)
            .addInterceptor(auth)
            .build()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(FuelApi::class.java)
    }
}

/** Error API terurai (pesan + kode backend). */
data class ApiFailure(val status: Int, val code: String?, val message: String, val details: Map<String, Any?>?)

fun Throwable.apiFailure(): ApiFailure? = (this as? retrofit2.HttpException)?.let { e ->
    val body = try { e.response()?.errorBody()?.string() } catch (_: Exception) { null }
    val parsed = body?.let { runCatching { Net.gson.fromJson(it, ApiError::class.java) }.getOrNull() }
    ApiFailure(e.code(), parsed?.code, parsed?.error ?: "Permintaan ditolak (${e.code()}).", parsed?.details)
}

fun Throwable.friendlyMessage(): String {
    apiFailure()?.let { f ->
        return when {
            f.status >= 500 -> "Server sedang bermasalah. Coba lagi nanti."
            else -> f.message
        }
    }
    return when (this) {
        is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException ->
            "Tidak ada sinyal / server tidak terjangkau."
        is java.io.IOException -> "Koneksi terputus. Coba lagi."
        else -> message ?: "Terjadi kesalahan."
    }
}

fun Throwable.isNetworkProblem(): Boolean = this is java.io.IOException
