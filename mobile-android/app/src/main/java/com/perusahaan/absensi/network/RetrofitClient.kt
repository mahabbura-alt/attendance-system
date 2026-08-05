package com.perusahaan.absensi.network

import android.net.Uri
import com.perusahaan.absensi.BuildConfig
import com.perusahaan.absensi.data.SessionManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object RetrofitClient {

    private val authInterceptor = Interceptor { chain ->
        val token = SessionManager.getToken()
        val request = chain.request().newBuilder().apply {
            if (token != null) addHeader("Authorization", "Bearer $token")
        }.build()
        chain.proceed(request)
    }

    private val dynamicUrlInterceptor = Interceptor { chain ->
        var request = chain.request()
        try {
            val rawServerUrl = SessionManager.getServerUrl()
            val cleanUrl = if (rawServerUrl.startsWith("http://") || rawServerUrl.startsWith("https://")) {
                rawServerUrl
            } else {
                "http://$rawServerUrl"
            }
            val formattedUrl = if (cleanUrl.endsWith("/")) cleanUrl else "$cleanUrl/"
            val uri = Uri.parse(formattedUrl)

            val targetHost = uri.host
            if (targetHost != null && targetHost.isNotEmpty()) {
                val scheme = uri.scheme ?: "https"
                val defaultPort = if (scheme == "https") 443 else 3000
                val targetPort = if (uri.port != -1) uri.port else defaultPort

                val newHttpUrl = request.url.newBuilder()
                    .scheme(scheme)
                    .host(targetHost)
                    .port(targetPort)
                    .build()

                request = request.newBuilder().url(newHttpUrl).build()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        chain.proceed(request)
    }

    private fun String?.isNull_or_empty(): Boolean {
        return this == null || this.isEmpty()
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BODY
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(dynamicUrlInterceptor)
        .addInterceptor(authInterceptor)
        .addInterceptor(loggingInterceptor)
        .build()

    val api: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl("http://192.168.1.82:3000/")
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }
}
