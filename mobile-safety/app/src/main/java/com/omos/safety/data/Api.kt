package com.omos.safety.data

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.omos.safety.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

interface SafetyApi {
    @POST("api/auth/login") suspend fun login(@Body body: LoginRequest): LoginResponse
    @POST("api/auth/minta-reset") suspend fun requestReset(@Body body: Map<String, String>): MessageResponse
    @POST("api/auth/ganti-sandi") suspend fun changePassword(@Body body: Map<String, String>): MessageResponse

    @GET("api/hse/mobile/bootstrap") suspend fun bootstrap(): Bootstrap
    @POST("api/hse/mobile/sync") suspend fun sync(@Body body: SyncRequest): SyncResponse
    @GET("api/hse/mobile/my-reports") suspend fun myReports(): MyReports
    @GET("api/hse/mobile/hazards/{id}") suspend fun hazard(@Path("id") id: String): HazardDetail
    @GET("api/hse/mobile/pic/actions") suspend fun picActions(): List<ActionRow>
    @GET("api/hse/mobile/verify/queue") suspend fun verifyQueue(): List<ActionRow>
    @GET("api/hse/mobile/delegator/inbox") suspend fun delegatorInbox(): DelegatorInbox
    @GET("api/hse/mobile/inspections/schedules") suspend fun schedules(): Schedules
    @GET("api/hse/mobile/participants") suspend fun participants(@Query("kind") kind: String): List<Employee>
    @GET("api/hse/mobile/stats") suspend fun stats(@Query("month") month: String? = null): Stats
    @GET("api/hse/mobile/notifications") suspend fun notifications(@Query("after_id") afterId: Long, @Query("limit") limit: Int = 100): NotificationPage
    @POST("api/hse/mobile/notifications/read") suspend fun markRead(@Body body: Map<String, @JvmSuppressWildcards Any>): Map<String, Any>
    @GET("api/hse/mobile/app-version") suspend fun appVersion(): AppVersion
}

object Net {
    val gson: Gson = GsonBuilder()
        .setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES)
        .serializeNulls()
        .create()

    /** Gson tanpa ubah nama field (payload outbox sudah memakai snake_case dari Map). */
    val rawGson: Gson = GsonBuilder().serializeNulls().create()

    @Volatile private var cached: SafetyApi? = null

    fun api(session: Session): SafetyApi = cached ?: synchronized(this) {
        cached ?: build(session).also { cached = it }
    }

    private fun build(session: Session): SafetyApi {
        val auth = Interceptor { chain ->
            val token = session.token
            val req = chain.request().newBuilder()
                .header("Accept", "application/json")
                .apply { if (!token.isNullOrBlank()) header("Authorization", "Bearer $token") }
                .build()
            val res = chain.proceed(req)
            // Hanya sesi yang benar-benar punya token yang bisa "berakhir" (bukan request sebelum login).
            if (res.code == 401 && !token.isNullOrBlank() && !req.url.encodedPath.endsWith("/auth/login")) session.markExpired()
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
            .create(SafetyApi::class.java)
    }
}

/** Pesan error ramah dari HttpException/IOException. */
fun Throwable.friendlyMessage(): String = when (this) {
    is retrofit2.HttpException -> {
        val body = try { response()?.errorBody()?.string() } catch (_: Exception) { null }
        val msg = body?.let {
            try { Net.rawGson.fromJson(it, Map::class.java)?.get("error")?.toString() } catch (_: Exception) { null }
        }
        when {
            code() == 401 -> msg ?: "Sesi berakhir. Silakan masuk lagi."
            !msg.isNullOrBlank() -> msg
            code() >= 500 -> "Server sedang bermasalah. Coba lagi nanti."
            else -> "Permintaan ditolak (${code()})."
        }
    }
    is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException ->
        "Tidak ada sinyal / server tidak terjangkau."
    is java.io.IOException -> "Koneksi terputus. Coba lagi."
    else -> message ?: "Terjadi kesalahan."
}

fun Throwable.isNetworkProblem(): Boolean = this is java.io.IOException
