package com.omos.fuel.scan

import android.annotation.SuppressLint
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pratinjau kamera + ML Kit barcode (model dibundel, offline). Membaca QR dan barcode 1D umum.
 * [onResult] dipanggil sekali per teks yang berbeda; [torch] menyalakan senter untuk shift malam.
 */
@Composable
fun QrScanner(modifier: Modifier, torch: Boolean, onResult: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val callback = rememberUpdatedState(onResult)
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(
                Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_DATA_MATRIX,
            ).build(),
        )
    }
    val cameraHolder = remember { arrayOfNulls<Camera>(1) }
    val busy = remember { AtomicBoolean(false) }
    val last = remember { arrayOfNulls<String>(1) }

    DisposableEffect(lifecycle) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                    ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(executor) { proxy -> analyze(proxy, scanner, busy) { text ->
                if (text != last[0]) { last[0] = text; ContextCompat.getMainExecutor(context).execute { callback.value(text) } }
            } }
            try {
                provider.unbindAll()
                cameraHolder[0] = provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (_: Exception) { }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { providerFuture.get().unbindAll() }
            scanner.close()
            executor.shutdown()
        }
    }

    LaunchedEffect(torch, cameraHolder[0]) { runCatching { cameraHolder[0]?.cameraControl?.enableTorch(torch) } }

    AndroidView(factory = { previewView }, modifier = modifier)
}

@SuppressLint("UnsafeOptInUsageError")
private fun analyze(proxy: ImageProxy, scanner: BarcodeScanner, busy: AtomicBoolean, found: (String) -> Unit) {
    val media = proxy.image
    if (media == null || !busy.compareAndSet(false, true)) { proxy.close(); return }
    val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
    scanner.process(image)
        .addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let(found) }
        .addOnCompleteListener { busy.set(false); proxy.close() }
}
