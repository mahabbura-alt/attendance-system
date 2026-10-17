package com.perusahaan.absensi

import android.app.Application
import com.perusahaan.absensi.data.SessionManager

class AbsensiApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SessionManager.init(this)
    }
}
