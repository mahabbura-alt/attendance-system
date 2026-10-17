package com.omos.safety

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import androidx.work.WorkManager
import com.omos.safety.data.Repo
import com.omos.safety.sync.Notifier
import com.omos.safety.sync.SyncWorker

class App : Application() {
    lateinit var repo: Repo
        private set

    override fun onCreate() {
        super.onCreate()
        repo = Repo(this)
        WorkManager.initialize(this, Configuration.Builder().build())
        Notifier.ensureChannels(this)
        SyncWorker.schedule(this)
    }

    companion object {
        fun repo(context: Context): Repo = (context.applicationContext as App).repo
    }
}
