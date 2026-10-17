package com.omos.fuel.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.omos.fuel.App
import java.util.concurrent.TimeUnit

/**
 * Kirim antrean di latar belakang: periodik ±15 menit (minimum Android) + segera setiap ada data baru.
 * Lalu segarkan master (bootstrap) dan status validasi, bersihkan foto yang sudah lama terkirim.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val repo = App.repo(applicationContext)
        repo.syncNow()
        if (repo.session.state.value.loggedIn && !repo.session.state.value.expired) runCatching { repo.refreshBootstrap() }
        runCatching { repo.cleanupSentPhotos() }
        return Result.success()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CH_SYNC, "Sinkronisasi", NotificationManager.IMPORTANCE_MIN))
        }
        val n = NotificationCompat.Builder(applicationContext, CH_SYNC)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Mengirim data OMOS Fuel…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return ForegroundInfo(4200, n)
    }

    companion object {
        private const val CH_SYNC = "sync"
        private const val PERIODIC = "omos-fuel-sync"
        private const val NOW = "omos-fuel-sync-now"
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun runNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(online)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
