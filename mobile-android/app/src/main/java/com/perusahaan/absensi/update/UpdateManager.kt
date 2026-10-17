package com.perusahaan.absensi.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.perusahaan.absensi.BuildConfig
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.AppVersionDto
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object UpdateManager {
    private const val PREFS = "apk_update_state"
    private const val KEY_DOWNLOAD_ID = "download_id"
    private const val KEY_FILE_PATH = "file_path"
    private const val KEY_SHA256 = "sha256"
    private const val KEY_TARGET_VERSION = "target_version"
    private const val KEY_TARGET_VERSION_NAME = "target_version_name"
    private const val KEY_TARGET_APK_URL = "target_apk_url"
    private const val KEY_TARGET_MANDATORY = "target_mandatory"
    private const val KEY_TARGET_MINIMUM_VERSION = "target_minimum_version"
    private val checking = AtomicBoolean(false)
    private val downloading = AtomicBoolean(false)
    private var promptedVersion = -1
    private var receiver: BroadcastReceiver? = null

    fun checkForUpdate(activity: AppCompatActivity) {
        resumePendingUpdate(activity)
        resumeApprovedUpdate(activity)
        if (!checking.compareAndSet(false, true)) return
        activity.lifecycleScope.launch {
            try {
                val response = RetrofitClient.api.appVersion()
                val release = response.body()
                if (response.isSuccessful && release != null &&
                    release.versionCode > BuildConfig.VERSION_CODE &&
                    !isUpdateInProgress(activity, release.versionCode) &&
                    promptedVersion != release.versionCode
                ) {
                    promptedVersion = release.versionCode
                    showUpdateDialog(activity, release)
                }
            } catch (_: Exception) {
                // Pemeriksaan update tidak boleh menghalangi login atau absensi.
            } finally {
                checking.set(false)
            }
        }
    }

    private fun showUpdateDialog(activity: AppCompatActivity, release: AppVersionDto) {
        if (activity.isFinishing || activity.isDestroyed) return
        val required = release.mandatory || BuildConfig.VERSION_CODE < release.minimumSupportedVersion
        val notes = release.releaseNotes.joinToString("\n") { "• $it" }
            .ifBlank { "Perbaikan dan peningkatan sistem Absensi PIM." }
        val installNote = "\n\nSetelah diizinkan, pembaruan diunduh otomatis di latar belakang. " +
            "Android mungkin meminta izin pemasangan satu kali dan konfirmasi instalasi."
        val dialog = MaterialAlertDialogBuilder(activity)
            .setTitle("Pembaruan Absensi PIM ${release.versionName}")
            .setMessage(notes + installNote)
            .setPositiveButton("Izinkan & Update") { _, _ -> approveUpdate(activity, release) }
        if (!required) dialog.setNegativeButton("Nanti", null)
        dialog.setCancelable(!required).show()
    }

    private fun approveUpdate(activity: AppCompatActivity, release: AppVersionDto) {
        if (!isTrustedApkUrl(release.apkUrl) || !release.sha256.matches(Regex("^[a-fA-F0-9]{64}$"))) {
            Toast.makeText(activity, "Konfigurasi update dari server tidak valid.", Toast.LENGTH_LONG).show()
            return
        }
        saveApprovedRelease(activity, release)
        promptedVersion = release.versionCode
        if (!activity.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(
                activity,
                "Aktifkan 'Izinkan dari sumber ini'. Download akan mulai otomatis saat kembali.",
                Toast.LENGTH_LONG
            ).show()
            activity.startActivity(Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")
            ))
            return
        }
        downloadUpdate(activity, release)
    }

    private fun resumeApprovedUpdate(activity: AppCompatActivity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val targetVersion = prefs.getInt(KEY_TARGET_VERSION, -1)
        if (targetVersion <= BuildConfig.VERSION_CODE) {
            if (targetVersion != -1) clearPending(activity)
            return
        }
        if (prefs.getLong(KEY_DOWNLOAD_ID, -1L) != -1L || !activity.packageManager.canRequestPackageInstalls()) return
        val release = AppVersionDto(
            versionCode = targetVersion,
            versionName = prefs.getString(KEY_TARGET_VERSION_NAME, null) ?: return,
            minimumSupportedVersion = prefs.getInt(KEY_TARGET_MINIMUM_VERSION, BuildConfig.VERSION_CODE),
            mandatory = prefs.getBoolean(KEY_TARGET_MANDATORY, false),
            apkUrl = prefs.getString(KEY_TARGET_APK_URL, null) ?: return,
            sha256 = prefs.getString(KEY_SHA256, null) ?: return,
            releaseNotes = emptyList()
        )
        promptedVersion = targetVersion
        downloadUpdate(activity, release)
    }

    private fun isUpdateInProgress(context: Context, versionCode: Int): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_TARGET_VERSION, -1) == versionCode
    }

    private fun saveApprovedRelease(context: Context, release: AppVersionDto) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(KEY_TARGET_VERSION, release.versionCode)
            .putString(KEY_TARGET_VERSION_NAME, release.versionName)
            .putInt(KEY_TARGET_MINIMUM_VERSION, release.minimumSupportedVersion)
            .putBoolean(KEY_TARGET_MANDATORY, release.mandatory)
            .putString(KEY_TARGET_APK_URL, release.apkUrl)
            .putString(KEY_SHA256, release.sha256.lowercase())
            .apply()
    }

    private fun downloadUpdate(activity: AppCompatActivity, release: AppVersionDto) {
        if (!downloading.compareAndSet(false, true)) return
        try {
            val safeVersion = release.versionName.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val filename = "Absensi_PIM_V${safeVersion}.apk"
            val targetFile = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), filename)
            if (targetFile.exists()) targetFile.delete()

            val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val request = DownloadManager.Request(Uri.parse(release.apkUrl))
                .setTitle("Update Absensi PIM ${release.versionName}")
                .setDescription("Mengunduh pembaruan aplikasi")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, filename)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
            val downloadId = manager.enqueue(request)
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(KEY_DOWNLOAD_ID, downloadId)
                .putString(KEY_FILE_PATH, targetFile.absolutePath)
                .putString(KEY_SHA256, release.sha256.lowercase())
                .apply()
            registerDownloadReceiver(activity, downloadId)
            Toast.makeText(activity, "Pembaruan sedang diunduh…", Toast.LENGTH_LONG).show()
        } catch (error: Exception) {
            Toast.makeText(activity, "Gagal mengunduh update: ${error.message}", Toast.LENGTH_LONG).show()
        } finally {
            downloading.set(false)
        }
    }

    private fun isTrustedApkUrl(value: String): Boolean {
        val api = Uri.parse(BuildConfig.API_BASE_URL)
        val apk = Uri.parse(value)
        return apk.scheme.equals("https", ignoreCase = true) &&
            !apk.host.isNullOrBlank() && apk.host.equals(api.host, ignoreCase = true)
    }

    private fun registerDownloadReceiver(activity: AppCompatActivity, downloadId: Long) {
        receiver?.let { runCatching { activity.unregisterReceiver(it) } }
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) == downloadId) {
                    receiver?.let { runCatching { activity.unregisterReceiver(it) } }
                    receiver = null
                    resumePendingUpdate(activity)
                }
            }
        }
        ContextCompat.registerReceiver(
            activity,
            receiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        )
    }

    fun resumePendingUpdate(activity: AppCompatActivity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val downloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        val path = prefs.getString(KEY_FILE_PATH, null) ?: return
        val file = File(path)
        if (downloadId != -1L) {
            val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val status = manager.query(DownloadManager.Query().setFilterById(downloadId))?.use { cursor ->
                if (!cursor.moveToFirst()) null
                else cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            }
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> Unit
                DownloadManager.STATUS_FAILED, null -> {
                    file.delete()
                    clearDownloadState(activity)
                    Toast.makeText(activity, "Download update terputus. Sistem akan mencoba lagi otomatis.", Toast.LENGTH_LONG).show()
                    return
                }
                else -> return
            }
        }
        if (!file.exists()) return
        val expectedHash = prefs.getString(KEY_SHA256, "").orEmpty()
        activity.lifecycleScope.launch {
            val valid = withContext(Dispatchers.IO) {
                expectedHash.matches(Regex("^[a-fA-F0-9]{64}$")) &&
                    sha256(file).equals(expectedHash, ignoreCase = true) &&
                    verifyPackageAndSigner(activity, file)
            }
            if (!valid) {
                file.delete()
                clearPending(activity)
                Toast.makeText(activity, "File update tidak valid dan telah dibatalkan.", Toast.LENGTH_LONG).show()
                return@launch
            }
            installApk(activity, file)
        }
    }

    @Suppress("DEPRECATION")
    private fun verifyPackageAndSigner(context: Context, file: File): Boolean {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val candidate = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: return false
        if (candidate.packageName != context.packageName) return false
        if (PackageInfoCompat.getLongVersionCode(candidate) <= BuildConfig.VERSION_CODE.toLong()) return false

        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        val expected = signerDigests(installed)
        val actual = signerDigests(candidate)
        return expected.isNotEmpty() && actual.isNotEmpty() && expected.intersect(actual).isNotEmpty()
    }

    @Suppress("DEPRECATION")
    private fun signerDigests(info: android.content.pm.PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners?.toList().orEmpty()
        } else {
            info.signatures?.toList().orEmpty()
        }
        return signatures.map { bytesSha256(it.toByteArray()) }.toSet()
    }

    private fun installApk(activity: AppCompatActivity, file: File) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(activity, "Aktifkan 'Izinkan dari sumber ini' untuk menyelesaikan update.", Toast.LENGTH_LONG).show()
            activity.startActivity(Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")
            ))
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        clearPending(activity)
        activity.startActivity(intent)
    }

    private fun clearPending(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun clearDownloadState(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_FILE_PATH)
            .apply()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count <= 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun bytesSha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }
}
