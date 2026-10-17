package com.omos.safety.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.omos.safety.BuildConfig
import com.omos.safety.data.AppVersion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Pembaruan self-hosted: cek versi → unduh di latar belakang → verifikasi SHA-256 → 1 ketuk Install.
 * Wajib update bila versi terpasang < minimum_supported_version (Android tidak mengizinkan instal diam-diam tanpa MDM).
 */
object UpdateManager {
    sealed class State {
        data object Idle : State()
        data object UpToDate : State()
        data class Downloading(val info: AppVersion) : State()
        data class Ready(val info: AppVersion, val file: File, val mandatory: Boolean) : State()
        data class Failed(val message: String) : State()
    }

    fun isNewer(info: AppVersion): Boolean = (info.versionCode ?: 0) > BuildConfig.VERSION_CODE
    fun isMandatory(info: AppVersion): Boolean =
        BuildConfig.VERSION_CODE < (info.minimumSupportedVersion ?: 0) || (info.mandatory == true && isNewer(info))

    private fun target(context: Context, info: AppVersion) =
        File(File(context.cacheDir, "updates").apply { mkdirs() }, "OMOS_Safety_${info.versionCode}.apk")

    /** Unduh (atau pakai unduhan sebelumnya) lalu verifikasi checksum. */
    suspend fun download(context: Context, info: AppVersion): State = withContext(Dispatchers.IO) {
        val url = info.apkUrl ?: return@withContext State.Failed("Alamat APK tidak tersedia")
        val expected = info.sha256?.lowercase() ?: return@withContext State.Failed("Checksum APK tidak tersedia")
        if (!url.startsWith("https://")) return@withContext State.Failed("Pembaruan wajib lewat HTTPS")
        val file = target(context, info)
        if (file.exists() && sha256(file) == expected) return@withContext State.Ready(info, file, isMandatory(info))
        try {
            val client = OkHttpClient.Builder().readTimeout(120, TimeUnit.SECONDS).build()
            val tmp = File(file.path + ".part")
            client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext State.Failed("Unduhan gagal (${res.code})")
                res.body?.byteStream()?.use { input -> tmp.outputStream().use { input.copyTo(it) } }
                    ?: return@withContext State.Failed("Unduhan kosong")
            }
            if (sha256(tmp) != expected) {
                tmp.delete()
                return@withContext State.Failed("Verifikasi APK gagal (checksum tidak cocok). Unduhan dibuang.")
            }
            tmp.renameTo(file)
            State.Ready(info, file, isMandatory(info))
        } catch (e: Exception) {
            State.Failed("Unduhan terputus: ${e.message ?: "coba lagi"}")
        }
    }

    fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun install(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
