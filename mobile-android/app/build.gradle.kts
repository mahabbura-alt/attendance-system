plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.perusahaan.absensi"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.perusahaan.absensi"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        // Disuplai dari gradle property API_BASE_URL (CI atau local.properties).
        // Nilai default sengaja tidak dapat dipakai agar konfigurasi produksi tidak terlewat.
        val apiBaseUrl = providers.gradleProperty("API_BASE_URL")
            .orElse("http://192.168.1.82:3000/")
            .get()
            .let { if (it.endsWith('/')) it else "$it/" }
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        create("release") {
            storeFile = file("pim-release.jks")
            storePassword = "PimAbsensi2026!"
            keyAlias = "pimkey"
            keyPassword = "PimAbsensi2026!"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.activity:activity-ktx:1.9.2")

    // Lokasi (geofencing)
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // Kamera
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // ML Kit Face Detection (gratis, on-device) - dipakai untuk liveness sederhana
    implementation("com.google.mlkit:face-detection:16.1.7")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Penyimpanan token JWT terenkripsi
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
