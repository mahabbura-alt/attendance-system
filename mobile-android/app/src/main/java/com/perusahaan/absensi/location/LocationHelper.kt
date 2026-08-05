package com.perusahaan.absensi.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

sealed class LokasiResult {
    data class Sukses(val location: Location) : LokasiResult()
    data class MockTerdeteksi(val location: Location) : LokasiResult()
    data class Gagal(val pesan: String) : LokasiResult()
}

/**
 * Ambil lokasi GPS terkini dengan akurasi tinggi.
 * Jika getCurrentLocation bernilai null, otomatis fallback ke lastLocation.
 */
@SuppressLint("MissingPermission")
suspend fun ambilLokasiSaatIni(context: Context): LokasiResult {
    val client = LocationServices.getFusedLocationProviderClient(context)
    val request = CurrentLocationRequest.Builder()
        .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
        .setMaxUpdateAgeMillis(60000)
        .build()

    return suspendCancellableCoroutine { cont ->
        client.getCurrentLocation(request, null)
            .addOnSuccessListener { location ->
                if (location != null) {
                    processLocation(location, cont)
                } else {
                    client.lastLocation.addOnSuccessListener { lastLoc ->
                        if (lastLoc != null) {
                            processLocation(lastLoc, cont)
                        } else {
                            if (cont.isActive) cont.resume(LokasiResult.Gagal("GPS tidak dapat koordinat. Aktifkan Lokasi/GPS HP."))
                        }
                    }.addOnFailureListener {
                        if (cont.isActive) cont.resume(LokasiResult.Gagal("Gagal membaca sinyal lokasi GPS."))
                    }
                }
            }
            .addOnFailureListener {
                client.lastLocation.addOnSuccessListener { lastLoc ->
                    if (lastLoc != null) {
                        processLocation(lastLoc, cont)
                    } else {
                        if (cont.isActive) cont.resume(LokasiResult.Gagal("Gagal mengambil lokasi GPS."))
                    }
                }.addOnFailureListener {
                    if (cont.isActive) cont.resume(LokasiResult.Gagal("Gagal mengambil lokasi GPS."))
                }
            }
    }
}

private fun processLocation(location: Location, cont: kotlinx.coroutines.CancellableContinuation<LokasiResult>) {
    if (!cont.isActive) return
    val isMock = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
        location.isMock
    } else {
        @Suppress("DEPRECATION")
        location.isFromMockProvider
    }

    if (isMock) {
        cont.resume(LokasiResult.MockTerdeteksi(location))
    } else {
        cont.resume(LokasiResult.Sukses(location))
    }
}
