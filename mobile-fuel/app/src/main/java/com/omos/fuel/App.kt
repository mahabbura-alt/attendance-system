package com.omos.fuel

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import androidx.work.WorkManager
import com.omos.fuel.data.Repo
import com.omos.fuel.sync.SyncWorker

class App : Application() {
    lateinit var repo: Repo
        private set

    override fun onCreate() {
        super.onCreate()
        repo = Repo(this)
        WorkManager.initialize(this, Configuration.Builder().build())
        SyncWorker.schedule(this)
    }

    companion object {
        fun repo(context: Context): Repo = (context.applicationContext as App).repo
    }
}
