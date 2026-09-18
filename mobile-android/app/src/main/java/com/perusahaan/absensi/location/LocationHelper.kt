package com.perusahaan.absensi.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

sealed class LokasiResult {
    data class Sukses(val location: Location) : LokasiResult()
    data class MockTerdeteksi(val location: Location) : LokasiResult()
    data class Gagal(val pesan: String) : LokasiResult()
}

/** Ambang akurasi GPS (meter). Fix dengan akurasi lebih kasar ditolak karena
 *  bisa membuat posisi tampak "di luar radius" padahal karyawan sudah di titik absensi. */
private const val MAX_AKURASI_METER = 500f

/** Umur maksimum lastLocation (ms) yang masih layak dipakai sebagai cadangan. */
private const val MAX_UMUR_LAST_LOCATION_MS = 30_000L

/**
 * Ambil lokasi GPS terkini dengan akurasi tinggi.
 * - getCurrentLocation dipaksa segar (maxUpdateAge 0) agar tidak memakai cache basi.
 * - Fallback ke lastLocation HANYA bila masih baru (<= 30 detik) DAN akurasinya cukup (<= 500m).
 * - Fix dengan akurasi buruk (> 500m) ditolak sesuai kebijakan backend.
 */
@SuppressLint("MissingPermission")
suspend fun ambilLokasiSaatIni(context: Context): LokasiResult {
    val client = LocationServices.getFusedLocationProviderClient(context)
    val request = CurrentLocationRequest.Builder()
        .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
        .setMaxUpdateAgeMillis(0)
        .build()

    return suspendCancellableCoroutine { cont ->
        client.getCurrentLocation(request, null)
            .addOnSuccessListener { location ->
                if (location != null) {
                    processLocation(location, cont)
                } else {
                    cobaLastLocation(client, cont)
                }
            }
            .addOnFailureListener {
                cobaLastLocation(client, cont)
            }
    }
}

private fun cobaLastLocation(
    client: FusedLocationProviderClient,
    cont: kotlinx.coroutines.CancellableContinuation<LokasiResult>
) {
    if (!cont.isActive) return
    client.lastLocation.addOnSuccessListener { lastLoc ->
        if (!cont.isActive) return@addOnSuccessListener
        if (lastLoc != null && lastLocationMasihValid(lastLoc)) {
            processLocation(lastLoc, cont)
        } else {
            cont.resume(LokasiResult.Gagal(
                "Sinyal GPS lemah / belum ada koordinat akurat.\n\n" +
                "Berdirilah di area terbuka, pastikan GPS aktif, dan tunggu beberapa detik lalu coba lagi."
            ))
        }
    }.addOnFailureListener {
        if (cont.isActive) cont.resume(LokasiResult.Gagal("Gagal membaca sinyal lokasi GPS."))
    }
}

/** lastLocation hanya dipakai bila masih baru & akurasinya cukup. */
private fun lastLocationMasihValid(loc: Location): Boolean {
    val umurMs = System.currentTimeMillis() - loc.time
    val akurasiOk = !loc.hasAccuracy() || loc.accuracy <= MAX_AKURASI_METER
    return umurMs <= MAX_UMUR_LAST_LOCATION_MS && akurasiOk
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
        return
    }

    // Sinkron dengan MAX_ACCURACY_METER backend agar keputusan tidak berbeda antar-klien.
    if (location.hasAccuracy() && location.accuracy > MAX_AKURASI_METER) {
        cont.resume(LokasiResult.Gagal(
            "Akurasi GPS terlalu rendah (±${location.accuracy.toInt()}m).\n\n" +
            "Berdirilah di area terbuka & tunggu sinyal GPS stabil, lalu coba lagi."
        ))
        return
    }

    cont.resume(LokasiResult.Sukses(location))
}
