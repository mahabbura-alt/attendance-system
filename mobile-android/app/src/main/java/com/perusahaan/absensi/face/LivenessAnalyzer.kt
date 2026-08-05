package com.perusahaan.absensi.face

import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions

/**
 * Liveness sederhana: mendeteksi transisi mata terbuka -> tertutup -> terbuka
 * (kedipan) dalam beberapa frame berturut-turut. Ini BUKAN anti-spoofing
 * tingkat enterprise, tapi cukup untuk mencegah kecurangan dasar (foto statis
 * tidak akan pernah "berkedip").
 *
 * State machine:
 *   MENUNGGU_WAJAH -> MATA_TERBUKA -> MATA_TERTUTUP -> KEDIPAN_TERDETEKSI
 */
class LivenessAnalyzer(
    private val onFaceTerdeteksi: (Face) -> Unit,
    private val onKedipanTerdeteksi: () -> Unit,
    private val onTidakAdaWajah: () -> Unit
) {
    private enum class Status { MENUNGGU_WAJAH, MATA_TERBUKA, MATA_TERTUTUP, SELESAI }

    private var status = Status.MENUNGGU_WAJAH
    private val ambangBukaMata = 0.6f
    private val ambangTutupMata = 0.3f

    private val detector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL) // wajib untuk skor buka/tutup mata
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
            .build()
    )

    @OptIn(ExperimentalGetImage::class)
    fun analisisFrame(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }

        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

        detector.process(inputImage)
            .addOnSuccessListener { faces -> prosesHasil(faces) }
            .addOnCompleteListener { imageProxy.close() }
    }

    private fun prosesHasil(faces: List<Face>) {
        if (status == Status.SELESAI) return

        val wajah = faces.firstOrNull()
        if (wajah == null) {
            status = Status.MENUNGGU_WAJAH
            onTidakAdaWajah()
            return
        }

        onFaceTerdeteksi(wajah)

        val kiriTerbuka = wajah.leftEyeOpenProbability ?: return
        val kananTerbuka = wajah.rightEyeOpenProbability ?: return
        val rataRataBuka = (kiriTerbuka + kananTerbuka) / 2f

        when (status) {
            Status.MENUNGGU_WAJAH, Status.MATA_TERBUKA -> {
                status = if (rataRataBuka >= ambangBukaMata) Status.MATA_TERBUKA
                else if (rataRataBuka <= ambangTutupMata) Status.MATA_TERTUTUP
                else status
            }
            Status.MATA_TERTUTUP -> {
                if (rataRataBuka >= ambangBukaMata) {
                    status = Status.SELESAI
                    onKedipanTerdeteksi()
                }
            }
            Status.SELESAI -> Unit
        }
    }

    fun reset() {
        status = Status.MENUNGGU_WAJAH
    }

    fun tutup() {
        detector.close()
    }
}
