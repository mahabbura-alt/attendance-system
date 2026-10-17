package com.omos.safety.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.omos.safety.App
import com.omos.safety.MainActivity
import com.omos.safety.data.db.NotificationEntity
import java.util.concurrent.TimeUnit

/**
 * Sinkronisasi latar belakang (polling — tanpa push pihak ketiga, keputusan owner):
 * kirim antrean → ambil notifikasi baru → segarkan data master/daftar → bersihkan foto lama.
 * Periodik ±15 menit (minimum Android) + satu kali segera setiap ada data baru di antrean.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val repo = App.repo(applicationContext)
        if (!repo.session.state.value.loggedIn) return Result.success()
        repo.syncNow()
        runCatching { repo.pollNotifications() }.getOrNull()?.let { Notifier.show(applicationContext, it) }
        repo.refreshAll()
        runCatching { repo.cleanupSentPhotos() }
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "omos-safety-sync"
        private const val NOW = "omos-safety-sync-now"
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

    // Expedited work di Android < 12 butuh foreground info.
    override suspend fun getForegroundInfo(): androidx.work.ForegroundInfo {
        Notifier.ensureChannels(applicationContext)
        val n = NotificationCompat.Builder(applicationContext, Notifier.CH_SYNC)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Mengirim data OMOS Safety…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return androidx.work.ForegroundInfo(4100, n)
    }
}

object Notifier {
    const val CH_URGENT = "urgent"
    const val CH_GENERAL = "general"
    const val CH_SYNC = "sync"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_URGENT, "Darurat & risiko tinggi", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Hazard Ekstrem, Stop Work, dan insiden"
        })
        nm.createNotificationChannel(NotificationChannel(CH_GENERAL, "Tindak lanjut & status", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_SYNC, "Sinkronisasi", NotificationManager.IMPORTANCE_MIN))
    }

    fun show(context: Context, items: List<NotificationEntity>) {
        if (items.isEmpty()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        ensureChannels(context)
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).putExtra("open", "notifications").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val nm = NotificationManagerCompat.from(context)
        items.takeLast(10).forEach { n ->
            val b = NotificationCompat.Builder(context, if (n.isUrgent) CH_URGENT else CH_GENERAL)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle(n.title)
                .setContentText(n.body ?: "")
                .setStyle(NotificationCompat.BigTextStyle().bigText(n.body ?: ""))
                .setPriority(if (n.isUrgent) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(open)
            try { nm.notify((n.id % Int.MAX_VALUE).toInt(), b.build()) } catch (_: SecurityException) { }
        }
    }
}
